import { Router } from "express";
import {
  startExtension,
  stopExtension,
  restartExtension,
  getLogs,
  getStatus,
  getAllStatuses,
  getPersistedCallEvents,
  getRunningExtensionIds,
  getSystemLogs,
  deleteCallByCallId,
  clearAllCallEvents,
} from "../services/deployment.js";

const router = Router();

// GET /api/deploy/system/logs — application-level log buffer
router.get("/deploy/system/logs", (_req, res) => {
  res.json({ lines: getSystemLogs() });
});

// GET /api/deploy/all — status for every deployed extension
router.get("/deploy/all", async (_req, res) => {
  const statuses = await getAllStatuses();
  res.json(statuses);
});

// GET /api/deploy/call-events — persistent call history + live active count
router.get("/deploy/call-events", async (_req, res) => {
  const events = getPersistedCallEvents();
  const runningIds = new Set(getRunningExtensionIds());

  // Active calls: invites without a matching ended, only for extensions still running
  const chronological = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const activeCalls = new Set<string>();
  for (const e of chronological) {
    if (e.event === "invite") {
      // Only track as active if the extension process is still alive
      if (runningIds.has(e.extensionId)) {
        activeCalls.add(`${e.extensionId}:${e.callId}`);
      }
    }
    if (e.event === "ended") {
      activeCalls.delete(`${e.extensionId}:${e.callId}`);
    }
  }

  // Return events sorted newest-first for display
  const sorted = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  res.json({ events: sorted.slice(0, 100), activeCallCount: activeCalls.size });
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

export default router;
