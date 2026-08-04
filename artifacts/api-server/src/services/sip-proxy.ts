/**
 * SIP FQDN Proxy — fixes the "ephemeral source port" NAT problem in the
 * sip-agent binary when connecting to a Yeastar PBX via a public FQDN.
 *
 * Root cause
 * ----------
 * When `sip.server` is an FQDN, the sipgo library resolves the hostname and
 * opens a new ephemeral UDP socket to send the REGISTER.  That socket's source
 * port (e.g. 52768) is different from the binary's SIP listen port (e.g. 7060).
 * Yeastar's NAT ALG detects the Via/Contact port mismatch and rewrites the
 * registered Contact from :7060 → :52768.  Subsequent inbound INVITEs are
 * then sent to port 52768 — but that ephemeral socket is closed, so they are
 * lost.
 *
 * Fix
 * ---
 * Instead of connecting the binary directly to the FQDN, we:
 *  1. Start this proxy, which binds two UDP sockets:
 *       • localSock  — 127.0.0.1:proxyLocalPort  (binary talks to this)
 *       • extSock    — 0.0.0.0:proxyExtPort       (proxy talks to Yeastar)
 *  2. Configure the binary's sip.server → 127.0.0.1:proxyLocalPort
 *     The binary connects locally; sipgo uses the same listen socket (no ephemeral).
 *  3. For every REGISTER / outbound request from the binary the proxy:
 *       a. Rewrites Via host:port → publicIp:proxyExtPort
 *       b. Rewrites Contact     → publicIp:proxyExtPort
 *       c. Sends via extSock    (source port = proxyExtPort — always stable)
 *  4. Yeastar sees Via port == Contact port == extSock source port.
 *     No mismatch ⇒ no Contact rewrite ⇒ inbound INVITEs arrive at proxyExtPort.
 *  5. Proxy forwards inbound requests (INVITE, NOTIFY…) to the binary on its
 *     listen port, prepending its own Via so responses route back through the proxy.
 *  6. Proxy forwards responses (200 OK…) stripping the proxy Via and sending
 *     back the correct direction.
 */

import dgram from "dgram";
import dns from "dns/promises";
import { logger } from "../lib/logger.js";

// ── Public IP cache ──────────────────────────────────────────────────────────
let cachedPublicIp: string | null = null;

export async function getPublicIp(): Promise<string> {
  if (cachedPublicIp) return cachedPublicIp;
  try {
    const res = await fetch("https://api.ipify.org?format=text", {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const ip = (await res.text()).trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        cachedPublicIp = ip;
        logger.info({ ip }, "SIP proxy: detected public IP");
        return ip;
      }
    }
  } catch (err) {
    logger.warn({ err }, "SIP proxy: could not detect public IP from ipify");
  }
  // Fallback: try ipinfo.io
  try {
    const res = await fetch("https://ipinfo.io/ip", {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const ip = (await res.text()).trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        cachedPublicIp = ip;
        logger.info({ ip }, "SIP proxy: detected public IP (fallback)");
        return ip;
      }
    }
  } catch (err) {
    logger.warn({ err }, "SIP proxy: fallback public IP detection failed");
  }
  throw new Error("Could not determine public IP for SIP FQDN proxy");
}

/** Return true if sipServer is a public hostname that requires the proxy. */
export function needsSipProxy(sipServer: string): boolean {
  const host = sipServer.split(":")[0]!.trim();
  // Raw IPv4 — no proxy needed
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  // Localhost
  if (host === "localhost" || host === "::1") return false;
  // Any hostname containing letters (FQDN / cloud domain)
  return /[a-zA-Z]/.test(host);
}

// ── Port helpers ─────────────────────────────────────────────────────────────
/** Local port the binary connects to (binary→proxy, loopback only). */
export function proxyLocalPortFor(sipLocalPort: number): number {
  return sipLocalPort + 10000;
}

/** External port the proxy binds for Yeastar communication (fixed source port). */
export function proxyExtPortFor(sipLocalPort: number): number {
  return sipLocalPort + 20000;
}

// ── SIP message helpers ──────────────────────────────────────────────────────

/** Case-insensitive header key normaliser (we store everything lowercase). */
function headerKey(k: string): string {
  // Expand compact forms
  const compact: Record<string, string> = {
    v: "via", f: "from", t: "to", m: "contact",
    i: "call-id", l: "content-length", c: "content-type",
  };
  const lower = k.trim().toLowerCase();
  return compact[lower] ?? lower;
}

