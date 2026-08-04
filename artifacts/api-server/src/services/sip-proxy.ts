/**
 * SIP FQDN Proxy — direct UDP relay for the sip-agent binary.
 *
 * Problem
 * -------
 * The sip-agent binary receives SIP_SERVER from its environment and uses that
 * address for outbound UDP packets. When the PBX server is a public FQDN the
 * binary must still be able to reach it, and we need to intercept packets so
 * we can add the rport parameter required for NAT traversal.
 *
 * Previous approaches (both abandoned)
 * -------------------------------------
 * 1. iptables DNAT — accumulated 0 packet hits regardless of configuration.
 * 2. /etc/hosts rewriting — requires write access to /etc/hosts which the
 *    service account does not have (EACCES). When this failed the code still
 *    set SIP_SERVER=127.1.0.N:5060, so the binary sent REGISTER to an address
 *    where no proxy socket was listening, producing Timer_B timeouts.
 *
 * Current approach: direct FQDN interception
 * -------------------------------------------
 * No kernel networking or system-file manipulation required.
 *
 *   1. Resolve the Yeastar FQDN → real IP (DNS, done once at start).
 *   2. Bind localSock on 127.0.0.1:<proxyLocalPort>   (no special privileges).
 *   3. Bind extSock   on 0.0.0.0:<proxyExtPort>       (outbound socket to Yeastar).
 *   4. Tell the binary: SIP_SERVER=127.0.0.1:<proxyLocalPort>
 *      The binary sends all SIP traffic to localSock. No DNS interception needed.
 *   5. localSock relays to Yeastar via extSock; extSock relays back to the binary.
 *
 * Relay logic
 * -----------
 *   Outbound requests (binary → Yeastar):
 *     Ensure first Via has ";rport" so Yeastar replies to extSock.
 *
 *   Outbound responses (binary 200 OK → Yeastar):
 *     Strip the proxy Via we prepended for inbound requests.
 *
 *   Inbound responses (Yeastar → binary):
 *     Forward to 127.0.0.1:<binarySrcPort> via localSock.
 *
 *   Inbound requests (INVITE/NOTIFY from Yeastar):
 *     Prepend a proxy Via so the binary's response routes back through localSock.
 *     Deliver to 127.0.0.1:<binaryListenPort>.
 */

import dgram from "dgram";
import dns from "dns/promises";
import { logger } from "../lib/logger.js";

// ── Public IP (cached) ────────────────────────────────────────────────────────

let cachedPublicIp: string | null = null;

