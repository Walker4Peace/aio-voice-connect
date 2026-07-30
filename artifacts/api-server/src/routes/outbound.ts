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
import { db, outboundCallsTable, extensionsTable, deploymentsTable, type Client, type AgentConfig } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { setPendingContext, consumePendingContext } from "../services/outboundContext.js";
import { applyOutboundConfigAndRestart } from "../services/deployment.js";
import { executeTool } from "../services/toolExecutor.js";
import { getYeastarToken, yeastarPost, evictYeastarToken } from "../services/yeastarAuth.js";
import { waitForCallAnswered } from "../services/yeastarCalls.js";

const router = Router();

// ── Per-extension answer-wait deduplication ───────────────────────────────────
//
// The binary opens TWO ElevenLabs sessions per outbound call (binary behaviour,
// cannot be changed).  Both sessions call GET /api/outbound/context/:extensionId
// within ~200 ms of each other.
//
// Without deduplication:
//   - Both requests independently poll Yeastar (double the API calls)
//   - Both receive firstMessage and both greet simultaneously → double audio
//
// With deduplication:
//   - The first request creates one shared poll Promise; the second reuses it
//   - Only the FIRST request receives the real firstMessage (session 1 greets)
//   - The SECOND request receives firstMessage: null (session 2 starts in
//     listen mode — no greeting, waits for user to speak)
//
// NOTE: This only works correctly when first_message is NOT baked into
// config.json.  deployment.ts omits first_message for outbound restarts so
// that returning null here actually suppresses the second session's greeting.

/** Shared Yeastar poll promise per extensionId (avoids duplicate PBX API calls). */
const pendingAnswerWaits = new Map<number, Promise<boolean>>();

/**
 * Timestamp (ms) when firstMessage was last served for a given extensionId.
 * Used to detect the duplicate session within the dedup window.
 */
const firstMessageServedAt = new Map<number, number>();
const FIRST_MESSAGE_DEDUP_MS = 30_000;

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
  variables: z.record(z.string(), z.unknown()).nullable().optional(),
  firstMessage: z.string().nullable().optional(),
  systemPromptOverride: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
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

  // Store runtime context so sip-agent can retrieve it (kept for compatibility)
  setPendingContext(data.extensionId, {
    callId: callRecord.id,
    firstMessage: data.firstMessage ?? undefined,
    systemPromptOverride: data.systemPromptOverride ?? undefined,
    variables: data.variables ?? undefined,
    webhookUrl: data.webhookUrl ?? undefined,
    createdAt: new Date(),
  });

  // Restart the binary in SIP4AI-style outbound mode:
  //   • config.json gets mode:"outbound" + outbound.target_number
  //   • Binary places the SIP INVITE itself (no Yeastar dial API needed)
  //   • Binary waits for 200 OK (customer answers) BEFORE connecting ElevenLabs
  //   • This guarantees the AI only speaks after pickup — single session, correct timing
  //   • When the call ends the binary exits; proc.on("exit") restarts it in inbound mode
  try {
    logger.info(
      { extensionId: data.extensionId, callId: callRecord.id, phoneNumber: data.phoneNumber },
      "Restarting extension in outbound mode — binary will place the call itself",
    );
    await applyOutboundConfigAndRestart(
      data.extensionId,
      {
        firstMessage: data.firstMessage ?? null,
        systemPromptOverride: data.systemPromptOverride ?? null,
      },
      {
        phoneNumber: data.phoneNumber,
        callerId: data.callerId ?? null,
      },
    );
  } catch (err) {
    logger.error({ err, extensionId: data.extensionId }, "Failed to restart extension in outbound mode");
    await db.update(outboundCallsTable)
      .set({ status: "failed", error: (err as Error).message, updatedAt: new Date() })
      .where(eq(outboundCallsTable.id, callRecord.id));
    res.status(500).json({ error: "Failed to start outbound call: " + (err as Error).message });
    return;
  }

  // Mark as dialing — the binary is now registered and placing the SIP call
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
//
// WHY this endpoint long-polls instead of responding immediately:
//
// The sip-agent binary calls this endpoint right after receiving a SIP INVITE,
// to get the firstMessage/systemPromptOverride before starting the ElevenLabs
// session. By holding the response until Yeastar's call/query API shows the
// extension in TALK state (customer answered), we ensure the binary only opens
// the ElevenLabs session — and sends the greeting — once the customer is
// already on the line.
//
// Fail-open: if Yeastar is not configured, the API is unreachable, or the
// 25-second timeout fires, we return the context immediately so the call
// is never permanently blocked.

