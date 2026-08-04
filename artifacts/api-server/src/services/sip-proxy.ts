/**
 * SIP FQDN Proxy — DNS-interception + UDP relay for the sip-agent binary.
 *
 * Root cause
 * ----------
 * The binary uses sipgo's RFC 3263 transport routing: it resolves the Request-URI
 * host (the SIP domain, e.g. "aioprocess-demo.ras.yeastar.com") via DNS and sends
 * packets directly to that IP.  The "server" field in our config is NOT used for
 * packet routing — it only affects Contact/Via header construction.
 *
 * Previous approach: iptables DNAT
 * ---------------------------------
 * We tried intercepting outbound UDP to Yeastar with an iptables OUTPUT DNAT rule
 * that redirected packets to a local socket.  This failed silently: the iptables
 * rule accumulated 0 packet hits across multiple attempts, even with
 * route_localnet=1 set.  The exact kernel/Docker interaction that prevents the
 * rule from firing is unclear, but the result is definitive — iptables DNAT is
 * not a reliable approach on this VPS.
 *
 * Current approach: DNS interception via /etc/hosts
 * --------------------------------------------------
 * When the proxy starts for extension N:
 *   1. Resolve the real Yeastar IP (for use by extSock).
 *   2. Assign a unique loopback IP: 127.1.0.N
 *   3. Add "/etc/hosts" entry: "127.1.0.N  <yeastarFQDN>  # sip-proxy:<fqdn>"
 *   4. Bind localSock to 127.1.0.N:yeastarPort (e.g. 127.1.0.1:5060).
 *      The binary resolves the FQDN → 127.1.0.N via /etc/hosts and sends
 *      its REGISTER straight to the proxy socket.  No iptables needed.
 *   5. extSock is bound to 0.0.0.0:proxyExtPort and forwards to the real
 *      Yeastar IP:port.
 *
 * When the proxy stops:
 *   1. Remove the /etc/hosts entry.
 *   2. Close both sockets.
 *
 * Port scheme
 * -----------
 *   proxyExtPort = sipLocalPort + 20000   (e.g. 7060 → 27060)
 *   localSock listens on 127.1.0.<extensionId>:<yeastarPort>
 *
 * Relay logic
 * -----------
 *   Outbound requests (binary → Yeastar):
 *     add ";rport" to first Via so Yeastar replies to extSock's actual port.
 *
 *   Inbound responses (Yeastar → binary):
 *     forward to 127.1.0.<id>:binarySrcPort (the source port of the binary's
 *     last SIP packet, which is its sipLocalPort / listen port).
 *
 *   Inbound requests (INVITE/NOTIFY from Yeastar):
 *     prepend a proxy Via so binary's response comes back through localSock;
 *     deliver to 127.1.0.<id>:binaryListenPort.
 *
 *   Outbound responses (binary 200 OK → Yeastar):
 *     strip proxy Via, forward via extSock.
 */

import dgram from "dgram";
import dns from "dns/promises";
import fs from "node:fs/promises";
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

export function proxyLocalPortFor(_sipLocalPort: number): number {
  // With DNS interception the localSock binds on the real Yeastar port (5060),
  // not a derived port.  This export is kept for call-site compatibility but
  // the value is no longer used as a socket port inside the proxy.
  return _sipLocalPort + 10000;
}
export function proxyExtPortFor(sipLocalPort: number): number {
  return sipLocalPort + 20000;
}

/** Unique loopback IP for this extension: 127.1.0.<id> */
export function proxyLoopbackIp(extensionId: number): string {
  return `127.1.0.${extensionId}`;
}

// ── /etc/hosts helpers ────────────────────────────────────────────────────────

const HOSTS_FILE = "/etc/hosts";
const HOSTS_MARKER_PREFIX = "# sip-proxy:";

async function addHostsEntry(loopbackIp: string, host: string): Promise<void> {
  const marker = `${HOSTS_MARKER_PREFIX}${host}`;
  let content: string;
  try {
    content = await fs.readFile(HOSTS_FILE, "utf8");
  } catch {
    content = "";
  }
  // Remove any existing proxy entry for this host (idempotent)
  const lines = content.split("\n").filter(l => !l.includes(marker));
  lines.push(`${loopbackIp} ${host}  ${marker}`);
  await fs.writeFile(HOSTS_FILE, lines.join("\n") + "\n", "utf8");
  logger.info({ loopbackIp, host }, "SIP proxy: /etc/hosts entry added");
}