interface SipMessage {
  firstLine: string;
  /** Ordered list of [normalised-key, original-key, value] tuples (preserves order & multi-values). */
  headerPairs: Array<[string, string, string]>;
  body: string;
  raw: string;
}

function parseSipMessage(buf: Buffer): SipMessage | null {
  const raw = buf.toString("utf8");
  // Find the blank line separating headers from body
  const sep = raw.match(/\r?\n\r?\n/);
  if (!sep || sep.index === undefined) return null;
  const headerSection = raw.slice(0, sep.index);
  const body = raw.slice(sep.index + sep[0].length);
  const lines = headerSection.split(/\r?\n/);
  const firstLine = lines[0] ?? "";
  const headerPairs: Array<[string, string, string]> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    // Handle continuation lines (lines starting with whitespace)
    if (/^[ \t]/.test(line) && headerPairs.length > 0) {
      headerPairs[headerPairs.length - 1]![2] += " " + line.trim();
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const origKey = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    headerPairs.push([headerKey(origKey), origKey, value]);
  }
  return { firstLine, headerPairs, body, raw };
}

function rebuildSipMessage(msg: SipMessage): Buffer {
  let text = msg.firstLine + "\r\n";
  for (const [, origKey, value] of msg.headerPairs) {
    text += `${origKey}: ${value}\r\n`;
  }
  text += "\r\n" + msg.body;
  return Buffer.from(text, "utf8");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace all occurrences of `from` with `to` in a header value. */
function replaceAddr(val: string, fromAddr: string, toAddr: string): string {
  return val.replace(new RegExp(escapeRegex(fromAddr), "g"), toAddr);
}

/** Generate a random Via branch parameter. */
function randomBranch(): string {
  return "z9hG4bKproxy" + Math.random().toString(36).slice(2, 10);
}

/** Return true if the SIP first line is a request (not a response). */
function isSipRequest(firstLine: string): boolean {
  return !firstLine.startsWith("SIP/2.0");
}

// ── Proxy state ──────────────────────────────────────────────────────────────

interface ProxyState {
  localSock: dgram.Socket;                         // binary → proxy
  extSock: dgram.Socket;                           // proxy → Yeastar
  binaryListenPort: number;                        // binary's own SIP listen port
  yeastarIp: string;                               // resolved FQDN IP
  yeastarPort: number;
  publicIp: string;
  proxyExtPort: number;
  proxyLocalPort: number;
  /** Last seen source port of outbound packets from the binary (may differ from listen port). */
  lastBinarySourcePort: number;
}

const activeProxies = new Map<number, ProxyState>();

// ── Rewrite logic ─────────────────────────────────────────────────────────────

/**
 * Rewrite an OUTBOUND message (binary → Yeastar).
 * Replaces binary's local address references with proxy's public ext address,
 * ensuring Via.port == Contact.port == proxyExtPort (no NAT ALG rewrite).
 */
function rewriteOutbound(msg: SipMessage, state: ProxyState, binarySourcePort: number): Buffer {
  const binaryLocal = `127.0.0.1:${binarySourcePort}`;
  const proxyPublic = `${state.publicIp}:${state.proxyExtPort}`;

  const newPairs: Array<[string, string, string]> = msg.headerPairs.map(([nk, ok, val]) => {
    if (nk === "via") {
      val = replaceAddr(val, binaryLocal, proxyPublic);
      // Also replace bare IP:port if binary uses its actual local IP
      val = replaceAddr(val, `127.0.0.1:${state.binaryListenPort}`, proxyPublic);
    }
    if (nk === "contact") {
      val = replaceAddr(val, binaryLocal, proxyPublic);
      val = replaceAddr(val, `127.0.0.1:${state.binaryListenPort}`, proxyPublic);
    }
    return [nk, ok, val];
  });

  return rebuildSipMessage({ ...msg, headerPairs: newPairs });
}

/**
 * Rewrite an INBOUND response (Yeastar → binary).
 * Reverses the proxy's public ext address back to the binary's local address
 * so the binary's SIP stack recognises its own Via and Contact.
 */
function rewriteInboundResponse(msg: SipMessage, state: ProxyState): Buffer {
  const proxyPublic = `${state.publicIp}:${state.proxyExtPort}`;
  const binaryLocal = `127.0.0.1:${state.binaryListenPort}`;

  const newPairs: Array<[string, string, string]> = msg.headerPairs.map(([nk, ok, val]) => {
    if (nk === "via") {
      val = replaceAddr(val, proxyPublic, binaryLocal);
    }
    if (nk === "contact") {
      // Do NOT rewrite Contact in responses from Yeastar — binary doesn't need to see its own address there
    }
    return [nk, ok, val];
  });

  return rebuildSipMessage({ ...msg, headerPairs: newPairs });
}

/**
 * Rewrite an INBOUND request (INVITE/NOTIFY from Yeastar → binary).
 * Prepends a proxy Via so the binary's 200 OK comes back to our localSock.
 * Rewrites the Request-URI host from proxy's public addr to binary's local addr.
 */
function rewriteInboundRequest(msg: SipMessage, state: ProxyState): Buffer {
  const proxyVia = `SIP/2.0/UDP 127.0.0.1:${state.proxyLocalPort};branch=${randomBranch()}`;
  // Prepend proxy Via as the first header after any existing top-Via
  let insertedVia = false;
  const newPairs: Array<[string, string, string]> = [];
  for (const [nk, ok, val] of msg.headerPairs) {
    if (nk === "via" && !insertedVia) {
      // Insert proxy Via before the first existing Via
      newPairs.push(["via", "Via", proxyVia]);
      insertedVia = true;
    }
    newPairs.push([nk, ok, val]);
  }
  if (!insertedVia) {
    newPairs.unshift(["via", "Via", proxyVia]);
  }

  // Rewrite Request-URI: replace proxy public addr with binary listen addr
  let firstLine = msg.firstLine;
  const proxyPublicEscaped = escapeRegex(`${state.publicIp}:${state.proxyExtPort}`);
  const binaryLocal = `127.0.0.1:${state.binaryListenPort}`;
  firstLine = firstLine.replace(new RegExp(proxyPublicEscaped, "g"), binaryLocal);

  return rebuildSipMessage({ ...msg, firstLine, headerPairs: newPairs });
}

/**
 * Rewrite a response from binary to Yeastar (stripping the proxy Via).
 */
function rewriteOutboundResponse(msg: SipMessage, state: ProxyState): Buffer {
  const proxyLocalAddr = `127.0.0.1:${state.proxyLocalPort}`;
  // Remove the first Via that belongs to the proxy
  let removedProxyVia = false;
  const newPairs: Array<[string, string, string]> = [];
  for (const [nk, ok, val] of msg.headerPairs) {
    if (nk === "via" && !removedProxyVia && val.includes(proxyLocalAddr)) {
      removedProxyVia = true;
      continue; // strip this Via
    }
    newPairs.push([nk, ok, val]);
  }
  return rebuildSipMessage({ ...msg, headerPairs: newPairs });
}

// ── Proxy lifecycle ───────────────────────────────────────────────────────────

function bindSocket(sock: dgram.Socket, port: number, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sock.once("error", reject);
    sock.bind(port, address, () => {
      sock.removeListener("error", reject);
      resolve();
    });
  });
}

