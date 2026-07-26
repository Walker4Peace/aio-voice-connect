import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs/promises";
import net from "net";
import { db, extensionsTable, deploymentsTable, callEventsTable, type Deployment } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const SIP_AGENT_BIN =
  process.env["SIP_AGENT_BIN"] ?? "/home/runner/workspace/.bin/sip-agent";
const CONFIG_DIR = "/tmp/sip-agent";
const MAX_LOG_LINES = 300;
// Ports must be exactly 4 digits so they fit in the binary patch (replaces ':5060').
// Range: 7060–7998 (200 extensions, step 2 for SIP).
const SIP_LOCAL_PORT_START = 7060;
const HTTP_PORT_START = 19000;

type AiProviderKey = "openai" | "elevenlabs" | "gemini" | "deepgram" | "cartesia";

const PROVIDER_ENV_KEYS: Record<AiProviderKey, string> = {
  openai: "OPENAI_API_KEY",
  elevenlabs: "ELEVEN_LABS_API_KEY",
  gemini: "GEMINI_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  cartesia: "CARTESIA_API_KEY",
};

interface ProcessInfo {
  proc: ChildProcess;
  logs: string[];
  startedAt: Date;
}

const processes = new Map<number, ProcessInfo>();
// Keeps the last logs for an extension even after the process exits,
// so crash output is readable from the UI without restarting the extension.
const exitedLogs = new Map<number, string[]>();

// ── Watchdog ───────────────────────────────────────────────────────────────
// Extensions opted-in to automatic restart when the Yeastar server comes back
const watchdogEnabled = new Set<number>();
// Extensions intentionally stopped by the user — watchdog must NOT restart these
const manuallyStopped = new Set<number>();
// Active interval timers pinging the Yeastar server
const watchdogTimers = new Map<number, ReturnType<typeof setInterval>>();
const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function cancelWatchdog(extensionId: number): void {
  const t = watchdogTimers.get(extensionId);
  if (t) {
    clearInterval(t);
    watchdogTimers.delete(extensionId);
  }
}

function pingTcp(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
    sock.on("connect", () => { clearTimeout(timer); sock.destroy(); resolve(true); });
    sock.on("error",   () => { clearTimeout(timer); resolve(false); });
    sock.connect(port, host);
  });
}

async function runWatchdog(extensionId: number): Promise<void> {
  // Already running or manually stopped — nothing to do
  if (processes.has(extensionId) || manuallyStopped.has(extensionId)) {
    cancelWatchdog(extensionId);
    return;
  }
  const ext = await getExtWithRelations(extensionId);
  const sipServer = ext?.client?.sipServer ?? "";
  if (!sipServer) {
    addSystemLog(`Watchdog ext ${extensionId}: no SIP server configured, stopping watchdog`);
    cancelWatchdog(extensionId);
    return;
  }
  const [host, portStr] = sipServer.includes(":") ? sipServer.split(":") : [sipServer, "5060"];
  const port = Number(portStr) || 5060;
  addSystemLog(`Watchdog ext ${extensionId}: pinging ${host}:${port}`);
  const reachable = await pingTcp(host, port);
  if (reachable) {
    addSystemLog(`Watchdog ext ${extensionId}: Yeastar reachable — restarting extension`);
    cancelWatchdog(extensionId);
    startExtension(extensionId).catch((err) => {
      addSystemLog(`Watchdog ext ${extensionId}: restart failed — ${(err as Error).message}`);
      // Schedule a fresh watchdog so we retry on the next window
      scheduleWatchdog(extensionId);
    });
  } else {
    addSystemLog(`Watchdog ext ${extensionId}: Yeastar unreachable, will retry`);
  }
}

function scheduleWatchdog(extensionId: number): void {
  cancelWatchdog(extensionId);
  addSystemLog(`Watchdog ext ${extensionId}: monitoring started (ping every 5 min)`);
  const t = setInterval(() => { runWatchdog(extensionId).catch(() => {}); }, WATCHDOG_INTERVAL_MS);
  watchdogTimers.set(extensionId, t);
}

export function setWatchdogEnabled(extensionId: number, enabled: boolean): void {
  if (enabled) {
    watchdogEnabled.add(extensionId);
  } else {
    watchdogEnabled.delete(extensionId);
    cancelWatchdog(extensionId);
    addSystemLog(`Watchdog ext ${extensionId}: disabled`);
  }
}

