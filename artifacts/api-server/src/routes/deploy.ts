import { Router } from "express";
import { db, outboundCallsTable, callEventsTable } from "@workspace/db";
import { inArray, desc } from "drizzle-orm";
import {
  startExtension,
  stopExtension,
  restartExtension,
  getLogs,
  clearExtensionLogs,
  getStatus,
  getAllStatuses,
  getPersistedCallEvents,
  getRunningExtensionIds,
  getSystemLogs,
  clearSystemLogs,
  deleteCallByCallId,
  clearAllCallEvents,
  setWatchdogEnabled,
  getWatchdogState,
} from "../services/deployment.js";

const router = Router();

// GET /api/deploy/system/logs — application-level log buffer
router.get("/deploy/system/logs", (_req, res) => {
  res.json({ lines: getSystemLogs() });
});

// DELETE /api/deploy/system/logs — wipe the in-memory system log buffer
router.delete("/deploy/system/logs", (_req, res) => {
  clearSystemLogs();
  res.json({ ok: true });
});

// GET /api/deploy/all — status for every deployed extension
router.get("/deploy/all", async (_req, res) => {
  const statuses = await getAllStatuses();
  res.json(statuses);
});

// GET /api/deploy/call-events — persistent call history + live active count
router.get("/deploy/call-events", async (_req, res) => {
  // Always read from DB so history survives server restarts.
  // Fall back to in-memory cache if DB is unavailable.
  let dbRows: { extensionId: number; callId: string; event: string; timestamp: Date; detail: string | null }[] = [];
  try {
    dbRows = await db
      .select()
      .from(callEventsTable)
      .orderBy(desc(callEventsTable.timestamp))
      .limit(500);
  } catch {
    // DB unavailable — fall back to in-memory cache
    dbRows = getPersistedCallEvents().map(e => ({
      extensionId: e.extensionId,
      callId: e.callId,
      event: e.event,
      timestamp: new Date(e.timestamp),
      detail: e.detail ?? null,
    }));
  }

  // Merge with any in-memory events not yet flushed to DB
  // (events arrive faster than fire-and-forget inserts complete)
  const dbCallIds = new Set(dbRows.map(r => `${r.extensionId}:${r.callId}:${r.event}:${r.timestamp.getTime()}`));
  const memOnly = getPersistedCallEvents().filter(
    e => !dbCallIds.has(`${e.extensionId}:${e.callId}:${e.event}:${new Date(e.timestamp).getTime()}`)
  );

  type EventRow = { extensionId: number; callId: string; event: string; timestamp: string; detail?: string };
  const events: EventRow[] = [
    ...dbRows.map(r => ({ extensionId: r.extensionId, callId: r.callId, event: r.event, timestamp: r.timestamp.toISOString(), detail: r.detail ?? undefined })),
    ...memOnly.map(e => ({ extensionId: e.extensionId, callId: e.callId, event: e.event, timestamp: e.timestamp, detail: e.detail })),
  ];

  const runningIds = new Set(getRunningExtensionIds());

  // Active calls: invites without a matching ended, only for extensions still running
  const chronological = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const activeCalls = new Set<string>();
  for (const e of chronological) {
    if (e.event === "invite") {
      if (runningIds.has(e.extensionId)) activeCalls.add(`${e.extensionId}:${e.callId}`);
    }
    if (e.event === "ended") activeCalls.delete(`${e.extensionId}:${e.callId}`);
  }

  // Determine which callIds are outbound (triggered via our dial-out API)
  const uniqueCallIds = [...new Set(events.map(e => e.callId))];
  let outboundCalls: { callId: string; phoneNumber: string }[] = [];
  if (uniqueCallIds.length > 0) {
    const rows = await db
      .select({ callId: outboundCallsTable.callId, phoneNumber: outboundCallsTable.phoneNumber })
      .from(outboundCallsTable)
      .where(inArray(outboundCallsTable.callId, uniqueCallIds));
    outboundCalls = rows
      .filter((r): r is { callId: string; phoneNumber: string } => r.callId != null);
  }

  // Return events sorted newest-first for display
  const sorted = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  res.json({ events: sorted.slice(0, 200), activeCallCount: activeCalls.size, outboundCalls });
});

