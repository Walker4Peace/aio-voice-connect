/**
 * SIP FQDN Proxy — minimal rport-aware UDP relay for the sip-agent binary.
 *
 * Problem
 * -------
 * The binary (sipgo) creates an ephemeral UDP socket when connecting to a
 * remote FQDN, resulting in a Via/Contact port mismatch.  Yeastar's NAT ALG
 * rewrites the registered Contact to the ephemeral port (which is then
 * closed), so inbound INVITEs go nowhere.
 *
 * Root cause from PCAP analysis
 * --------------------------------
 * 1. The VPS is behind NAT.  Port 52768 (ephemeral) is what Yeastar sees as
 *    the actual source.  Yeastar's response includes rport=52768 and routes
 *    back successfully via NAT session tracking.
 * 2. Yeastar's 200 OK always returns Contact: sip:ext@sbc-fqdn:5060 — it
 *    substitutes its own SBC address.  We do NOT need to rewrite Contact.
 * 3. sipsak test confirms: even with Via/Contact=127.0.1.1:49657 (private
 *    loopback), Yeastar responds via rport to the actual NAT-mapped port.
 *
 * Our fix
 * -------
 * A thin UDP relay that:
 *   1. Intercepts the binary's outbound SIP and adds ";rport" to the Via.
 *      With rport, Yeastar sends all responses to our actual NAT-mapped source
 *      port (not the Via port), which the NAT session tracks back to our socket.
 *   2. Routes Yeastar responses back to the EXACT source port the binary
 *      used to send the packet (tracked per-packet in binarySrcPort).
 *      The binary may create an ephemeral source socket; we must respond to
 *      that ephemeral port, not the binary's listen port.
 *   3. For Yeastar-originating requests (INVITE, NOTIFY): prepend a proxy Via
 *      pointing at our local socket so the binary's 200 OK routes back through
 *      us.  Send to the binary's static listen port (it listens there for SIP).
 *   4. For binary responses to those requests (200 OK to INVITE): strip the
 *      proxy Via and forward to Yeastar.
 *
 * No Contact rewriting is needed — Yeastar's SBC always substitutes its own
 * domain in the Contact 200 OK response and handles routing internally.
 *
 * Port scheme
 * -----------
 *   proxyLocalPort = sipLocalPort + 10000   (binary connects here, loopback)
 *   proxyExtPort   = sipLocalPort + 20000   (proxy talks to Yeastar — but
 *                                            intentionally NOT pre-bound;
 *                                            OS assigns an ephemeral port on
 *                                            first send, NAT tracks the session)
 *
 * The extSock is auto-bound by Node.js on the first send() call.
 * We read the assigned port afterwards for Via prepending in inbound requests.
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

export function proxyLocalPortFor(sipLocalPort: number): number {
  return sipLocalPort + 10000;
}
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
      // Add ;rport if not already present
      if (!/[;,]\s*rport\b/i.test(val)) {
        // Insert after the protocol+transport part (first token)
        const semi = val.indexOf(";");
        val = semi === -1 ? val + ";rport" : val.slice(0, semi) + ";rport" + val.slice(semi);
      }
    }
    return [nKey, origKey, val] as [string, string, string];
  });
}

// ── Proxy state ───────────────────────────────────────────────────────────────

interface ProxyState {
  localSock: dgram.Socket;   // binary connects here (127.0.0.1:proxyLocalPort)
  extSock: dgram.Socket;     // proxy talks to Yeastar (ephemeral source port)
  proxyLocalPort: number;
  binaryListenPort: number;  // binary's static SIP listen port (e.g. 7062)
  yeastarIp: string;
  yeastarPort: number;
  /** Source port of the binary's last outbound SIP packet on localSock.
   *  May be an ephemeral port (not binaryListenPort). Responses MUST go here. */
  binarySrcPort: number;
  /** True once extSock has auto-bound (first send has happened). */
  extBound: boolean;
}

const proxies = new Map<number, ProxyState>();

// ── Rewrite helpers ───────────────────────────────────────────────────────────

/**
 * Rewrite outbound request (binary → Yeastar).
 * Only change: add ;rport to the first Via so Yeastar responds to the actual
 * NAT-mapped source port instead of the Via address.
 */
function rwOutboundReq(msg: SipMsg): Buffer {
  return rebuild({ ...msg, pairs: ensureRport(msg.pairs) });
}

/**
 * Rewrite outbound response (binary's 200 OK → Yeastar, in response to INVITE).
 * Strip the proxy Via we inserted, leave everything else intact.
 */