export function getWatchdogState(extensionId: number): { enabled: boolean; pinging: boolean } {
  return {
    enabled: watchdogEnabled.has(extensionId),
    pinging: watchdogTimers.has(extensionId),
  };
}

// Persistent call event store — survives extension stop/restart (cleared only on server restart)
const MAX_PERSISTED_EVENTS = 200;
interface PersistedCallEvent {
  extensionId: number;
  callId: string;
  event: "invite" | "answered" | "ended" | "connected_ai" | "error";
  timestamp: string;
  detail?: string;
}
const persistedCallEvents: PersistedCallEvent[] = [];
// Cache of extensionId → agent name, populated when an extension is started
const extensionAgentNames = new Map<number, string>();

/**
 * Normalize a raw SIP Call-ID so invite and bye events always share the same key.
 * SIP Call-IDs can appear as:
 *   abc123
 *   abc123@proxy.domain.com
 *   abc123;tag=from-tag
 * Strip everything from the first @, ;, >, or whitespace.
 */
function normalizeCallId(raw: string): string {
  return raw.split(/[@;>,\s]/)[0];
}

function pushEvent(ev: PersistedCallEvent): void {
  persistedCallEvents.push(ev);
  if (persistedCallEvents.length > MAX_PERSISTED_EVENTS) persistedCallEvents.shift();
  // Persist to DB (fire-and-forget)
  db.insert(callEventsTable).values({
    extensionId: ev.extensionId,
    callId: ev.callId,
    event: ev.event,
    timestamp: new Date(ev.timestamp),
    detail: ev.detail ?? null,
  }).catch(err => logger.error({ err }, "Failed to persist call event to DB"));
}

function parseAndStoreCallEvents(extensionId: number, line: string, timestamp: string): void {
  const body = line.replace(/^\[[^\]]+\]\s*/, "");

  // ── Caller number from SIP Contact header ────────────────────────────────
  // Log line: "Stored remote Contact for dialog: sip:0661209845@1.2.3.4:5060"
  const contactMatch = body.match(/Stored remote Contact for dialog:\s*sip:([^@\s>]+)@/i);
  if (contactMatch) {
    const fromNumber = contactMatch[1];
    // Attach the caller number as detail on the most recent invite for this extension
    for (let i = persistedCallEvents.length - 1; i >= 0; i--) {
      const e = persistedCallEvents[i];
      if (e.extensionId === extensionId && e.event === "invite") {
        e.detail = fromNumber;
        // Also persist to DB so the caller survives restarts
        db.update(callEventsTable)
          .set({ detail: fromNumber })
          .where(and(
            eq(callEventsTable.extensionId, extensionId),
            eq(callEventsTable.callId, e.callId),
            eq(callEventsTable.event, "invite"),
          ))
          .catch(err => logger.error({ err }, "Failed to update caller number in DB"));
        break;
      }
    }
    return;
  }

  // ── Incoming INVITE ──────────────────────────────────────────────────────
  const inviteMatch = body.match(/INVITE received for call:\s*(\S+)/i);
  if (inviteMatch) {
    pushEvent({ extensionId, callId: normalizeCallId(inviteMatch[1]), event: "invite", timestamp });
    return;
  }

  // ── Call ended / BYE ─────────────────────────────────────────────────────
  const byeMatch = body.match(/(?:Call ended|BYE received for call).*?:\s*(\S+)/i);
  if (byeMatch) {
    const callId = normalizeCallId(byeMatch[1]);
    // Deduplicate: skip if an ended event already exists for this call
    const alreadyEnded = persistedCallEvents.some(
      e => e.extensionId === extensionId && e.callId === callId && e.event === "ended"
    );
    if (!alreadyEnded) {
      pushEvent({ extensionId, callId, event: "ended", timestamp });
    }
    return;
  }

  // ── AI provider connected ────────────────────────────────────────────────
  const connMatch = body.match(/Connected to .+AI/i);
  if (connMatch) {
    const prevInvite = [...persistedCallEvents].reverse().find(e => e.extensionId === extensionId && e.event === "invite");
    // Strip leading "YYYY/MM/DD HH:MM:SS " timestamp from the raw log body
    const cleaned = body.replace(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /, "");
    const agentName = extensionAgentNames.get(extensionId);
    const detail = agentName ? `${cleaned} - ${agentName}` : cleaned;
    pushEvent({ extensionId, callId: prevInvite?.callId ?? "unknown", event: "connected_ai", timestamp, detail });
    return;
  }

  // ── AI utterance line ────────────────────────────────────────────────────
  const aiMatch = body.match(/^AI:\s*(.+)/);
  if (aiMatch) {
    const prevInvite = [...persistedCallEvents].reverse().find(e => e.extensionId === extensionId && e.event === "invite");
    pushEvent({ extensionId, callId: prevInvite?.callId ?? "unknown", event: "connected_ai", timestamp, detail: aiMatch[1] });
  }
}