router.get("/outbound/context/:extensionId", async (req, res) => {
  const extensionId = Number(req.params["extensionId"]);
  if (!Number.isFinite(extensionId)) {
    res.status(400).json({ error: "Invalid extensionId" });
    return;
  }

  const callerIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const callerAgent = req.headers["user-agent"] ?? "none";

  // Read the pending context (non-destructive — kept for the re-INVITE if one arrives)
  const ctx = consumePendingContext(extensionId);

  if (!ctx) {
    logger.warn(
      { extensionId, callerIp, callerAgent, pending: false },
      "Outbound context fetched by sip-agent — NO CONTEXT FOUND. " +
      "Binary may have called this before POST /api/outbound/call, or context already expired.",
    );
    res.json({ pending: false, firstMessage: null, systemPromptOverride: null, variables: null, callId: null });
    return;
  }

  // ── Detect duplicate session (binary opens two ElevenLabs sessions per call) ─
  const lastServedMs = firstMessageServedAt.get(extensionId);
  const isDuplicateSession =
    lastServedMs !== undefined && Date.now() - lastServedMs < FIRST_MESSAGE_DEDUP_MS;

  // ── Wait for the customer to answer before releasing context ───────────────
  // Look up the extension and its Yeastar client credentials so we can poll
  // the PBX for call state changes.
  try {
    const ext = await db.query.extensionsTable.findFirst({
      where: eq(extensionsTable.id, extensionId),
      with: { client: true },
    });

    const client = ext?.client as {
      id: number;
      yeastarApiUrl?: string | null;
      yeastarClientId?: string | null;
      yeastarClientSecret?: string | null;
    } | null | undefined;

    if (client?.yeastarApiUrl && client?.yeastarClientId && client?.yeastarClientSecret) {
      // Reuse an existing in-progress poll if one is already running for this
      // extension (the second of the binary's two sessions arrives ~200 ms
      // after the first — both can await the same Promise, which halves Yeastar
      // API traffic and ensures they release at the exact same moment).
      let waitPromise = pendingAnswerWaits.get(extensionId);
      if (!waitPromise) {
        waitPromise = waitForCallAnswered(
          {
            id: client.id,
            yeastarApiUrl: client.yeastarApiUrl,
            yeastarClientId: client.yeastarClientId,
            yeastarClientSecret: client.yeastarClientSecret,
          },
          ext!.extensionNumber,
          { callId: ctx.yeastarCallId },
        );
        pendingAnswerWaits.set(extensionId, waitPromise);
        // Remove from map when done so the next independent call starts fresh.
        waitPromise.finally(() => pendingAnswerWaits.delete(extensionId));
      }
      await waitPromise;
    } else {
      logger.debug(
        { extensionId },
        "Outbound context: no Yeastar credentials — returning context immediately",
      );
    }
  } catch (err) {
    // DB or unexpected error — fail open
    logger.warn({ err, extensionId }, "Outbound context: error during answer-wait — returning immediately");
  }

  // ── First-one-wins: only the first session gets the greeting ──────────────
  // Record when we served firstMessage for this extension so the second session
  // (which arrives ~200 ms later) is detected as a duplicate and gets null.
  const servedFirstMessage = isDuplicateSession ? null : (ctx.firstMessage ?? null);
  if (!isDuplicateSession) {
    firstMessageServedAt.set(extensionId, Date.now());
    // Expire the dedup record after the window so unrelated future calls are unaffected.
    setTimeout(() => firstMessageServedAt.delete(extensionId), FIRST_MESSAGE_DEDUP_MS);
  }

  // ── Return the context to the binary ──────────────────────────────────────
  const ageMs = Date.now() - ctx.createdAt.getTime();
  logger.info(
    {
      extensionId,
      callId: ctx.callId,
      callerIp,
      callerAgent,
      pending: true,
      ageMs,
      isDuplicateSession,
      hasFirstMessage: !!servedFirstMessage,
      hasSystemPrompt: !!ctx.systemPromptOverride,
      hasVariables: !!ctx.variables,
      firstMessagePreview: servedFirstMessage ? servedFirstMessage.slice(0, 60) : null,
    },
    isDuplicateSession
      ? "Outbound context: duplicate session — suppressing firstMessage (session 2 starts in listen mode)"
      : "Outbound context: returning config to sip-agent (customer answered or fail-open)",
  );

  res.json({
    pending: true,
    firstMessage: servedFirstMessage,
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
  arguments: z.record(z.string(), z.unknown()).default({}),
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
  ext: {
    id: number;
    extensionNumber: string;
    clientId: number | null;
    agentConfigId: number | null;
    client: Client | null;
    agentConfig: AgentConfig | null;
  };
  phoneNumber: string;
  callerId?: string;
}

async function tryYeastarMakeCall(params: YeastarCallParams): Promise<{ error?: string; yeastarCallId?: string }> {
  const client = params.ext.client as {
    id: number;
    yeastarApiUrl?: string | null;
    yeastarClientId?: string | null;
    yeastarClientSecret?: string | null;
  } | null;

  if (!client?.yeastarApiUrl || !client?.yeastarClientId || !client?.yeastarClientSecret) {
    // Yeastar API not configured — store the call record but skip dialing
    logger.info({ extensionId: params.ext.id }, "Yeastar API not configured on IPBX — outbound call stored but not dialed");
    return {};
  }

  const yeastarClient = {
    id: client.id,
    yeastarApiUrl: client.yeastarApiUrl,
    yeastarClientId: client.yeastarClientId,
    yeastarClientSecret: client.yeastarClientSecret,
  };

  const ext = params.ext as { extensionNumber: string };
  const dialBody = {
    caller: ext.extensionNumber,
    callee: params.phoneNumber,
    ...(params.callerId ? { caller_id_number: params.callerId } : {}),
  };

  // Yeastar P-Series passes the access token as a query parameter, not a Bearer header.
  // On TOKEN EXPIRED (10004) we evict the cache and retry once with a fresh token.
  const attemptDial = async (retrying = false): Promise<{ error?: string; yeastarCallId?: string }> => {
    const accessToken = await getYeastarToken(yeastarClient);
    const url = `${yeastarClient.yeastarApiUrl.replace(/\/$/, "")}/openapi/v1.0/call/dial?access_token=${encodeURIComponent(accessToken)}`;

    logger.info({ extensionId: params.ext.id, url: url.split("?")[0], caller: ext.extensionNumber, callee: params.phoneNumber }, "Yeastar: calling dial");

    const response = await yeastarPost(url, dialBody);

    interface DialResponse { errcode?: number; errmsg?: string; call_id?: string }
    const data = response.json<DialResponse>();

    logger.info(
      { extensionId: params.ext.id, status: response.status, errcode: data.errcode, errmsg: data.errmsg, yeastarCallId: data.call_id, body: response.text },
      "Yeastar: dial response",
    );

    // Token expired — evict and retry once with a fresh token
    if (data.errcode === 10004 && !retrying) {
      logger.warn({ extensionId: params.ext.id }, "Yeastar token expired during dial — evicting cache and retrying");
      evictYeastarToken(client.id);
      return attemptDial(true);
    }

    if (data.errcode !== undefined && data.errcode !== 0) {
      const detail = data.errmsg ?? response.text;
      logger.error({ status: response.status, errcode: data.errcode, body: response.text }, "Yeastar Make Call API error");
      return { error: `Yeastar API error (HTTP ${response.status}): errcode=${data.errcode ?? "?"} — ${detail}` };
    }

    logger.info(
      { extensionId: params.ext.id, phoneNumber: params.phoneNumber, yeastarCallId: data.call_id },
      "Yeastar Make Call API called successfully",
    );
    // Return the Yeastar call_id so the caller can use it for precise call/query polling
    return { yeastarCallId: data.call_id };
  };

  try {
    return await attemptDial();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, extensionId: params.ext.id }, "Yeastar Make Call API request failed");
    return { error: `Failed to reach Yeastar API: ${message}` };
  }
}

export default router;
