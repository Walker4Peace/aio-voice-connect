/**
 * SIP FQDN Proxy — fixes the "ephemeral source port" NAT problem in the
 * sip-agent binary when connecting to a Yeastar PBX via a public FQDN.
 *
 * Root cause
 * ----------
 * When `sip.server` is an FQDN, the sipgo library resolves the hostname and
 * opens a new ephemeral UDP socket to send the REGISTER.  That socket's source
 * port (e.g. 52768) differs from the binary's SIP listen port (e.g. 7062).
 * Yeastar's NAT ALG detects the Via/Contact port mismatch and rewrites the
 * registered Contact from :7062 → :52768.  Subsequent inbound INVITEs go to
 * port 52768 (ephemeral, closed) — lost.
 *
 * Fix
 * ---
 * The proxy holds two fixed UDP sockets per extension:
 *   localSock  → 127.0.0.1:proxyLocalPort  (binary connects here instead of FQDN)
 *   extSock    → 0.0.0.0:proxyExtPort       (fixed source port to Yeastar)
 *
 * Port rewriting strategy (outbound, binary → Yeastar):
 *   The binary puts its public IP in Via/Contact but uses its own listen port
 *   (e.g. 7062).  We swap that port to proxyExtPort while preserving the IP.
 *   extSock sends the packet, so source port = proxyExtPort.
 *   ⇒ Via port == Contact port == extSock source port  ⇒  no Yeastar rewrite.
 *
 * Inbound responses (Yeastar → binary):
 *   Yeastar echoes back Via port proxyExtPort.  We swap it back to
 *   binaryListenPort so the binary's SIP stack accepts it.
 *
 * Inbound requests (INVITE/NOTIFY from Yeastar → binary):
 *   We prepend our own Via (127.0.0.1:proxyLocalPort) so the binary's 200 OK
 *   routes back through the proxy's localSock, not directly to Yeastar.
 *   The binary's Contact in the 200 OK is rewritten to proxyExtPort so Yeastar
 *   sends future in-dialog requests to the proxy.
 */

import dgram from "dgram";
import dns from "dns/promises";
import { logger } from "../lib/logger.js";

// ── Public IP cache ──────────────────────────────────────────────────────────
let cachedPublicIp: string | null = null;

export async function getPublicIp(): Promise<string> {
  if (cachedPublicIp) return cachedPublicIp;

  const sources = [
    "https://api.ipify.org?format=text",
    "https://ipinfo.io/ip",
    "https://checkip.amazonaws.com",
  ];

  for (const url of sources) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const ip = (await res.text()).trim();
        if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
          cachedPublicIp = ip;
          logger.info({ ip, source: url }, "SIP proxy: detected public IP");
          return ip;
        }
      }
    } catch { /* try next */ }
  }
  throw new Error("Could not determine public IP for SIP FQDN proxy");
}

/** Return true if sipServer is a public hostname that requires the proxy. */
export function needsSipProxy(sipServer: string): boolean {
  const host = sipServer.split(":")[0]!.trim();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;  // raw IPv4
  if (host === "localhost" || host === "::1") return false;
  return /[a-zA-Z]/.test(host);  // any hostname with letters = FQDN
}

// ── Port derivation ───────────────────────────────────────────────────────────
/** Loopback port the binary connects to (binary→proxy). */
export function proxyLocalPortFor(sipLocalPort: number): number {
  return sipLocalPort + 10000;
}
/** External port the proxy binds to talk to Yeastar (fixed source port). */
export function proxyExtPortFor(sipLocalPort: number): number {
  return sipLocalPort + 20000;
}

// ── SIP message helpers ───────────────────────────────────────────────────────

const COMPACT_HEADERS: Record<string, string> = {
  v: "via", f: "from", t: "to", m: "contact",
  i: "call-id", l: "content-length", c: "content-type",
};

function normaliseKey(k: string): string {
  const lower = k.trim().toLowerCase();
  return COMPACT_HEADERS[lower] ?? lower;
}

interface SipMsg {
  firstLine: string;
  /** [normalisedKey, originalKey, value] — preserves order and multi-values */
  pairs: Array<[string, string, string]>;
  body: string;
}

function parse(buf: Buffer): SipMsg | null {
  const raw = buf.toString("utf8");
  const sep = raw.match(/\r?\n\r?\n/);
  if (!sep || sep.index === undefined) return null;
  const hdrSection = raw.slice(0, sep.index);
  const body = raw.slice(sep.index + sep[0].length);
  const lines = hdrSection.split(/\r?\n/);
  const firstLine = lines[0] ?? "";
  const pairs: Array<[string, string, string]> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    if (/^[ \t]/.test(line) && pairs.length > 0) {
      pairs[pairs.length - 1]![2] += " " + line.trim();
      continue;
    }
    const ci = line.indexOf(":");
    if (ci === -1) continue;
    pairs.push([normaliseKey(line.slice(0, ci)), line.slice(0, ci).trim(), line.slice(ci + 1).trim()]);
  }
  return { firstLine, pairs, body };
}

