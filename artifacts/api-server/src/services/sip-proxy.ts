/**
 * SIP FQDN Proxy — direct UDP relay for the sip-agent binary.
 *
 * Why this exists
 * ---------------
 * When the PBX server is a public FQDN the binary needs NAT/rport rewriting so
 * Yeastar can reply back through firewalled ports.  We run a local UDP relay and
 * pass its address to the binary as SIP_OUTBOUND_PROXY.  SIP_SERVER (and all SIP
 * headers) continue to reference the real Yeastar FQDN — only the physical UDP
 * path is redirected.
 *
 * Previous approaches (abandoned)
 * --------------------------------
 * 1. iptables DNAT — accumulated 0 packet hits on this VPS.
 * 2. /etc/hosts rewriting — EACCES; service account cannot write /etc/hosts.
 * 3. Rewriting SIP_SERVER to 127.0.0.1:<port> — binary uses the SIP domain for
 *    RFC 3263 routing in some paths, causing Timer_B timeouts.
 *
 * Current approach
 * ----------------
 *   1. Resolve Yeastar FQDN → real IP (DNS, once at start).
 *   2. Bind localSock on 127.0.0.1:<proxyLocalPort>  — no special privileges.
 *   3. Bind extSock   on 0.0.0.0:<proxyExtPort>      — outbound socket to Yeastar.
 *   4. Return "127.0.0.1:<proxyLocalPort>" to caller → set as SIP_OUTBOUND_PROXY.
 *      SIP_SERVER stays as the real FQDN; all packets physically go via the proxy.
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

/** Return true if sipServer is a hostname that requires the FQDN proxy. */
export function needsSipProxy(sipServer: string): boolean {
  const host = sipServer.split(":")[0]!.trim();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false; // raw IPv4
  if (host === "localhost" || host === "::1") return false;
  return /[a-zA-Z]/.test(host); // any FQDN
}

/** Port localSock binds to on 127.0.0.1; used as SIP_OUTBOUND_PROXY by the binary. */
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

/**
 * State captured when the binary sends an outbound INVITE.
 * Used to synthesise the ACK when Yeastar responds with 200 OK
 * (sipgo does not auto-ACK 2xx responses — RFC 3261 §17.1.1.3).
 */
interface InviteRecord {
  fromHdr: string;    // full From header value (with tag)
  cseqNum: string;    // numeric part of CSeq, e.g. "1"
  requestUri: string; // original INVITE Request-URI
  viaIp: string;      // external IP extracted from the binary's Via
}

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
  /**
   * Tracks active outbound INVITE dialogs so the proxy can send the mandatory
   * ACK on 200 OK.  Keyed by Call-ID.  Entry persists through the call lifetime
   * (to re-ACK retransmitted 200 OKs per RFC 3261 §13.2.2.4) and is cleaned up
   * when a BYE is seen on that dialog.
   */
  pendingInvites: Map<string, InviteRecord>;
}

const proxies = new Map<number, ProxyState>();

// ── BYE handlers (outbound + inbound) ────────────────────────────────────────
// When Yeastar sends a BYE the proxy intercepts it on extSock, responds
// 200 OK on behalf of the binary, and fires the appropriate callback so
// deployment.ts can kill the binary (and close the ElevenLabs bridge).
//
// Outbound calls register via setOutboundBYEHandler.
// Inbound  calls register via setInboundBYEHandler.
// In the BYE intercept path both are fired (at most one will be set).
const outboundByeHandlers = new Map<number, () => void>();
const inboundByeHandlers  = new Map<number, () => void>();

/**
 * Register a callback to be fired once when Yeastar sends BYE for an outbound
 * call.  The proxy responds 200 OK automatically so Yeastar is satisfied, then
 * calls the callback so the binary can be terminated.
 */
export function setOutboundBYEHandler(extensionId: number, cb: () => void): void {
  outboundByeHandlers.set(extensionId, cb);
}