async function removeHostsEntry(host: string): Promise<void> {
  const marker = `${HOSTS_MARKER_PREFIX}${host}`;
  try {
    const content = await fs.readFile(HOSTS_FILE, "utf8");
    const filtered = content.split("\n").filter(l => !l.includes(marker)).join("\n");
    await fs.writeFile(HOSTS_FILE, filtered + "\n", "utf8");
    logger.info({ host }, "SIP proxy: /etc/hosts entry removed");
  } catch (err) {
    logger.warn({ host, err }, "SIP proxy: failed to remove /etc/hosts entry (non-fatal)");
  }
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
  localSock: dgram.Socket;   // bound to loopbackIp:yeastarPort — receives binary packets
  extSock: dgram.Socket;     // bound to 0.0.0.0:proxyExtPort  — talks to Yeastar
  loopbackIp: string;        // 127.1.0.<extensionId>
  proxyExtPort: number;
  binaryListenPort: number;  // binary's static SIP listen port (e.g. 7060)
  yeastarHost: string;       // original FQDN (for /etc/hosts cleanup)
  yeastarIp: string;         // resolved real IP
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
  let stripped = false;
  const pairs: Array<[string, string, string]> = [];
  for (const [k, origKey, val] of msg.pairs) {
    if (k === "via" && !stripped && val.includes(`${s.loopbackIp}:`)) {
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
  const proxyVia = `SIP/2.0/UDP ${s.loopbackIp}:${s.yeastarPort};branch=${randomBranch()}`;
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

export async function startSipProxy(params: {
  extensionId: number;
  sipLocalPort: number;
  proxyLocalPort: number;   // kept for call-site compatibility, not used here
  proxyExtPort: number;
  yeastarServer: string;
  publicIp: string;         // kept for compatibility; not used in rewriting
}): Promise<void> {
  const { extensionId, sipLocalPort, proxyExtPort, yeastarServer } = params;
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

  // Assign a unique loopback IP for this extension and inject into /etc/hosts
  // so the binary's DNS lookup returns our proxy address instead of the real Yeastar IP.
  const loopbackIp = proxyLoopbackIp(extensionId);
  await addHostsEntry(loopbackIp, yeastarHost);

  const localSock = dgram.createSocket("udp4");
  const extSock   = dgram.createSocket("udp4");

  // localSock binds on the SAME port as Yeastar (e.g. 5060) but on the loopback IP.
  // The binary resolves the FQDN → loopbackIp via /etc/hosts and sends directly here.
  try {
    await bindSock(localSock, yeastarPort, loopbackIp);
  } catch (err) {
    await removeHostsEntry(yeastarHost);
    await closeSock(localSock).catch(() => {});
    await closeSock(extSock).catch(() => {});
    throw new Error(`SIP proxy: localSock bind failed on ${loopbackIp}:${yeastarPort} for ext ${extensionId}: ${(err as Error).message}`);
  }

  // extSock uses a known source port (excluded from nothing — iptables is gone).
  try {
    await bindSock(extSock, proxyExtPort, "0.0.0.0");
  } catch (err) {
    await removeHostsEntry(yeastarHost);
    await closeSock(localSock).catch(() => {});
    await closeSock(extSock).catch(() => {});
    throw new Error(`SIP proxy: extSock bind failed on port ${proxyExtPort} for ext ${extensionId}: ${(err as Error).message}`);
  }

  const s: ProxyState = {
    localSock, extSock,
    loopbackIp, proxyExtPort,
    binaryListenPort: sipLocalPort,
    yeastarHost, yeastarIp, yeastarPort,
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
    // Deliver to the loopback IP on the binary's source port.
    // The binary binds to 0.0.0.0:sipLocalPort so any loopback dest reaches it.
    localSock.send(out, destPort, s.loopbackIp, (err) => {
      if (err) {
        logger.warn({ extensionId, destPort, err, sip: sipLine }, "SIP proxy: localSock send error");
      } else {
        logger.info(
          { extensionId, dir: "Yeastar→binary",
            from: `${rinfo.address}:${rinfo.port}`, to: `${s.loopbackIp}:${destPort}`,
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
    extensionId, loopbackIp, yeastarPort, proxyExtPort,
    binaryListenPort: sipLocalPort, yeastarIp, yeastarHost,
  }, "SIP FQDN proxy started — DNS interception via /etc/hosts");
}

export async function stopSipProxy(extensionId: number): Promise<void> {
  const s = proxies.get(extensionId);
  if (!s) return;
  proxies.delete(extensionId);
  await removeHostsEntry(s.yeastarHost);
  await Promise.all([closeSock(s.localSock), closeSock(s.extSock)]);
  logger.info({ extensionId }, "SIP FQDN proxy stopped");
}

export function isSipProxyActive(extensionId: number): boolean {
  return proxies.has(extensionId);
}