export async function getPublicIp(): Promise<string> {
  if (cachedPublicIp) return cachedPublicIp;
  for (const url of [
    "https://api.ipify.org?format=text",
    "https://ipinfo.io/ip",
    "https://checkip.amazonaws.com",
  ]) {
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

/** Return true if sipServer is a hostname that requires the FQDN proxy. */
export function needsSipProxy(sipServer: string): boolean {
  const host = sipServer.split(":")[0]!.trim();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false; // raw IPv4
  if (host === "localhost" || host === "::1") return false;
  return /[a-zA-Z]/.test(host); // any FQDN
}

/** Port the binary connects to on 127.0.0.1 (localSock). */
export function proxyLocalPortFor(sipLocalPort: number): number {
  return sipLocalPort + 10000;
}

/** Port extSock binds to for outbound packets to Yeastar. */
export function proxyExtPortFor(sipLocalPort: number): number {
  return sipLocalPort + 20000;
}

// ── Minimal SIP parser ────────────────────────────────────────────────────────

interface SipMsg {
  firstLine: string;
  pairs: Array<[string, string, string]>; // [normKey, origKey, value]
  body: string;
}

const COMPACT: Record<string, string> = {
  v: "via", f: "from", t: "to", m: "contact",
  i: "call-id", l: "content-length", c: "content-type",
};
function nk(k: string): string {
  const l = k.trim().toLowerCase();
  return COMPACT[l] ?? l;
}

function parse(buf: Buffer): SipMsg | null {
  const raw = buf.toString("utf8");
  const sep = raw.match(/\r?\n\r?\n/);
  if (!sep || sep.index === undefined) return null;
  const hdr = raw.slice(0, sep.index);
  const body = raw.slice(sep.index + sep[0].length);
  const lines = hdr.split(/\r?\n/);
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
    pairs.push([nk(line.slice(0, ci)), line.slice(0, ci).trim(), line.slice(ci + 1).trim()]);
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

function randomBranch(): string {
  return "z9hG4bKp" + Math.random().toString(36).slice(2, 12);
}

/** Ensure the first Via in a SIP message has ";rport" (no value). */
function ensureRport(pairs: Array<[string, string, string]>): Array<[string, string, string]> {
  let done = false;
  return pairs.map(([nKey, origKey, val]) => {
    if (nKey === "via" && !done) {
      done = true;
      if (!/[;,]\s*rport\b/i.test(val)) {
        const semi = val.indexOf(";");
        val = semi === -1 ? val + ";rport" : val.slice(0, semi) + ";rport" + val.slice(semi);
      }
    }
    return [nKey, origKey, val] as [string, string, string];
  });
}

// ── Proxy state ───────────────────────────────────────────────────────────────

interface ProxyState {
  localSock: dgram.Socket; // 127.0.0.1:<proxyLocalPort> — receives binary packets
  extSock: dgram.Socket;   // 0.0.0.0:<proxyExtPort>    — talks to Yeastar
  proxyLocalPort: number;
  proxyExtPort: number;
  binaryListenPort: number; // binary's static SIP listen port (sipLocalPort)
  yeastarIp: string;        // resolved real IP
  yeastarPort: number;
  /** Source port of the binary's last outbound SIP packet on localSock. */
  binarySrcPort: number;
}

const proxies = new Map<number, ProxyState>();

// ── Rewrite helpers ───────────────────────────────────────────────────────────

function rwOutboundReq(msg: SipMsg): Buffer {
  return rebuild({ ...msg, pairs: ensureRport(msg.pairs) });
}

function rwOutboundResp(msg: SipMsg, s: ProxyState): Buffer {
  // Strip the proxy Via we added for inbound requests
  let stripped = false;
  const pairs: Array<[string, string, string]> = [];
  for (const [k, origKey, val] of msg.pairs) {
    if (k === "via" && !stripped && val.includes(`127.0.0.1:${s.proxyLocalPort}`)) {
      stripped = true;
      continue;
    }
    pairs.push([k, origKey, val]);
  }
  return rebuild({ ...msg, pairs });
}

function rwInboundResp(msg: SipMsg): Buffer {
  return rebuild(msg);
}

function rwInboundReq(msg: SipMsg, s: ProxyState): Buffer {
  // Prepend a proxy Via so the binary's response routes back through localSock
  const proxyVia = `SIP/2.0/UDP 127.0.0.1:${s.proxyLocalPort};branch=${randomBranch()}`;
  let inserted = false;
  const pairs: Array<[string, string, string]> = [];
  for (const [k, origKey, val] of msg.pairs) {
    if (k === "via" && !inserted) {
      pairs.push(["via", "Via", proxyVia]);
      inserted = true;
    }
    pairs.push([k, origKey, val]);
  }
  if (!inserted) pairs.unshift(["via", "Via", proxyVia]);
  return rebuild({ ...msg, pairs });
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

/**
 * Start the SIP proxy for an extension.
 *
 * @returns The address the binary should use as SIP_SERVER, e.g. "127.0.0.1:17060".
 *          The caller must use this value — not the original FQDN — as SIP_SERVER
 *          in the binary's environment and config.json.
 */
export async function startSipProxy(params: {
  extensionId: number;
  sipLocalPort: number;
  proxyLocalPort: number;
  proxyExtPort: number;
  yeastarServer: string;
  publicIp?: string; // kept for call-site compatibility, not used in rewriting
}): Promise<string> {
  const { extensionId, sipLocalPort, proxyLocalPort, proxyExtPort, yeastarServer } = params;
  await stopSipProxy(extensionId);

  // Parse Yeastar host:port
  const colonIdx = yeastarServer.lastIndexOf(":");
  const yeastarHost = colonIdx > 0 ? yeastarServer.slice(0, colonIdx) : yeastarServer;
  const yeastarPort = colonIdx > 0 ? (Number(yeastarServer.slice(colonIdx + 1)) || 5060) : 5060;

  // Resolve FQDN → real IP (used by extSock for forwarding)
  let yeastarIp = yeastarHost;
  try {
    const addrs = await dns.resolve4(yeastarHost);
    yeastarIp = addrs[0] ?? yeastarHost;
    logger.info({ extensionId, yeastarHost, yeastarIp }, "SIP proxy: resolved Yeastar FQDN");
  } catch (err) {
    logger.warn({ extensionId, yeastarHost, err }, "SIP proxy: DNS resolve failed, using hostname");
  }

  const localSock = dgram.createSocket("udp4");
  const extSock   = dgram.createSocket("udp4");

  // localSock binds on 127.0.0.1:<proxyLocalPort>.
  // The binary is told SIP_SERVER=127.0.0.1:<proxyLocalPort> and sends all SIP traffic here.
  // No /etc/hosts manipulation needed — we just redirect the server field.
  try {
    await bindSock(localSock, proxyLocalPort, "127.0.0.1");
  } catch (err) {
    await closeSock(localSock).catch(() => {});
    await closeSock(extSock).catch(() => {});
    throw new Error(`SIP proxy: localSock bind failed on 127.0.0.1:${proxyLocalPort} — ${(err as Error).message}`);
  }

  // extSock is the outbound socket that talks to Yeastar.
  // Yeastar will reply to this socket's source address (publicIp:proxyExtPort).
  try {
    await bindSock(extSock, proxyExtPort, "0.0.0.0");
  } catch (err) {
    await closeSock(localSock).catch(() => {});
    await closeSock(extSock).catch(() => {});
    throw new Error(`SIP proxy: extSock bind failed on 0.0.0.0:${proxyExtPort} — ${(err as Error).message}`);
  }

  const s: ProxyState = {
    localSock, extSock,
    proxyLocalPort, proxyExtPort,
    binaryListenPort: sipLocalPort,
    yeastarIp, yeastarPort,
    binarySrcPort: sipLocalPort,
  };

  // ── Binary → Yeastar ──────────────────────────────────────────────────────
  localSock.on("message", (buf, rinfo) => {
    s.binarySrcPort = rinfo.port;

    const msg = parse(buf);
    let out: Buffer;
    if (!msg) {
      out = buf;
    } else if (!isRequest(msg.firstLine)) {
      out = rwOutboundResp(msg, s);
    } else {
      out = rwOutboundReq(msg);
    }

    const sipLine = msg?.firstLine ?? "(unparsed)";
    extSock.send(out, s.yeastarPort, s.yeastarIp, (err) => {
      if (err) {
        logger.warn({ extensionId, err, sip: sipLine }, "SIP proxy: extSock send error");
      } else {
        logger.info(
          { extensionId, dir: "binary→Yeastar",
            from: `${rinfo.address}:${rinfo.port}`, to: `${s.yeastarIp}:${s.yeastarPort}`,
            sip: sipLine },
          "SIP proxy packet",
        );
      }
    });
  });

  // ── Yeastar → Binary ──────────────────────────────────────────────────────
  extSock.on("message", (buf, rinfo) => {
    const msg = parse(buf);
    let out: Buffer;
    let destPort: number;

    if (!msg) {
      out = buf;
      destPort = s.binarySrcPort;
    } else if (isRequest(msg.firstLine)) {
      out = rwInboundReq(msg, s);
      destPort = s.binaryListenPort;
    } else {
      out = rwInboundResp(msg);
      destPort = s.binarySrcPort;
    }

    const sipLine = msg?.firstLine ?? "(unparsed)";
    // Deliver to the binary on 127.0.0.1 — binary binds to 0.0.0.0 so loopback reaches it.
    localSock.send(out, destPort, "127.0.0.1", (err) => {
      if (err) {
        logger.warn({ extensionId, destPort, err, sip: sipLine }, "SIP proxy: localSock send error");
      } else {
        logger.info(
          { extensionId, dir: "Yeastar→binary",
            from: `${rinfo.address}:${rinfo.port}`, to: `127.0.0.1:${destPort}`,
            sip: sipLine },
          "SIP proxy packet",
        );
      }
    });
  });

  localSock.on("error", (err) => logger.warn({ extensionId, err }, "SIP proxy localSock error"));
  extSock.on("error",   (err) => logger.warn({ extensionId, err }, "SIP proxy extSock error"));

  proxies.set(extensionId, s);
  logger.info({
    extensionId, proxyLocalPort, proxyExtPort,
    binaryListenPort: sipLocalPort, yeastarIp, yeastarHost, yeastarPort,
  }, "SIP FQDN proxy started — direct FQDN interception (no /etc/hosts)");

  return `127.0.0.1:${proxyLocalPort}`;
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