// DELETE /api/deploy/call-events — clear all call history
router.delete("/deploy/call-events", async (_req, res) => {
  await clearAllCallEvents();
  res.json({ ok: true });
});

// DELETE /api/deploy/call-events/:callId — delete a single call's events
router.delete("/deploy/call-events/:callId", async (req, res) => {
  const callId = req.params["callId"];
  if (!callId) {
    res.status(400).json({ error: "Missing callId" });
    return;
  }
  await deleteCallByCallId(callId);
  res.json({ ok: true });
});

// GET /api/deploy/:extensionId/status
router.get("/deploy/:extensionId/status", async (req, res) => {
  const extensionId = Number(req.params["extensionId"]);
  if (!Number.isFinite(extensionId)) {
    res.status(400).json({ error: "Invalid extensionId" });
    return;
  }
  const status = await getStatus(extensionId);
  res.json(status);
});

// GET /api/deploy/:extensionId/logs
router.get("/deploy/:extensionId/logs", async (req, res) => {
  const extensionId = Number(req.params["extensionId"]);
  if (!Number.isFinite(extensionId)) {
    res.status(400).json({ error: "Invalid extensionId" });
    return;
  }
  const lines = getLogs(extensionId);
  res.json({ extensionId, lines });
});

// DELETE /api/deploy/:extensionId/logs — wipe the in-memory log buffer for this extension
router.delete("/deploy/:extensionId/logs", (req, res) => {
  const extensionId = Number(req.params["extensionId"]);
  if (!Number.isFinite(extensionId)) {
    res.status(400).json({ error: "Invalid extensionId" });
    return;
  }
  clearExtensionLogs(extensionId);
  res.json({ ok: true });
});

// POST /api/deploy/:extensionId/start
router.post("/deploy/:extensionId/start", async (req, res) => {
  const extensionId = Number(req.params["extensionId"]);
  if (!Number.isFinite(extensionId)) {
    res.status(400).json({ error: "Invalid extensionId" });
    return;
  }
  await startExtension(extensionId);
  const status = await getStatus(extensionId);
  res.status(200).json(status);
});

// POST /api/deploy/:extensionId/stop
router.post("/deploy/:extensionId/stop", async (req, res) => {
  const extensionId = Number(req.params["extensionId"]);
  if (!Number.isFinite(extensionId)) {
    res.status(400).json({ error: "Invalid extensionId" });
    return;
  }
  await stopExtension(extensionId);
  const status = await getStatus(extensionId);
  res.json(status);
});

// POST /api/deploy/:extensionId/restart
router.post("/deploy/:extensionId/restart", async (req, res) => {
  const extensionId = Number(req.params["extensionId"]);
  if (!Number.isFinite(extensionId)) {
    res.status(400).json({ error: "Invalid extensionId" });
    return;
  }
  await restartExtension(extensionId);
  const status = await getStatus(extensionId);
  res.json(status);
});

// GET /api/deploy/:extensionId/watchdog — get watchdog state
router.get("/deploy/:extensionId/watchdog", (req, res) => {
  const extensionId = Number(req.params["extensionId"]);
  if (!Number.isFinite(extensionId)) {
    res.status(400).json({ error: "Invalid extensionId" });
    return;
  }
  res.json(getWatchdogState(extensionId));
});

// POST /api/deploy/:extensionId/watchdog — enable or disable watchdog
router.post("/deploy/:extensionId/watchdog", (req, res) => {
  const extensionId = Number(req.params["extensionId"]);
  if (!Number.isFinite(extensionId)) {
    res.status(400).json({ error: "Invalid extensionId" });
    return;
  }
  const { enabled } = req.body as { enabled: boolean };
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }
  setWatchdogEnabled(extensionId, enabled);
  res.json(getWatchdogState(extensionId));
});

export default router;