/** Remove the outbound BYE handler (called on process exit / stop). */
export function clearOutboundBYEHandler(extensionId: number): void {
  outboundByeHandlers.delete(extensionId);
}

/**
 * Register a callback to be fired once when Yeastar sends BYE for an inbound
 * call (i.e. the remote party / PSTN hung up).  The proxy responds 200 OK
 * automatically so Yeastar is satisfied, then calls the callback so the binary
 * can be terminated and the ElevenLabs bridge closed.
 */
export function setInboundBYEHandler(extensionId: number, cb: () => void): void {
  inboundByeHandlers.set(extensionId, cb);
}

/** Remove the inbound BYE handler (called on process exit / stop). */
export function clearInboundBYEHandler(extensionId: number): void {
  inboundByeHandlers.delete(extensionId);
}

// ── Rewrite helpers ───────────────────────────────────────────────────────────

/**
 * Remove "timer" from a Supported header value.
 * e.g. "replaces, timer" → "replaces"
 *      "timer"           → (header dropped)
 * Prevents Yeastar from activating SIP Session Timers (RFC 4028): the binary
 * never sends a refresh re-INVITE, so leaving "timer" in Supported causes
 * Yeastar to terminate the call ~30 s after answer.
 */
function stripTimerFromSupported(pairs: Array<[string, string, string]>): Array<[string, string, string]> {
  const result: Array<[string, string, string]> = [];
  for (const [nKey, origKey, val] of pairs) {
    if (nKey === "supported") {
      const stripped = val
        .split(",")
        .map(t => t.trim())
        .filter(t => t.toLowerCase() !== "timer")
        .join(", ");
      if (stripped) result.push([nKey, origKey, stripped]);
      // drop the header entirely if "timer" was the only token
      continue;
    }
    result.push([nKey, origKey, val]);
  }
  return result;
}

