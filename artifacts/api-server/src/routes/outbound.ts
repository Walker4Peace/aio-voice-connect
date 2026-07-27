/**
 * Outbound Call Routes
 *
 * POST /api/outbound/call        — external apps trigger an outbound call
 * GET  /api/outbound/calls       — list outbound call history (auth required)
 * GET  /api/outbound/calls/:id   — get a specific outbound call (auth required)
 * GET  /api/outbound/context/:extensionId — consumed by sip-agent at call start
 * POST /api/tools/execute        — tool execution callback from sip-agent during a call
 */
import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { db, outboundCallsTable, extensionsTable, deploymentsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { setPendingContext, consumePendingContext } from "../services/outboundContext.js";
import { executeTool } from "../services/toolExecutor.js";

const router = Router();

// ── Auth helpers ─────────────────────────────────────────────────────────────

/** Verify X-Api-Key header against OUTBOUND_API_KEY env var (if configured). */
function checkApiKey(req: import("express").Request): boolean {
  const configured = process.env["OUTBOUND_API_KEY"];
  if (!configured) return true; // No key configured → open (dev mode)
  const provided = req.headers["x-api-key"];
  return provided === configured;
}

// ── Trigger outbound call ────────────────────────────────────────────────────

const triggerSchema = z.object({
  extensionId: z.number().int().positive(),
  phoneNumber: z.string().min(1),
  callerId: z.string().nullable().optional(),
  variables: z.record(z.unknown()).nullable().optional(),
  firstMessage: z.string().nullable().optional(),
  systemPromptOverride: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  webhookUrl: z.string().url().nullable().optional(),
});

router.post("/outbound/call", async (req, res) => {
  if (!checkApiKey(req)) {
    res.status(401).json({ error: "Invalid or missing X-Api-Key header" });
    return;
  }

  const parsed = triggerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;

  // Verify extension exists and is registered
  const ext = await db.query.extensionsTable.findFirst({
    where: eq(extensionsTable.id, data.extensionId),
    with: { agentConfig: true, client: true },
  });

  if (!ext) {
    res.status(400).json({ error: `Extension ${data.extensionId} not found` });
    return;
  }
  if (!ext.agentConfig) {
    res.status(400).json({ error: "Extension has no agent config assigned" });
    return;
  }

  // Check deployment status
  const deployment = await db.query.deploymentsTable.findFirst({
    where: eq(deploymentsTable.extensionId, data.extensionId),
  });
  if (!deployment || deployment.status === "stopped") {
    res.status(400).json({ error: "Extension is not running. Start it before triggering outbound calls." });
    return;
  }

  // Create outbound call record
  const [callRecord] = await db.insert(outboundCallsTable).values({
    extensionId: data.extensionId,
    phoneNumber: data.phoneNumber,
    callerId: data.callerId ?? null,
    variables: data.variables ? JSON.stringify(data.variables) : null,
    firstMessage: data.firstMessage ?? null,
    systemPromptOverride: data.systemPromptOverride ?? null,
    metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    webhookUrl: data.webhookUrl ?? null,
    status: "pending",
  }).returning();

  if (!callRecord) {
    res.status(500).json({ error: "Failed to create outbound call record" });
    return;
  }

  // Store runtime context so sip-agent can retrieve it
  setPendingContext(data.extensionId, {
    callId: callRecord.id,
    firstMessage: data.firstMessage ?? undefined,
    systemPromptOverride: data.systemPromptOverride ?? undefined,
    variables: data.variables ?? undefined,
    webhookUrl: data.webhookUrl ?? undefined,
    createdAt: new Date(),
  });

  // Attempt to trigger the call via Yeastar Make Call API
  const yeastarResult = await tryYeastarMakeCall({
    ext,
    phoneNumber: data.phoneNumber,
    callerId: data.callerId ?? undefined,
  });

  if (yeastarResult.error) {
    // Update status to reflect dial attempt failure
    await db.update(outboundCallsTable)
      .set({ status: "failed", error: yeastarResult.error, updatedAt: new Date() })
      .where(eq(outboundCallsTable.id, callRecord.id));
    res.status(202).json({ ...callRecord, status: "failed", error: yeastarResult.error });
    return;
  }

  // Mark as dialing
  const [updated] = await db.update(outboundCallsTable)
    .set({ status: "dialing", updatedAt: new Date() })
    .where(eq(outboundCallsTable.id, callRecord.id))
    .returning();

  res.status(202).json(updated ?? callRecord);
});

// ── List outbound calls ──────────────────────────────────────────────────────

router.get("/outbound/calls", async (req, res) => {
  const extensionId = req.query["extensionId"] ? Number(req.query["extensionId"]) : undefined;
  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);

  let query = db
    .select()
    .from(outboundCallsTable)
    .orderBy(desc(outboundCallsTable.createdAt))
    .limit(limit);

  if (extensionId && Number.isFinite(extensionId)) {
    query = db
      .select()
      .from(outboundCallsTable)
      .where(eq(outboundCallsTable.extensionId, extensionId))
      .orderBy(desc(outboundCallsTable.createdAt))
      .limit(limit) as typeof query;
  }

  const calls = await query;
  res.json(calls);
});