function closeSocket(sock: dgram.Socket): Promise<void> {
  return new Promise((resolve) => {
    try { sock.close(resolve); } catch { resolve(); }
  });
}

export async function startSipProxy(params: {
  extensionId: number;
  sipLocalPort: number;    // binary's own SIP listen port (e.g. 7060)
  proxyLocalPort: number;  // local port the binary connects to (e.g. 17060)
  proxyExtPort: number;    // external port used to talk to Yeastar (e.g. 27060)
  yeastarServer: string;   // "host" or "host:port"
  publicIp: string;
}): Promise<void> {
  const { extensionId, sipLocalPort, proxyLocalPort, proxyExtPort, yeastarServer, publicIp } = params;

  // Clean up any existing proxy first
  await stopSipProxy(extensionId);

  // Parse Yeastar address
  const colonIdx = yeastarServer.lastIndexOf(":");
  let yeastarHost: string;
  let yeastarPort: number;
  if (colonIdx > 0 && !yeastarServer.includes("[")) {
    yeastarHost = yeastarServer.slice(0, colonIdx);
    yeastarPort = Number(yeastarServer.slice(colonIdx + 1)) || 5060;
  } else {
    yeastarHost = yeastarServer;
    yeastarPort = 5060;
  }

  // Resolve FQDN → IP
  let yeastarIp: string;
  try {
    const addrs = await dns.resolve4(yeastarHost);
    yeastarIp = addrs[0] ?? yeastarHost;
    logger.info({ extensionId, yeastarHost, yeastarIp }, "SIP proxy: resolved Yeastar FQDN");
  } catch (err) {
    logger.warn({ extensionId, yeastarHost, err }, "SIP proxy: DNS resolve failed, using hostname directly");
    yeastarIp = yeastarHost;
  }

  const localSock = dgram.createSocket("udp4");
  const extSock = dgram.createSocket("udp4");

  const state: ProxyState = {
    localSock,
    extSock,
    binaryListenPort: sipLocalPort,
    yeastarIp,
    yeastarPort,
    publicIp,
    proxyExtPort,
    proxyLocalPort,
    lastBinarySourcePort: sipLocalPort,
  };

  try {
    await bindSocket(localSock, proxyLocalPort, "127.0.0.1");
    await bindSocket(extSock, proxyExtPort, "0.0.0.0");
  } catch (err) {
    await closeSocket(localSock).catch(() => {});
    await closeSocket(extSock).catch(() => {});
    throw new Error(`SIP proxy: failed to bind sockets for ext ${extensionId}: ${(err as Error).message}`);
  }

  // ── Binary → Yeastar ───────────────────────────────────────────────────────
  localSock.on("message", (buf, rinfo) => {
    state.lastBinarySourcePort = rinfo.port;
    const parsed = parseSipMessage(buf);
    let outBuf: Buffer;
    if (!parsed) {
      outBuf = buf;
    } else if (!isSipRequest(parsed.firstLine)) {
      // Response from binary (e.g. 200 OK to INVITE routed back via proxy Via)
      outBuf = rewriteOutboundResponse(parsed, state);
    } else {
      outBuf = rewriteOutbound(parsed, state, rinfo.port);
    }
    extSock.send(outBuf, state.yeastarPort, state.yeastarIp, (err) => {
      if (err) logger.warn({ extensionId, err }, "SIP proxy: extSock send error");
    });
    logger.debug({ extensionId, srcPort: rinfo.port, method: parsed?.firstLine.split(" ")[0] },
      "SIP proxy: binary → Yeastar");
  });

  // ── Yeastar → Binary ───────────────────────────────────────────────────────
  extSock.on("message", (buf, rinfo) => {
    const parsed = parseSipMessage(buf);
    let outBuf: Buffer;
    if (!parsed) {
      outBuf = buf;
    } else if (isSipRequest(parsed.firstLine)) {
      // Inbound request (INVITE, NOTIFY, OPTIONS…)
      outBuf = rewriteInboundRequest(parsed, state);
    } else {
      // Response (200 OK to REGISTER, etc.)
      outBuf = rewriteInboundResponse(parsed, state);
    }
    localSock.send(outBuf, state.binaryListenPort, "127.0.0.1", (err) => {
      if (err) logger.warn({ extensionId, err }, "SIP proxy: localSock send error");
    });
    logger.debug({ extensionId, fromIp: rinfo.address, method: parsed?.firstLine.split(" ")[0] },
      "SIP proxy: Yeastar → binary");
  });

  localSock.on("error", (err) => logger.warn({ extensionId, err }, "SIP proxy: localSock error"));
  extSock.on("error", (err) => logger.warn({ extensionId, err }, "SIP proxy: extSock error"));

  activeProxies.set(extensionId, state);
  logger.info({
    extensionId,
    proxyLocalPort,
    proxyExtPort,
    yeastarIp,
    yeastarPort,
    publicIp,
    binaryListenPort: sipLocalPort,
  }, "SIP FQDN proxy started");
}

export async function stopSipProxy(extensionId: number): Promise<void> {
  const state = activeProxies.get(extensionId);
  if (!state) return;
  activeProxies.delete(extensionId);
  await Promise.all([
    closeSocket(state.localSock),
    closeSocket(state.extSock),
  ]);
  logger.info({ extensionId }, "SIP FQDN proxy stopped");
}

export function isSipProxyActive(extensionId: number): boolean {
  return activeProxies.has(extensionId);
}