function rwOutboundResp(msg: SipMsg, s: ProxyState): Buffer {
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

/**
 * Rewrite inbound response (Yeastar → binary, e.g. 401/200 to REGISTER).
 * Forward as-is — the binary's SIP stack matches transactions by branch ID,
 * not by Via host:port, so no rewriting is required.
 */
function rwInboundResp(msg: SipMsg): Buffer {
  return rebuild(msg);
}

/**
 * Rewrite inbound request (INVITE/NOTIFY from Yeastar → binary).
 * Prepend a proxy Via pointing to our local socket so the binary's response
 * (200 OK, etc.) routes back through localSock rather than directly to Yeastar.
 */
function rwInboundReq(msg: SipMsg, s: ProxyState): Buffer {
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

// ── Socket helpers ─────────────────────────────────────────────────────────────

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
  proxyExtPort: number;   // kept in signature for compatibility; not bound
  yeastarServer: string;
  publicIp: string;       // kept for compatibility; not used in rewriting
}): Promise<void> {
  const { extensionId, sipLocalPort, proxyLocalPort, yeastarServer } = params;
  await stopSipProxy(extensionId);

  // Parse Yeastar host:port
  const colonIdx = yeastarServer.lastIndexOf(":");
  const yeastarHost = colonIdx > 0 ? yeastarServer.slice(0, colonIdx) : yeastarServer;
  const yeastarPort = colonIdx > 0 ? (Number(yeastarServer.slice(colonIdx + 1)) || 5060) : 5060;

  // Resolve FQDN → IP for stable routing (DNS changes don't break mid-session)
  let yeastarIp = yeastarHost;
  try {
    const addrs = await dns.resolve4(yeastarHost);
    yeastarIp = addrs[0] ?? yeastarHost;
    logger.info({ extensionId, yeastarHost, yeastarIp }, "SIP proxy: resolved Yeastar FQDN");
  } catch (err) {
    logger.warn({ extensionId, yeastarHost, err }, "SIP proxy: DNS resolve failed, using hostname");
  }

  const localSock = dgram.createSocket("udp4");
  // extSock is NOT pre-bound — Node.js auto-binds on first send(),
  // letting the OS pick an ephemeral source port that NAT can track.
  const extSock = dgram.createSocket("udp4");

  const s: ProxyState = {
    localSock, extSock,
    proxyLocalPort,
    binaryListenPort: sipLocalPort,
    yeastarIp, yeastarPort,
    binarySrcPort: sipLocalPort, // updated on first message
    extBound: false,
  };

  // Bind localSock so the binary can connect to it
  try {
    await bindSock(localSock, proxyLocalPort, "127.0.0.1");
  } catch (err) {
    await closeSock(localSock).catch(() => {});
    await closeSock(extSock).catch(() => {});
    throw new Error(`SIP proxy bind failed for ext ${extensionId}: ${(err as Error).message}`);
  }

  // ── Binary → Yeastar ──────────────────────────────────────────────────────
  localSock.on("message", (buf, rinfo) => {
    // Track source port — may be ephemeral (not the binary's listen port)
    s.binarySrcPort = rinfo.port;

    const msg = parse(buf);
    let out: Buffer;
    if (!msg) {
      out = buf;
    } else if (!isRequest(msg.firstLine)) {
      // Binary response to a Yeastar request (200 OK to INVITE, etc.)
      out = rwOutboundResp(msg, s);
    } else {
      // Binary outbound request (REGISTER, OPTIONS, etc.) — add rport
      out = rwOutboundReq(msg);
    }

    extSock.send(out, s.yeastarPort, s.yeastarIp, (err) => {
      if (err) logger.warn({ extensionId, err }, "SIP proxy: extSock send error");
      else if (!s.extBound) {
        s.extBound = true;
        try {
          const addr = extSock.address();
          logger.info({ extensionId, extSrcPort: addr.port, yeastarIp, yeastarPort },
            "SIP proxy: extSock auto-bound, first packet sent to Yeastar");
        } catch { /* ignore */ }
      }
    });

    logger.debug(
      { extensionId, binarySrc: rinfo.port, line: msg?.firstLine.split(" ").slice(0, 2).join(" ") },
      "SIP proxy: binary→Yeastar",
    );
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
      // Yeastar inbound request (INVITE, NOTIFY, OPTIONS…)
      // → send to binary's LISTEN port (it listens there for new dialogs)
      out = rwInboundReq(msg, s);
      destPort = s.binaryListenPort;
    } else {
      // Yeastar response (401, 200 OK to REGISTER…)
      // → MUST go to the same source port the binary used to send the request
      out = rwInboundResp(msg);
      destPort = s.binarySrcPort;
    }

    localSock.send(out, destPort, "127.0.0.1", (err) => {
      if (err) logger.warn({ extensionId, destPort, err }, "SIP proxy: localSock send error");
    });

    logger.debug(
      { extensionId, fromYeastar: rinfo.address, destPort,
        line: msg?.firstLine.split(" ").slice(0, 3).join(" ") },
      "SIP proxy: Yeastar→binary",
    );
  });

  localSock.on("error", (err) => logger.warn({ extensionId, err }, "SIP proxy localSock error"));
  extSock.on("error",   (err) => logger.warn({ extensionId, err }, "SIP proxy extSock error"));

  proxies.set(extensionId, s);
  logger.info({
    extensionId, proxyLocalPort, binaryListenPort: sipLocalPort,
    yeastarIp, yeastarPort,
  }, "SIP FQDN proxy started (rport mode, auto-ephemeral extSock)");
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