/** On extension stop, synthesize `ended` events for any call that has an invite but no ended,
 *  so they never ghost as "active" after restart. */
function closeOutstandingCalls(extensionId: number): void {
  const timestamp = new Date().toISOString();
  // Find all call IDs for this extension that have an invite but no ended event
  const inviteIds = new Set<string>();
  const endedIds = new Set<string>();
  for (const e of persistedCallEvents) {
    if (e.extensionId !== extensionId) continue;
    if (e.event === "invite") inviteIds.add(e.callId);
    if (e.event === "ended") endedIds.add(e.callId);
  }
  for (const callId of inviteIds) {
    if (!endedIds.has(callId)) {
      persistedCallEvents.push({ extensionId, callId, event: "ended", timestamp, detail: "extension stopped" });
      if (persistedCallEvents.length > MAX_PERSISTED_EVENTS) persistedCallEvents.shift();
    }
  }
}

export function getPersistedCallEvents(): PersistedCallEvent[] {
  return persistedCallEvents;
}

export async function deleteCallByCallId(callId: string): Promise<void> {
  // Remove from memory
  const before = persistedCallEvents.length;
  for (let i = persistedCallEvents.length - 1; i >= 0; i--) {
    if (persistedCallEvents[i]!.callId === callId) persistedCallEvents.splice(i, 1);
  }
  logger.info({ callId, removed: before - persistedCallEvents.length }, "Deleted call from memory");
  // Remove from DB
  await db.delete(callEventsTable).where(eq(callEventsTable.callId, callId));
}

export async function clearAllCallEvents(): Promise<void> {
  persistedCallEvents.length = 0;
  await db.delete(callEventsTable);
  logger.info("Cleared all call events");
}

export function getRunningExtensionIds(): number[] {
  return Array.from(processes.keys());
}

function parseRegistration(line: string): "registered" | "error" | null {
  const l = line.toLowerCase();

  // ── Success ────────────────────────────────────────────────────────────
  if (l.includes("registration successful")) return "registered";
  if (l.includes("registr") && (l.includes("success") || l.includes("200 ok"))) return "registered";

  // ── Real errors ────────────────────────────────────────────────────────
  // NOTE: 401 Unauthorized is the normal SIP auth challenge (challenge →
  // re-send with Authorization → 200 OK).  Do NOT treat it as an error.
  if (l.includes("registration failed")) return "error";
  if (l.includes("connection refused") || l.includes("no such host")) return "error";
  if (l.includes("address already in use")) return "error";
  if (l.includes("error in sip server")) return "error";
  if (l.includes("403 forbidden") || l.includes("403 not auth")) return "error";
  if (l.includes("panic:") || l.includes("fatal error")) return "error";

  return null;
}