function rwOutboundReq(msg: SipMsg, s?: ProxyState): Buffer {
  const pairs = stripTimerFromSupported(ensureRport(msg.pairs));

  // ── Rewrite Contact for outbound INVITE requests ────────────────────────
  // The binary's INVITE sets Contact: <sip:user@VPS_IP:binaryPort> where
  // binaryPort is the binary's SIP listen port (e.g. 7062).  When Yeastar
  // sends BYE mid-dialog it targets that Contact address directly, bypassing
  // our proxy extSock (proxyExtPort).  If the VPS firewall blocks that port
  // from Yeastar's side the BYE is silently dropped and the binary never
  // knows the call ended.
  //
  // Fix: replace the host:port in the Contact URI with VPS_IP:proxyExtPort
  // so all mid-dialog requests from Yeastar (BYE, re-INVITE) flow through
  // the proxy just like REGISTER-triggered INVITEs do.  This matches exactly
  // what inbound mode does naturally (the binary registers through the proxy,
  // so Yeastar learns proxyExtPort as the contact address).
  if (s && sipMethod(msg.firstLine) === "INVITE") {
    // Extract the external IP from the Via header (SIP/2.0/UDP ip:port;...)
    const viaVal = pairs.find(([k]) => k === "via")?.[2] ?? "";
    const viaIp  = viaVal.match(/SIP\/2\.0\/UDP\s+([0-9.]+)/i)?.[1] ?? "";
    if (viaIp) {
      const rewritten = pairs.map(([nKey, origKey, val]): [string, string, string] => {
        if (nKey !== "contact") return [nKey, origKey, val];
        // Replace @HOST:PORT inside the Contact URI with @viaIp:proxyExtPort.
        // Handles both <sip:user@host:port> and bare sip:user@host:port forms.
        const newVal = val.replace(/@([^;>\s:,]+):(\d+)/g,
          () => `@${viaIp}:${s.proxyExtPort}`);
        return [nKey, origKey, newVal];
      });
      return rebuild({ ...msg, pairs: rewritten });
    }
  }

  return rebuild({ ...msg, pairs });
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

// ── Auto-response helpers ─────────────────────────────────────────────────────

/**
 * Extract the SIP method from a request first-line, e.g. "INVITE sip:..." → "INVITE".
 * Returns undefined if the message is a response (starts with "SIP/2.0").
 */
function sipMethod(firstLine: string): string | undefined {
  if (firstLine.startsWith("SIP/2.0")) return undefined;
  return firstLine.split(" ")[0]?.toUpperCase();
}

/**
 * Build a minimal but RFC-3261-compliant SIP response for an inbound request.
 *
 * Required headers to echo: Via (all), From, To (add tag if absent), Call-ID, CSeq.
 * OPTIONS 200 OK also carries Allow and Accept so the PBX knows our capabilities.
 */
function buildAutoResponse(
  req: SipMsg,
  statusCode: number,
  reason: string,
  method: string,
): Buffer {
  const ECHO = new Set(["via", "from", "to", "call-id", "cseq"]);
  const pairs: Array<[string, string, string]> = [];

  for (const [nKey, origKey, val] of req.pairs) {
    if (!ECHO.has(nKey)) continue;
    if (nKey === "to" && !val.toLowerCase().includes("tag=")) {
      // Non-provisional responses must add a To tag (RFC 3261 §8.2.6.2)
      const tag = Math.random().toString(36).slice(2, 10);
      pairs.push([nKey, origKey, `${val};tag=${tag}`]);
    } else {
      pairs.push([nKey, origKey, val]);
    }
  }

  if (method === "OPTIONS") {
    // RFC 3261 §11.2 — OPTIONS 200 OK should advertise supported methods
    pairs.push(["allow", "Allow",
      "INVITE, ACK, BYE, CANCEL, OPTIONS, REGISTER, INFO, NOTIFY, SUBSCRIBE"]);
    pairs.push(["accept", "Accept", "application/sdp"]);
    pairs.push(["supported", "Supported", "replaces"]);
  }
  pairs.push(["content-length", "Content-Length", "0"]);

  return rebuild({ firstLine: `SIP/2.0 ${statusCode} ${reason}`, pairs, body: "" });
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
  // Yeastar replies to extSock's source address (server's public IP : proxyExtPort).
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
    pendingInvites: new Map(),
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
      out = rwOutboundReq(msg, s);
    }

    // ── Track outbound INVITEs for ACK synthesis ───────────────────────────
    // When the binary sends an INVITE, record the dialog state we need to build
    // the ACK once Yeastar responds 200 OK.  sipgo auto-ACKs 4xx (same
    // transaction) but never ACKs 2xx (out-of-transaction per RFC 3261
    // §17.1.1.3); the proxy fills that gap.
    if (msg && isRequest(msg.firstLine) && sipMethod(msg.firstLine) === "INVITE") {
      const callId   = msg.pairs.find(([k]) => k === "call-id")?.[2] ?? "";
      const fromHdr  = msg.pairs.find(([k]) => k === "from")?.[2] ?? "";
      const cseqVal  = msg.pairs.find(([k]) => k === "cseq")?.[2] ?? "";
      const cseqNum  = cseqVal.split(/\s+/)[0] ?? "";
      const requestUri = msg.firstLine.split(/\s+/)[1] ?? "";
      const viaVal   = msg.pairs.find(([k]) => k === "via")?.[2] ?? "";
      // Extract bare IP from "SIP/2.0/UDP ip:port;…"
      const viaIp    = viaVal.match(/SIP\/2\.0\/UDP\s+([0-9.]+)/i)?.[1] ?? "";
      if (callId && fromHdr && cseqNum) {
        s.pendingInvites.set(callId, { fromHdr, cseqNum, requestUri, viaIp });
        logger.debug({ extensionId, callId }, "SIP proxy: tracking outbound INVITE for ACK synthesis");
      }
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

    // ── Auto-respond to OPTIONS and NOTIFY at the proxy layer ──────────────
    // The sip-agent binary responds 405 to both because it has no handler for
    // them.  We intercept here, reply 200 OK to Yeastar directly, and do NOT
    // forward to the binary — matching the behaviour of Fanvil, Yeastar Linkus,
    // and other commercial SIP endpoints (RFC 3261 §11.2, RFC 3265 §3.2.2).
    if (msg && isRequest(msg.firstLine)) {
      const method = sipMethod(msg.firstLine);
      if (method === "OPTIONS" || method === "NOTIFY") {
        const resp = buildAutoResponse(msg, 200, "OK", method);
        extSock.send(resp, rinfo.port, rinfo.address, (err) => {
          if (err) {
            logger.warn({ extensionId, method, err }, "SIP proxy: auto-response send error");
          } else {
            logger.info(
              { extensionId, dir: "proxy→Yeastar",
                from: `0.0.0.0:${s.proxyExtPort}`, to: `${rinfo.address}:${rinfo.port}`,
                sip: `SIP/2.0 200 OK (auto: ${method})` },
              "SIP proxy packet",
            );
          }
        });
        return; // do not forward to binary
      }

      // BYE handling — forward to binary for BOTH inbound and outbound calls.
      //
      // The binary has a built-in OnBye handler (outbound.go + inbound handler)
      // that responds 200 OK, cancels the call context, and lets the watchdog
      // goroutine close the ElevenLabs WebSocket so all goroutines exit cleanly.
      // This is identical to the inbound flow, so we use the same path for both:
      //   Yeastar → proxy → binary (binary responds 200 OK → proxy → Yeastar)
      //
      // The old approach for outbound (auto-respond + SIGTERM) caused the binary
      // to get stuck because cancelling the context alone does not unblock a
      // ws.ReadMessage() call in the elevenLabsReader goroutine.  The binary's
      // watchdog goroutine (<-ctx.Done() → b.CloseConnection()) handles this, but
      // only if the binary actually receives the BYE and cancels the context via
      // its own OnBye handler.
      if (method === "BYE") {
        const byeCallId = msg.pairs.find(([k]) => k === "call-id")?.[2] ?? "";
        if (byeCallId) s.pendingInvites.delete(byeCallId);

        const dir = outboundByeHandlers.has(extensionId) ? "outbound" : "inbound";
        logger.info(
          { extensionId, dir: `Yeastar→binary (BYE forward, ${dir})`,
            from: `${rinfo.address}:${rinfo.port}` },
          "SIP proxy: forwarding BYE to binary for internal handling",
        );
        // Fall through to the normal localSock forward path below.
      }
    }

    // ── Synthesise ACK for 200 OK responses to outbound INVITEs ──────────
    // sipgo (UAC) never sends ACK on 2xx responses — only on 4xx (where the
    // library handles it within the same transaction).  For 2xx, RFC 3261
    // §17.1.1.3 requires a brand-new out-of-transaction ACK built by the
    // application layer.  Without it Yeastar retransmits the 200 OK (per
    // T1=0.5s, doubling to T2=4s) until Timer H fires (~32s) and drops the
    // call.  We send the ACK here, from extSock, on behalf of the binary.
    if (msg && !isRequest(msg.firstLine)) {
      const statusCode = parseInt(msg.firstLine.split(/\s+/)[1] ?? "0", 10);
      const cseqHdr   = msg.pairs.find(([k]) => k === "cseq")?.[2] ?? "";
      if (statusCode >= 200 && statusCode < 300 && /INVITE$/i.test(cseqHdr)) {
        const callId = msg.pairs.find(([k]) => k === "call-id")?.[2] ?? "";
        const invite = s.pendingInvites.get(callId);
        if (invite) {
          // Build Request-URI: prefer Contact from 200 OK, fall back to original INVITE URI.
          const contactVal = msg.pairs.find(([k]) => k === "contact")?.[2] ?? "";
          const contactUri = contactVal.match(/<([^>]+)>/)?.[1]
            ?? contactVal.split(";")[0]?.trim();
          const reqUri = contactUri || invite.requestUri;

          // Record-Route (if present) becomes the route set, reversed.
          const recordRoutes = msg.pairs
            .filter(([k]) => k === "record-route")
            .map(([, , v]) => v);

          const toHdr = msg.pairs.find(([k]) => k === "to")?.[2] ?? "";

          // Via: use the binary's external IP + our proxyExtPort so Yeastar
          // delivers any response back to our extSock (ACK has no response,
          // but Via must still be RFC-compliant).
          const viaHost = invite.viaIp
            ? `${invite.viaIp}:${s.proxyExtPort}`
            : `0.0.0.0:${s.proxyExtPort}`;

          const ackPairs: Array<[string, string, string]> = [];
          ackPairs.push(["via", "Via", `SIP/2.0/UDP ${viaHost};branch=${randomBranch()}`]);
          // Route set: Record-Route in reverse order (RFC 3261 §12.1.2)
          for (let i = recordRoutes.length - 1; i >= 0; i--) {
            ackPairs.push(["route", "Route", recordRoutes[i]!]);
          }
          ackPairs.push(["from",           "From",           invite.fromHdr]);
          ackPairs.push(["to",             "To",             toHdr]);
          ackPairs.push(["call-id",        "Call-ID",        callId]);
          ackPairs.push(["cseq",           "CSeq",           `${invite.cseqNum} ACK`]);
          ackPairs.push(["content-length", "Content-Length", "0"]);

          const ackBuf = rebuild({ firstLine: `ACK ${reqUri} SIP/2.0`, pairs: ackPairs, body: "" });

          extSock.send(ackBuf, rinfo.port, rinfo.address, (err) => {
            if (err) {
              logger.warn({ extensionId, callId, err }, "SIP proxy: ACK send error");
            } else {
              logger.info(
                { extensionId, dir: "proxy→Yeastar",
                  from: `0.0.0.0:${s.proxyExtPort}`, to: `${rinfo.address}:${rinfo.port}`,
                  sip: `ACK ${reqUri}` },
                "SIP proxy: sent ACK for outbound INVITE 200 OK",
              );
            }
          });
          // Keep the record so retransmitted 200 OKs are also ACKed
          // (cleaned up when BYE arrives or proxy stops).
        }
      }
    }

    let out: Buffer;
    let destPort: number;

    if (!msg) {
      out = buf;
      destPort = s.binarySrcPort;
    } else if (isRequest(msg.firstLine)) {
      out = rwInboundReq(msg, s);
      destPort = s.binaryListenPort;
    } else {
      // Strip session-timer headers from Yeastar responses before the binary sees them.
      // If the 200 OK carries Session-Expires: 30 the binary starts a session-timer and
      // sends BYE ~30 s later regardless of whether the conversation is still active.
      const filtered: Array<[string, string, string]> = [];
      for (const [nKey, origKey, val] of msg.pairs) {
        // Drop Session-Expires and Min-SE entirely
        if (nKey === "session-expires" || nKey === "min-se") continue;
        // Drop or trim Require: remove "timer" token; drop header if it was the only token
        if (nKey === "require") {
          const trimmed = val.split(",").map(t => t.trim()).filter(t => t.toLowerCase() !== "timer").join(", ");
          if (trimmed) filtered.push([nKey, origKey, trimmed]);
          continue;
        }
        // Strip "timer" from Supported in responses (belt-and-suspenders)
        if (nKey === "supported") {
          const trimmed = val.split(",").map(t => t.trim()).filter(t => t.toLowerCase() !== "timer").join(", ");
          filtered.push([nKey, origKey, trimmed || val]);
          continue;
        }
        filtered.push([nKey, origKey, val]);
      }
      out = rebuild({ ...msg, pairs: filtered });
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