function rebuild(msg: SipMsg): Buffer {
  let t = msg.firstLine + "\r\n";
  for (const [, origKey, val] of msg.pairs) t += `${origKey}: ${val}\r\n`;
  t += "\r\n" + msg.body;
  return Buffer.from(t, "utf8");
}

function isRequest(firstLine: string): boolean {
  return !firstLine.startsWith("SIP/2.0");
}

/** Swap every occurrence of IP:oldPort → IP:newPort in a header value.
 *  Preserves the IP address; only changes the port. */
function swapPort(val: string, oldPort: number, newPort: number): string {
  // Match a dotted-quad IP followed by :oldPort not followed by another digit
  return val.replace(
    new RegExp(`(\\d+\\.\\d+\\.\\d+\\.\\d+):${oldPort}(?!\\d)`, "g"),
    `$1:${newPort}`,
  );
}

function randomBranch(): string {
  return "z9hG4bKp" + Math.random().toString(36).slice(2, 12);
}

// ── Proxy state ───────────────────────────────────────────────────────────────

interface ProxyState {
  localSock: dgram.Socket;
  extSock: dgram.Socket;
  binaryListenPort: number;   // binary's SIP listen port (e.g. 7062)
  proxyLocalPort: number;     // loopback port proxy listens on
  proxyExtPort: number;       // external port proxy uses to reach Yeastar
  publicIp: string;           // VPS public IPv4
  yeastarIp: string;          // resolved FQDN IP
  yeastarPort: number;
  /** Source port of the last packet received from the binary on localSock */
  binarySrcPort: number;
}

const proxies = new Map<number, ProxyState>();

// ── Message rewriting ─────────────────────────────────────────────────────────

/**
 * Outbound request: binary → Yeastar.
 * Swap binary's listen port (and any observed source port) → proxyExtPort
 * in Via and Contact, so Yeastar sees a stable source port that matches
 * the extSock's actual source.
 */
function rwOutboundReq(msg: SipMsg, s: ProxyState, binarySrcPort: number): Buffer {
  const newPairs = msg.pairs.map(([nk, ok, val]) => {
    if (nk === "via" || nk === "contact") {
      val = swapPort(val, s.binaryListenPort, s.proxyExtPort);
      if (binarySrcPort !== s.binaryListenPort) {
        val = swapPort(val, binarySrcPort, s.proxyExtPort);
      }
    }
    return [nk, ok, val] as [string, string, string];
  });
  return rebuild({ ...msg, pairs: newPairs });
}

/**
 * Outbound response: binary's 200 OK → Yeastar (in response to inbound INVITE).
 * Strip the proxy Via we prepended, rewrite Contact port.
 */
function rwOutboundResp(msg: SipMsg, s: ProxyState): Buffer {
  let strippedVia = false;
  const newPairs: Array<[string, string, string]> = [];
  for (const [nk, ok, val] of msg.pairs) {
    if (nk === "via" && !strippedVia && val.includes(`127.0.0.1:${s.proxyLocalPort}`)) {
      strippedVia = true;
      continue; // drop proxy Via
    }
    let v = val;
    if (nk === "contact") {
      v = swapPort(v, s.binaryListenPort, s.proxyExtPort);
    }
    newPairs.push([nk, ok, v]);
  }
  return rebuild({ ...msg, pairs: newPairs });
}

/**
 * Inbound response: Yeastar → binary (e.g. 401/200 to REGISTER).
 * Swap proxyExtPort back to binary's listen port in Via so the binary
 * recognises the echoed Via as its own.
 */
function rwInboundResp(msg: SipMsg, s: ProxyState): Buffer {
  const newPairs = msg.pairs.map(([nk, ok, val]) => {
    if (nk === "via") val = swapPort(val, s.proxyExtPort, s.binaryListenPort);
    return [nk, ok, val] as [string, string, string];
  });
  return rebuild({ ...msg, pairs: newPairs });
}

/**
 * Inbound request: INVITE/NOTIFY from Yeastar → binary.
 * Prepend a proxy Via so the binary's 200 OK routes back through us.
 * Also rewrite Request-URI if it references proxyExtPort.
 */
function rwInboundReq(msg: SipMsg, s: ProxyState): Buffer {
  const proxyVia = `SIP/2.0/UDP 127.0.0.1:${s.proxyLocalPort};branch=${randomBranch()}`;
  let insertedVia = false;
  const newPairs: Array<[string, string, string]> = [];
  for (const [nk, ok, val] of msg.pairs) {
    if (nk === "via" && !insertedVia) {
      newPairs.push(["via", "Via", proxyVia]);
      insertedVia = true;
    }
    newPairs.push([nk, ok, val]);
  }
  if (!insertedVia) newPairs.unshift(["via", "Via", proxyVia]);

  // Rewrite Request-URI port if it references proxyExtPort
  const fl = swapPort(msg.firstLine, s.proxyExtPort, s.binaryListenPort);
  return rebuild({ ...msg, firstLine: fl, pairs: newPairs });
}

// ── Socket helpers ────────────────────────────────────────────────────────────