function buildConfig(
  ext: Awaited<ReturnType<typeof getExtWithRelations>>,
  extensionId: number,
  ports: { sipLocalPort: number; httpPort: number },
) {
  if (!ext?.agentConfig) return null;
  const cfg = ext.agentConfig;
  // SIP domain and server now come from the linked IPBX (client)
  const sipDomain = ext.client?.sipDomain ?? "";
  const sipServer = ext.client?.sipServer ?? "";
  // Each extension gets unique ports so multiple instances can coexist:
  //   api_port  19000 + id  (sip-agent's own HTTP API, unused by us but must not conflict)
  //   sip.listen  25060 + id  (local UDP port the SIP stack binds for send/receive)
  // api_port: use a unique port per extension to avoid conflicts with the
  // Express API server (8080) and other extension instances.
  const base: Record<string, unknown> = {
    mode: cfg.mode ?? "inbound",
    api_port: ports.httpPort,
    provider: cfg.provider,
    sip: {
      username: ext.sipUsername,
      auth_id: ext.sipAuthId,
      password: ext.sipPassword,
      domain: sipDomain,
      server: sipServer,
       // The Yeastar server stays on its configured port (normally 5060).
       // `listen` is the local SIP socket and is unique per extension.
       listen: ports.sipLocalPort,
    },
  };
  // API keys are NOT embedded in config.json — passed via environment variables only.
  switch (cfg.provider as AiProviderKey) {
    case "openai":
      base["openai"] = {
        model: cfg.modelId ?? "gpt-4o-realtime-preview",
        voice: cfg.voiceId ?? "alloy",
        ...(cfg.systemPrompt ? { instructions: cfg.systemPrompt } : {}),
        ...(cfg.greeting ? { greeting: cfg.greeting } : {}),
      };
      break;
    case "elevenlabs":
      base["elevenlabs"] = {
        agent_id: cfg.modelId ?? "",
        ...(cfg.greeting ? { first_message: cfg.greeting } : {}),
        ...(cfg.systemPrompt ? { system_prompt: cfg.systemPrompt } : {}),
      };
      break;
    case "gemini":
      base["gemini"] = {
        model: cfg.modelId ?? "gemini-2.0-flash-live-001",
        voice: cfg.voiceId ?? "Puck",
        ...(cfg.language ? { language: cfg.language } : {}),
        ...(cfg.systemPrompt ? { system_prompt: cfg.systemPrompt } : {}),
        ...(cfg.greeting ? { greeting: cfg.greeting } : {}),
      };
      break;
    case "deepgram":
      base["deepgram"] = {
        model: cfg.modelId ?? "aura-2-thalia-en",
        ...(cfg.voiceId ? { listen_model: cfg.voiceId } : {}),
        ...(cfg.systemPrompt ? { system_prompt: cfg.systemPrompt } : {}),
        ...(cfg.language ? { language: cfg.language } : {}),
      };
      break;
    case "cartesia":
      base["cartesia"] = {
        voice_id: cfg.voiceId ?? "",
        model: cfg.modelId ?? "sonic-2",
        ...(cfg.language ? { language: cfg.language } : {}),
        ...(cfg.systemPrompt ? { system_prompt: cfg.systemPrompt } : {}),
      };
      break;
  }
  if (cfg.extraConfig) {
    try { Object.assign(base, JSON.parse(cfg.extraConfig)); } catch { /* ignore */ }
  }
  return base;
}

function serviceNameFor(ext: NonNullable<Awaited<ReturnType<typeof getExtWithRelations>>>): string {
  const suffix = ext.extensionNumber.replace(/[^a-zA-Z0-9_.@-]/g, "-");
  return `sip-agent-${suffix || ext.id}`;
}

function buildEnv(ext: NonNullable<Awaited<ReturnType<typeof getExtWithRelations>>>, configPath: string): Record<string, string> {
  const cfg = ext.agentConfig!;
  const providerKey = PROVIDER_ENV_KEYS[cfg.provider as AiProviderKey] ?? "AI_API_KEY";
  return {
    CONFIG_FILE: configPath,
    SIP_USERNAME: ext.sipUsername,
    SIP_AUTH_ID: ext.sipAuthId,
    SIP_PASSWORD: ext.sipPassword,
    SIP_DOMAIN: ext.client?.sipDomain ?? "",
    SIP_SERVER: ext.client?.sipServer ?? "",
    [providerKey]: cfg.apiKey,
  };
}

async function getExtWithRelations(extensionId: number) {
  return db.query.extensionsTable.findFirst({
    where: eq(extensionsTable.id, extensionId),
    with: { agentConfig: true, client: true },
  });
}

async function upsertDeployment(extensionId: number, patch: Partial<Omit<Deployment, "id" | "extensionId" | "createdAt">>) {
  const existing = await db.query.deploymentsTable.findFirst({
    where: eq(deploymentsTable.extensionId, extensionId),
  });
  const now = new Date();
  if (existing) {
    await db.update(deploymentsTable)
      .set({ ...patch, updatedAt: now })
      .where(eq(deploymentsTable.extensionId, extensionId));
  } else {
    await db.insert(deploymentsTable).values({
      extensionId,
      status: "stopped",
      sipRegistered: false,
      ...patch,
      updatedAt: now,
    });
  }
}

/**
 * Copy the sip-agent binary for this extension and patch the first ':5060'
 * occurrence (the local SIP listener default) to ':XXXX' where XXXX is the
 * allocated 4-digit port.  The binary is statically linked Go so LD_PRELOAD
 * cannot intercept its syscalls — per-extension binary patching is the only
 * reliable solution.
 */