// ── Get a specific outbound call ─────────────────────────────────────────────

router.get("/outbound/calls/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [call] = await db.select().from(outboundCallsTable).where(eq(outboundCallsTable.id, id));
  if (!call) {
    res.status(404).json({ error: "Outbound call not found" });
    return;
  }
  res.json(call);
});

// ── Delete an outbound call record ───────────────────────────────────────────

router.delete("/outbound/calls/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [deleted] = await db
    .delete(outboundCallsTable)
    .where(eq(outboundCallsTable.id, id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Outbound call not found" });
    return;
  }
  res.json({ success: true, id: deleted.id });
});

// ── Outbound context endpoint (consumed by sip-agent at call start) ──────────

router.get("/outbound/context/:extensionId", (req, res) => {
  const extensionId = Number(req.params["extensionId"]);
  if (!Number.isFinite(extensionId)) {
    res.status(400).json({ error: "Invalid extensionId" });
    return;
  }

  // Consume the pending context (one-time read)
  const ctx = consumePendingContext(extensionId);

  if (!ctx) {
    res.json({ pending: false, firstMessage: null, systemPromptOverride: null, variables: null, callId: null });
    return;
  }

  logger.info({ extensionId, callId: ctx.callId }, "Outbound context consumed by sip-agent");

  res.json({
    pending: true,
    firstMessage: ctx.firstMessage ?? null,
    systemPromptOverride: ctx.systemPromptOverride ?? null,
    variables: ctx.variables ?? null,
    callId: ctx.callId,
  });
});

// ── Tool execution callback (called by sip-agent during a call) ──────────────

const toolExecuteSchema = z.object({
  extensionId: z.number().int().positive(),
  callId: z.string().optional(),
  toolName: z.string().min(1),
  arguments: z.record(z.unknown()).default({}),
});

router.post("/tools/execute", async (req, res) => {
  const parsed = toolExecuteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await executeTool(parsed.data);

  if (!result.success) {
    res.status(422).json({ error: result.error });
    return;
  }

  res.json({ result: result.result });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

interface YeastarCallParams {
  ext: Awaited<ReturnType<typeof db.query.extensionsTable.findFirst>> & {
    agentConfig: NonNullable<unknown>;
    client: NonNullable<unknown> | null;
  };
  phoneNumber: string;
  callerId?: string;
}

async function tryYeastarMakeCall(params: YeastarCallParams): Promise<{ error?: string }> {
  const client = params.ext.client as { yeastarApiUrl?: string | null; yeastarApiToken?: string | null } | null;
  const apiUrl = client?.yeastarApiUrl;
  const apiToken = client?.yeastarApiToken;

  if (!apiUrl || !apiToken) {
    // No Yeastar API configured — log and continue (call stored as pending)
    logger.info({ extensionId: params.ext.id }, "No Yeastar API configured on IPBX — outbound call stored but not dialed");
    return {};
  }

  try {
    const ext = params.ext as { extensionNumber: string };
    const url = `${apiUrl.replace(/\/$/, "")}/api/v2.0.0/call/dial_out`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        caller: ext.extensionNumber,
        callee: params.phoneNumber,
        ...(params.callerId ? { caller_id_number: params.callerId } : {}),
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const text = await response.text();
      logger.error({ status: response.status, body: text }, "Yeastar Make Call API error");
      return { error: `Yeastar API returned ${response.status}: ${text}` };
    }

    logger.info({ extensionId: params.ext.id, phoneNumber: params.phoneNumber }, "Yeastar Make Call API called successfully");
    return {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Yeastar Make Call API request failed");
    return { error: `Failed to reach Yeastar API: ${message}` };
  }
}

export default router;