function bindSock(sock: dgram.Socket, port: number, addr: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sock.once("error", reject);
    sock.bind(port, addr, () => { sock.removeListener("error", reject); resolve(); });
  });
}
function closeSock(sock: dgram.Socket): Promise<void> {
  return new Promise(r => { try { sock.close(r); } catch { r(); } });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function startSipProxy(params: {
  extensionId: number;
  sipLocalPort: number;
  proxyLocalPort: number;
  proxyExtPort: number;
  yeastarServer: string;
  publicIp: string;
}): Promise<void> {
  const { extensionId, sipLocalPort, proxyLocalPort, proxyExtPort, yeastarServer, publicIp } = params;
  await stopSipProxy(extensionId);

  const colonIdx = yeastarServer.lastIndexOf(":");
  const yeastarHost = colonIdx > 0 ? yeastarServer.slice(0, colonIdx) : yeastarServer;
  const yeastarPort = colonIdx > 0 ? (Number(yeastarServer.slice(colonIdx + 1)) || 5060) : 5060;

  let yeastarIp = yeastarHost;
  try {
    const addrs = await dns.resolve4(yeastarHost);
    yeastarIp = addrs[0] ?? yeastarHost;
    logger.info({ extensionId, yeastarHost, yeastarIp }, "SIP proxy: resolved Yeastar FQDN");
  } catch (err) {
    logger.warn({ extensionId, yeastarHost, err }, "SIP proxy: DNS resolve failed, using hostname directly");
  }

  const localSock = dgram.createSocket("udp4");
  const extSock = dgram.createSocket("udp4");

  const s: ProxyState = {
    localSock, extSock,
    binaryListenPort: sipLocalPort,
    proxyLocalPort, proxyExtPort,
    publicIp, yeastarIp, yeastarPort,
    binarySrcPort: sipLocalPort,
  };

  try {
    await bindSock(localSock, proxyLocalPort, "127.0.0.1");
    await bindSock(extSock, proxyExtPort, "0.0.0.0");
  } catch (err) {
    await closeSock(localSock).catch(() => {});
    await closeSock(extSock).catch(() => {});
    throw new Error(`SIP proxy bind failed for ext ${extensionId}: ${(err as Error).message}`);
  }

  // ── Binary → Yeastar ───────────────────────────────────────────────────────
  localSock.on("message", (buf, rinfo) => {
    s.binarySrcPort = rinfo.port;
    const msg = parse(buf);
    let out: Buffer;
    if (!msg) {
      out = buf;
    } else if (!isRequest(msg.firstLine)) {
      // binary response to Yeastar inbound (INVITE 200 OK etc.)
      out = rwOutboundResp(msg, s);
    } else {
      // binary outbound request (REGISTER, OPTIONS…)
      out = rwOutboundReq(msg, s, rinfo.port);
    }
    extSock.send(out, s.yeastarPort, s.yeastarIp, (err) => {
      if (err) logger.warn({ extensionId, err }, "SIP proxy extSock send error");
    });
    logger.debug(
      { extensionId, srcPort: rinfo.port, line: msg?.firstLine.split(" ").slice(0, 2).join(" ") },
      "SIP proxy binary→Yeastar",
    );
  });

  // ── Yeastar → Binary ───────────────────────────────────────────────────────
  extSock.on("message", (buf, rinfo) => {
    const msg = parse(buf);
    let out: Buffer;
    if (!msg) {
      out = buf;
    } else if (isRequest(msg.firstLine)) {
      // Yeastar inbound request (INVITE, NOTIFY, OPTIONS…)
      out = rwInboundReq(msg, s);
    } else {
      // Yeastar response (401 to REGISTER, 200 OK, etc.)
      out = rwInboundResp(msg, s);
    }
    // Send to binary's listen port on loopback
    localSock.send(out, s.binaryListenPort, "127.0.0.1", (err) => {
      if (err) logger.warn({ extensionId, err }, "SIP proxy localSock send error");
    });
    logger.debug(
      { extensionId, fromIp: rinfo.address, line: msg?.firstLine.split(" ").slice(0, 3).join(" ") },
      "SIP proxy Yeastar→binary",
    );
  });

  localSock.on("error", (err) => logger.warn({ extensionId, err }, "SIP proxy localSock error"));
  extSock.on("error", (err) => logger.warn({ extensionId, err }, "SIP proxy extSock error"));

  proxies.set(extensionId, s);
  logger.info({
    extensionId, proxyLocalPort, proxyExtPort,
    yeastarIp, yeastarPort, publicIp, binaryListenPort: sipLocalPort,
  }, "SIP FQDN proxy started");
}

export async function stopSipProxy(extensionId: number): Promise<void> {
  const s = proxies.get(extensionId);
  if (!s) return;
  proxies.delete(extensionId);
  await Promise.all([closeSock(s.localSock), closeSock(s.extSock)]);
  logger.info({ extensionId }, "SIP FQDN proxy stopped");
}

export function isSipProxyActive(extensionId: number): boolean {
  return proxies.has(extensionId);
}