async function getPatchedBinary(extensionId: number, sipLocalPort: number): Promise<string> {
  const portStr = String(sipLocalPort);
  if (portStr.length !== 4) {
    throw new Error(
      `SIP local port must be exactly 4 digits for binary patching (got ${sipLocalPort}). ` +
      `Ports are allocated starting at ${SIP_LOCAL_PORT_START}.`
    );
  }

  const patchedPath = path.join(CONFIG_DIR, String(extensionId), "sip-agent");

  const original = await fs.readFile(SIP_AGENT_BIN);
  const patched = Buffer.from(original);

  const needle = Buffer.from(":5060");
  const idx = patched.indexOf(needle);
  if (idx === -1) {
    // Binary doesn't hard-code :5060 — copy as-is and let config drive the port.
    logger.warn({ extensionId }, "sip-agent binary does not contain ':5060' literal; using unpatched copy");
    await fs.writeFile(patchedPath, patched, { mode: 0o755 });
    return patchedPath;
  }

  // Patch in-place: ':5060' → ':{portStr}' (same byte length: 5 bytes each)
  Buffer.from(":" + portStr).copy(patched, idx);
  logger.info({ extensionId, sipLocalPort, offset: idx }, "Patched sip-agent binary local SIP port");

  await fs.writeFile(patchedPath, patched, { mode: 0o755 });
  return patchedPath;
}

async function allocatePorts(extensionId: number): Promise<{ sipLocalPort: number; httpPort: number }> {
  const existing = await db.query.deploymentsTable.findFirst({
    where: eq(deploymentsTable.extensionId, extensionId),
  });

  // Accept stored ports only if they are exactly 4 digits (required for binary patching).
  // Previously allocated 5-digit ports (e.g. 25060) are discarded and reallocated.
  const storedSip = existing?.sipLocalPort;
  const storedHttp = existing?.httpPort;
  if (storedSip && storedSip >= 1000 && storedSip <= 9999 && storedHttp) {
    return { sipLocalPort: storedSip, httpPort: storedHttp };
  }

  const rows = await db.select({
    sipLocalPort: deploymentsTable.sipLocalPort,
    httpPort: deploymentsTable.httpPort,
  }).from(deploymentsTable);

  // Only consider valid 4-digit ports as "used"
  const usedSipPorts = new Set(rows.flatMap(row =>
    row.sipLocalPort && row.sipLocalPort >= 1000 && row.sipLocalPort <= 9999 ? [row.sipLocalPort] : []
  ));
  const usedHttpPorts = new Set(rows.flatMap(row => row.httpPort ? [row.httpPort] : []));

  let sipLocalPort = SIP_LOCAL_PORT_START;
  while (usedSipPorts.has(sipLocalPort)) sipLocalPort += 2;
  let httpPort = HTTP_PORT_START;
  while (usedHttpPorts.has(httpPort)) httpPort += 1;
  return { sipLocalPort, httpPort };
}

