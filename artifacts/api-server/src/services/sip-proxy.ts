/**
 * SIP FQDN Proxy — iptables-DNAT + rport-aware UDP relay for the sip-agent binary.
 *
 * Root cause
 * ----------
 * The binary uses sipgo's RFC 3263 transport routing: it resolves the Request-URI
 * host (the SIP domain, e.g. "aioprocess-demo.ras.yeastar.com") via DNS and sends
 * packets directly to that IP.  The "server" field in our config is NOT used for
 * packet routing — it only affects Contact/Via header construction.  So redirecting
 * "server" to "127.0.0.1:17062" makes the binary log the proxy address but still
 * sends packets straight to Yeastar (bypassing the proxy entirely).
 *
 * Fix — two-layer interception
 * ----------------------------
 * Layer 1 – iptables DNAT (kernel, transparent):
 *   When the proxy starts, add an OUTPUT rule that redirects all UDP from this
 *   machine destined for yeastarIp:yeastarPort to 127.0.0.1:proxyLocalPort.
 *   The proxy's OWN extSock is bound to proxyExtPort and excluded from the rule
 *   (! --sport proxyExtPort) so extSock → Yeastar traffic goes through unmodified.
 *
 * Layer 2 – UDP relay (Node.js, in-process):
 *   localSock  bound to 127.0.0.1:proxyLocalPort — receives the DNAT-redirected
 *              binary packets.
 *   extSock    bound to 0.0.0.0:proxyExtPort — sends to Yeastar and receives
 *              responses/requests.
 *
 *   Outbound requests (binary → Yeastar):  add ";rport" to the first Via so
 *     Yeastar responds to the actual NAT-mapped source port.
 *   Inbound responses (Yeastar → binary):  forward to binarySrcPort (the exact
 *     source port of the binary's last packet — may be ephemeral).
 *   Inbound requests (INVITE/NOTIFY from Yeastar):  prepend a proxy Via so the
 *     binary's 200 OK comes back through localSock; deliver to binaryListenPort.
 *   Outbound responses (binary 200 OK → Yeastar):  strip proxy Via, forward.
 *
 * Port scheme
 * -----------
 *   proxyLocalPort = sipLocalPort + 10000   (e.g. 7062 → 17062)
 *   proxyExtPort   = sipLocalPort + 20000   (e.g. 7062 → 27062)
 *
 * iptables rule added per extension (removed on stop):
 *   iptables -t nat -A OUTPUT -p udp -d <yeastarIp> --dport <yeastarPort>
 *            ! --sport <proxyExtPort>
 *            -j DNAT --to-destination 127.0.0.1:<proxyLocalPort>
 */

import dgram from "dgram";
import dns from "dns/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../lib/logger.js";

const execAsync = promisify(exec);

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

// ── iptables helpers ──────────────────────────────────────────────────────────

/**
 * Return the iptables chain rule (everything after "-A"/"-D") for the DNAT redirect.
 * Excludes source port proxyExtPort so the proxy's own extSock is never redirected.
 *
 * Full command example:
 *   iptables -t nat -A OUTPUT -p udp -d 52.47.94.244 --dport 5060
 *            ! --sport 27062 -j DNAT --to-destination 127.0.0.1:17062
 */
function iptablesChainRule(
  yeastarIp: string, yeastarPort: number,
  proxyExtPort: number, proxyLocalPort: number,
): string {
  return `OUTPUT -p udp -d ${yeastarIp} --dport ${yeastarPort} ! --sport ${proxyExtPort} -j DNAT --to-destination 127.0.0.1:${proxyLocalPort}`;
}