export async function startExtension(extensionId: number): Promise<void> {
  addSystemLog(`Starting extension ${extensionId}`);
  // Clear manual-stop flag so watchdog can fire after future crashes
  manuallyStopped.delete(extensionId);
  // Cancel any pending watchdog ping (we're starting fresh)
  cancelWatchdog(extensionId);

  const ext = await getExtWithRelations(extensionId);
  if (!ext) throw new Error("Extension not found");
  if (!ext.agentConfig) throw new Error("No AI agent config assigned. Select an Agent in the extension settings first.");
  extensionAgentNames.set(extensionId, ext.agentConfig.name);
  if (!ext.client?.sipDomain || !ext.client?.sipServer) {
    throw new Error("IPBX SIP Domain and SIP Server must be configured on the linked IPBX before deploying.");
  }

  // Stop existing process if running
  if (processes.has(extensionId)) {
    await stopExtension(extensionId);
    await new Promise(r => setTimeout(r, 500));
  }

  // Write config.json
  const configDir = path.join(CONFIG_DIR, String(extensionId));
  await fs.mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, "config.json");
  const { sipLocalPort, httpPort } = await allocatePorts(extensionId);
  const serviceName = serviceNameFor(ext);
  const config = buildConfig(ext, extensionId, { sipLocalPort, httpPort });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  const env = buildEnv(ext, configPath);

  await upsertDeployment(extensionId, {
    status: "starting",
    pid: null,
    sipLocalPort,
    httpPort,
    serviceName,
    sipRegistered: false,
    lastStartedAt: new Date(),
    lastError: null,
  });

  // Patch a per-extension copy of the binary so its hardcoded ':5060' local
  // SIP listener becomes the allocated port.  The binary is statically linked
  // Go, so LD_PRELOAD cannot intercept its syscalls.
  const patchedBin = await getPatchedBinary(extensionId, sipLocalPort);
  logger.info({ extensionId, patchedBin, sipLocalPort }, "Spawning patched sip-agent");

  // stdbuf forces line-buffered stdout/stderr so log lines (including BYE events)
  // are delivered to this process immediately instead of waiting for the buffer to
  // fill or the child process to exit.
  const proc = spawn("stdbuf", ["-oL", "-eL", patchedBin], {
    env: {
      ...process.env,
      ...env,
      SIP_LOCAL_PORT: String(sipLocalPort),
      HTTP_PORT: String(httpPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const info: ProcessInfo = { proc, logs: [], startedAt: new Date() };
  processes.set(extensionId, info);

  await upsertDeployment(extensionId, {
    status: "starting",
    pid: proc.pid ?? null,
    sipLocalPort,
    httpPort,
    serviceName,
  });

  const handleData = (data: Buffer) => {
    const lines = data.toString().split("\n").map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const timestamp = new Date().toISOString();
      const entry = `[${timestamp}] ${line}`;
      info.logs.push(entry);
      if (info.logs.length > MAX_LOG_LINES) info.logs.shift();

      // Parse and persist call events so history survives extension stop
      parseAndStoreCallEvents(extensionId, line, timestamp);

      const reg = parseRegistration(line);
      if (reg === "registered") {
        // Clear lastError when registration succeeds so the UI shows clean status
        upsertDeployment(extensionId, { status: "registered", sipRegistered: true, lastError: null }).catch(() => {});
      } else if (reg === "error") {
        upsertDeployment(extensionId, { status: "error", lastError: line }).catch(() => {});
      }
    }
  };

  proc.stdout?.on("data", handleData);
  proc.stderr?.on("data", handleData);

  proc.on("exit", (code, signal) => {
    // Preserve logs so crash output stays readable after the process is gone
    const dying = processes.get(extensionId);
    if (dying) exitedLogs.set(extensionId, [...dying.logs]);
    processes.delete(extensionId);
    const wasKilled = signal === "SIGTERM" || signal === "SIGKILL";
    const status = wasKilled ? "stopped" : code === 0 ? "stopped" : "error";
    const lastError = (!wasKilled && code !== 0) ? `Process exited with code ${code}` : null;
    logger.info({ extensionId, code, signal }, "sip-agent process exited");
    upsertDeployment(extensionId, { status, pid: null, lastStoppedAt: new Date(), lastError, sipRegistered: false }).catch(() => {});

    // Watchdog: if this was an unexpected crash (not a manual stop) and watchdog is on, start pinging
    if (!manuallyStopped.has(extensionId) && watchdogEnabled.has(extensionId)) {
      scheduleWatchdog(extensionId);
    }
  });

  proc.on("error", (err) => {
    processes.delete(extensionId);
    logger.error({ extensionId, err }, "sip-agent process error");
    upsertDeployment(extensionId, { status: "error", pid: null, lastError: err.message, sipRegistered: false }).catch(() => {});
  });
}

export async function stopExtension(extensionId: number): Promise<void> {
  addSystemLog(`Stopping extension ${extensionId}`);
  // Mark as intentionally stopped so watchdog doesn't restart it
  manuallyStopped.add(extensionId);
  cancelWatchdog(extensionId);
  // Close any outstanding calls so they don't ghost as "active" after restart
  closeOutstandingCalls(extensionId);

  const info = processes.get(extensionId);
  if (!info) {
    await upsertDeployment(extensionId, { status: "stopped", pid: null, sipRegistered: false, lastStoppedAt: new Date() });
    return;
  }
  info.proc.kill("SIGTERM");
  processes.delete(extensionId);
  await upsertDeployment(extensionId, { status: "stopped", pid: null, sipRegistered: false, lastStoppedAt: new Date() });
}

export async function restartExtension(extensionId: number): Promise<void> {
  await stopExtension(extensionId);
  await new Promise(r => setTimeout(r, 800));
  await startExtension(extensionId);
}

export function getLogs(extensionId: number): string[] {
  return processes.get(extensionId)?.logs ?? exitedLogs.get(extensionId) ?? [];
}

// ── System / application log buffer ────────────────────────────────────────
const MAX_SYSTEM_LOG_LINES = 500;
const systemLogBuffer: string[] = [];

export function addSystemLog(line: string): void {
  const timestamp = new Date().toISOString();
  systemLogBuffer.push(`[${timestamp}] ${line}`);
  if (systemLogBuffer.length > MAX_SYSTEM_LOG_LINES) systemLogBuffer.shift();
}

export function getSystemLogs(): string[] {
  return [...systemLogBuffer];
}

export async function getStatus(extensionId: number) {
  const info = processes.get(extensionId);
  const row = await db.query.deploymentsTable.findFirst({
    where: eq(deploymentsTable.extensionId, extensionId),
  });

  const isAlive = info != null;
  // If DB says running/registered but process is gone, fix it
  if (!isAlive && row && (row.status === "registered" || row.status === "starting")) {
    await upsertDeployment(extensionId, { status: "stopped", pid: null, sipRegistered: false });
    return {
      extensionId,
      status: "stopped" as const,
      pid: null,
      sipLocalPort: row.sipLocalPort,
      httpPort: row.httpPort,
      serviceName: row.serviceName,
      sipRegistered: false,
      lastStartedAt: row.lastStartedAt,
      lastStoppedAt: row.lastStoppedAt,
      lastError: row.lastError,
    };
  }

  const uptime = isAlive ? Math.floor((Date.now() - info.startedAt.getTime()) / 1000) : null;

  return {
    extensionId,
    status: row?.status ?? "stopped",
    pid: row?.pid ?? null,
    sipLocalPort: row?.sipLocalPort ?? null,
    httpPort: row?.httpPort ?? null,
    serviceName: row?.serviceName ?? null,
    sipRegistered: row?.sipRegistered ?? false,
    lastStartedAt: row?.lastStartedAt ?? null,
    lastStoppedAt: row?.lastStoppedAt ?? null,
    lastError: row?.lastError ?? null,
    uptimeSeconds: uptime,
  };
}

export async function getAllStatuses() {
  const rows = await db.query.deploymentsTable.findMany();
  return rows.map(row => {
    const info = processes.get(row.extensionId);
    const isAlive = info != null;
    const uptime = isAlive ? Math.floor((Date.now() - info.startedAt.getTime()) / 1000) : null;
    return {
      extensionId: row.extensionId,
      status: isAlive ? row.status : (row.status === "registered" || row.status === "starting" ? "stopped" : row.status),
      pid: row.pid,
      sipLocalPort: row.sipLocalPort,
      httpPort: row.httpPort,
      serviceName: row.serviceName,
      sipRegistered: isAlive ? row.sipRegistered : false,
      lastStartedAt: row.lastStartedAt,
      lastStoppedAt: row.lastStoppedAt,
      lastError: row.lastError,
      uptimeSeconds: uptime,
    };
  });
}

// On server start, mark any lingering "running" rows as stopped (processes don't survive restarts)
export async function reconcileOnStartup() {
  addSystemLog("Server starting — reconciling deployment state");
  await db.update(deploymentsTable)
    .set({ status: "stopped", pid: null, sipRegistered: false, updatedAt: new Date() })
    .where(eq(deploymentsTable.status, "registered"));
  await db.update(deploymentsTable)
    .set({ status: "stopped", pid: null, sipRegistered: false, updatedAt: new Date() })
    .where(eq(deploymentsTable.status, "starting"));

  // Load recent call events from DB into memory cache
  try {
    const rows = await db.select().from(callEventsTable)
      .orderBy(callEventsTable.timestamp)
      .limit(MAX_PERSISTED_EVENTS);
    for (const row of rows) {
      persistedCallEvents.push({
        extensionId: row.extensionId,
        callId: row.callId,
        event: row.event as PersistedCallEvent["event"],
        timestamp: row.timestamp.toISOString(),
        detail: row.detail ?? undefined,
      });
    }
    logger.info({ count: rows.length }, "Loaded call events from DB");
  } catch (err) {
    logger.error({ err }, "Failed to load call events from DB on startup");
  }

  addSystemLog("Deployment state reconciled on startup");
  logger.info("Deployment state reconciled on startup");
}