async function runIptables(verb: "-A" | "-D", chainRule: string, extensionId: number): Promise<void> {
  const fullCmd = `iptables -t nat ${verb} ${chainRule}`;
  try {
    await execAsync(fullCmd);
    logger.info({ extensionId, cmd: fullCmd },
      `SIP proxy: iptables rule ${verb === "-A" ? "added" : "removed"}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (verb === "-D" && /No chain\/target\/match|does not exist/i.test(msg)) return; // already gone
    logger.warn({ extensionId, cmd: fullCmd, err },
      `SIP proxy: iptables ${verb === "-A" ? "add" : "remove"} failed — ${msg.trim()}` +
      (verb === "-A" ? ". Binary will bypass proxy. Run the service as root or grant CAP_NET_ADMIN." : ""));
  }
}

/**
 * Enable loopback routing so OUTPUT-chain iptables DNAT to 127.0.0.1 works.
 *
 * By default net.ipv4.conf.lo.route_localnet=0, which means the kernel silently
 * drops packets whose destination was rewritten to 127.x.x.x by DNAT in the
 * OUTPUT chain (they originated on a non-loopback interface so the kernel won't
 * route them to loopback).  Setting route_localnet=1 on the loopback interface
 * allows this routing and is required for our iptables DNAT proxy to work.
 */
async function enableRouteLocalnet(): Promise<void> {
  for (const iface of ["lo", "all"]) {
    try {
      await execAsync(`sysctl -w net.ipv4.conf.${iface}.route_localnet=1`);
      logger.info({ iface }, "SIP proxy: route_localnet enabled");
    } catch (err) {
      logger.warn({ iface, err }, "SIP proxy: could not set route_localnet (non-fatal — proxy may not intercept)");
    }
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
  localSock: dgram.Socket;   // DNAT target: 127.0.0.1:proxyLocalPort
  extSock: dgram.Socket;     // talks to Yeastar: 0.0.0.0:proxyExtPort
  proxyLocalPort: number;
  proxyExtPort: number;      // known source port → excluded from DNAT rule
  binaryListenPort: number;  // binary's static SIP listen port (e.g. 7062)
  yeastarIp: string;
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
  proxyExtPort: number;
  yeastarServer: string;
  publicIp: string;       // kept for compatibility; not used in rewriting
}): Promise<void> {
  const { extensionId, sipLocalPort, proxyLocalPort, proxyExtPort, yeastarServer } = params;
  await stopSipProxy(extensionId);

  // Parse Yeastar host:port
  const colonIdx = yeastarServer.lastIndexOf(":");
  const yeastarHost = colonIdx > 0 ? yeastarServer.slice(0, colonIdx) : yeastarServer;
  const yeastarPort = colonIdx > 0 ? (Number(yeastarServer.slice(colonIdx + 1)) || 5060) : 5060;

  // Resolve FQDN → IP for stable routing and iptables rule
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

  // Bind localSock — DNAT redirects binary packets here
  try {
    await bindSock(localSock, proxyLocalPort, "127.0.0.1");
  } catch (err) {
    await closeSock(localSock).catch(() => {});
    await closeSock(extSock).catch(() => {});
    throw new Error(`SIP proxy: localSock bind failed for ext ${extensionId}: ${(err as Error).message}`);
  }

  // Bind extSock to known port — this port is excluded from the DNAT rule so
  // the proxy's own traffic to Yeastar is not redirected back to itself.
  try {
    await bindSock(extSock, proxyExtPort, "0.0.0.0");
  } catch (err) {
    await closeSock(localSock).catch(() => {});
    await closeSock(extSock).catch(() => {});
    throw new Error(`SIP proxy: extSock bind failed for ext ${extensionId} on port ${proxyExtPort}: ${(err as Error).message}`);
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
            from: `127.0.0.1:${rinfo.port}`, to: `${s.yeastarIp}:${s.yeastarPort}`,
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
    binaryListenPort: sipLocalPort, yeastarIp, yeastarPort,
  }, "SIP FQDN proxy started — adding iptables DNAT rule");

  // Add iptables DNAT rule to intercept the binary's outbound UDP to Yeastar.
  // Necessary because sipgo routes by RFC 3263 (resolves Request-URI host),
  // ignoring the "server" config field we set to 127.0.0.1:proxyLocalPort.
  //
  // route_localnet must be enabled so the kernel will deliver DNAT-redirected
  // packets (destination rewritten to 127.0.0.1) back to our local socket.
  // Without it the kernel silently drops them after the DNAT rewrite.
  await enableRouteLocalnet();
  const ipt = iptablesChainRule(yeastarIp, yeastarPort, proxyExtPort, proxyLocalPort);
  await runIptables("-A", ipt, extensionId);
}

export async function stopSipProxy(extensionId: number): Promise<void> {
  const s = proxies.get(extensionId);
  if (!s) return;
  proxies.delete(extensionId);

  // Remove iptables rule first, then close sockets
  const ipt = iptablesChainRule(s.yeastarIp, s.yeastarPort, s.proxyExtPort, s.proxyLocalPort);
  await runIptables("-D", ipt, extensionId);
  await Promise.all([closeSock(s.localSock), closeSock(s.extSock)]);
  logger.info({ extensionId }, "SIP FQDN proxy stopped");
}

export function isSipProxyActive(extensionId: number): boolean {
  return proxies.has(extensionId);
}
