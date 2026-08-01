/**
 * AI Provider Webhook Routes
 *
 * POST /api/providers/elevenlabs/post-call
 *   Receives the ElevenLabs post-call webhook after a conversation ends.
 *   Verifies HMAC signature, matches to an outbound call record, stores
 *   the structured analysis result, and fires the caller's webhookUrl if set.
 */
import { Router } from "express";
import crypto from "crypto";
import { db, outboundCallsTable, extensionsTable, agentConfigsTable } from "@workspace/db";
import { eq, and, inArray, desc, gte, isNull } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

interface ElevenLabsTranscriptTurn {
  role: "agent" | "user";
  message: string;
  time_in_call_secs?: number;
}

interface ElevenLabsAnalysis {
  evaluation_criteria_results?: Record<string, { result: "success" | "failure"; rationale?: string; criteria_id?: string }>;
  data_collection_results?: Record<string, { value: unknown; rationale?: string; data_collection_id?: string }>;
  call_successful?: "success" | "failure" | "unknown";
  transcript_summary?: string;
}

interface ElevenLabsConversationInitiationClientData {
  conversation_config_override?: unknown;
  dynamic_variables?: Record<string, unknown>;
  custom_llm_extra_body?: unknown;
}

interface ElevenLabsCallData {
  agent_id: string;
  conversation_id: string;
  status?: string;
  transcript?: ElevenLabsTranscriptTurn[];
  metadata?: Record<string, unknown>;
  analysis?: ElevenLabsAnalysis;
  conversation_initiation_client_data?: ElevenLabsConversationInitiationClientData;
}

interface ElevenLabsWebhookPayload {
  type: string;
  event_timestamp?: number;
  data?: ElevenLabsCallData;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Verify ElevenLabs HMAC signature.
 * Header format: "ElevenLabs-Signature: t=<unix_secs>,v0=<hex_sha256>"
 * Signed payload: "<timestamp>.<raw_body_string>"
 */
function verifyElevenLabsSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
): { ok: boolean; reason?: string } {
  // Parse header parts
  const parts: Record<string, string> = {};
  for (const part of sigHeader.split(",")) {
    const idx = part.indexOf("=");
    if (idx > 0) parts[part.slice(0, idx)] = part.slice(idx + 1);
  }

  if (!parts["t"] || !parts["v0"]) {
    return { ok: false, reason: "Malformed signature header" };
  }

  // Replay protection: reject if timestamp is more than 5 minutes old
  const ts = parseInt(parts["t"], 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return { ok: false, reason: "Timestamp too old or invalid" };
  }

  // Compute expected HMAC
  const signed = `${parts["t"]}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signed).digest("hex");

  // Timing-safe comparison
  try {
    const expectedBuf = Buffer.from(expected, "hex");
    const receivedBuf = Buffer.from(parts["v0"], "hex");
    if (expectedBuf.length !== receivedBuf.length) {
      return { ok: false, reason: "Signature length mismatch" };
    }
    if (!crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
      return { ok: false, reason: "Signature mismatch" };
    }
  } catch {
    return { ok: false, reason: "Signature decode error" };
  }

  return { ok: true };
}

/**
 * Find the outbound call record that corresponds to this ElevenLabs webhook.
 *
 * Strategy 1 (preferred): outbound_call_id was injected into dynamic_variables
 *   at call start (via the context webhook enrichment) — it comes back in
 *   conversation_initiation_client_data.dynamic_variables.outbound_call_id.
 *
 * Strategy 2 (fallback): match by agent_id → find extensions using that agent
 *   → find the most recent outbound call for those extensions that has no result
 *   yet and was updated within the last 10 minutes.
 */
async function findMatchingOutboundCall(data: ElevenLabsCallData) {
  // Strategy 1 — explicit outboundCallId in dynamic_variables
  const dynVars = data.conversation_initiation_client_data?.dynamic_variables ?? {};
  const explicitId =
    dynVars["outbound_call_id"] ??
    dynVars["outboundCallId"] ??
    data.metadata?.["outbound_call_id"] ??
    data.metadata?.["outboundCallId"];

  if (explicitId !== undefined && explicitId !== null) {
    const numericId = Number(explicitId);
    if (Number.isFinite(numericId)) {
      const [call] = await db
        .select()
        .from(outboundCallsTable)
        .where(eq(outboundCallsTable.id, numericId))
        .limit(1);
      if (call) {
        logger.info({ outboundCallId: numericId, strategy: "explicit_id" }, "Matched outbound call via dynamic_variables");
        return call;
      }
    }
  }

  // Strategy 2 — agent_id + time proximity
  if (!data.agent_id) return null;

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  // Find all extensions whose agent config is this ElevenLabs agent
  const matchingExts = await db
    .select({ extensionId: extensionsTable.id })
    .from(extensionsTable)
    .innerJoin(agentConfigsTable, eq(agentConfigsTable.id, extensionsTable.agentConfigId))
    .where(and(
      eq(agentConfigsTable.provider, "elevenlabs"),
      eq(agentConfigsTable.modelId, data.agent_id),
    ));

  if (matchingExts.length === 0) {
    logger.warn({ agentId: data.agent_id }, "No extensions found for ElevenLabs agent_id");
    return null;
  }

  const extensionIds = matchingExts.map(e => e.extensionId);

  // Find the most recent call for those extensions with no result yet, updated within 10 min
  const [call] = await db
    .select()
    .from(outboundCallsTable)
    .where(and(
      extensionIds.length === 1
        ? eq(outboundCallsTable.extensionId, extensionIds[0]!)
        : inArray(outboundCallsTable.extensionId, extensionIds),
      isNull(outboundCallsTable.result),
      gte(outboundCallsTable.updatedAt, tenMinutesAgo),
    ))
    .orderBy(desc(outboundCallsTable.updatedAt))
    .limit(1);

  if (call) {
    logger.info({ outboundCallId: call.id, agentId: data.agent_id, strategy: "time_proximity" }, "Matched outbound call via time proximity");
  }

  return call ?? null;
}

/**
 * Normalize the ElevenLabs analysis into a clean result object:
 *   - data_collection_results  → flat key/value  (drops rationale and IDs)
 *   - evaluation_criteria_results → { key: true/false }
 *   - evaluation sub-object (only if at least one criterion was returned)
 *   - _meta: conversation_id, call_successful, transcript_summary
 */
function normalizeResult(data: ElevenLabsCallData): Record<string, unknown> {
  const analysis = data.analysis ?? {};

  // Flatten data collection: { field: { value, rationale } } → { field: value }
  const collected: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(analysis.data_collection_results ?? {})) {
    collected[key] = entry.value;
  }

  // Flatten evaluation: { criterion: { result: "success"|"failure" } } → { criterion: bool }
  const evalEntries = Object.entries(analysis.evaluation_criteria_results ?? {});
  const evaluation: Record<string, boolean> = {};
  for (const [key, entry] of evalEntries) {
    evaluation[key] = entry.result === "success";
  }

  return {
    ...collected,
    ...(evalEntries.length > 0 ? { evaluation } : {}),
    _meta: {
      conversation_id: data.conversation_id,
      call_successful: analysis.call_successful ?? null,
      transcript_summary: analysis.transcript_summary ?? null,
    },
  };
}

// ── ElevenLabs Post-Call Webhook ──────────────────────────────────────────────

router.post("/providers/elevenlabs/post-call", async (req, res) => {
  const rawBodyBuf = (req as import("express").Request & { rawBody?: Buffer }).rawBody;
  const rawBodyStr = rawBodyBuf ? rawBodyBuf.toString("utf8") : JSON.stringify(req.body);

  const payload = req.body as ElevenLabsWebhookPayload;

  // Acknowledge non-transcription event types early (before DB lookup / signature check)
  if (payload.type !== "post_call_transcription") {
    logger.info({ type: payload.type }, "ElevenLabs webhook: non-transcription event — acknowledged");
    res.json({ received: true });
    return;
  }

  const data = payload.data;
  if (!data?.agent_id) {
    res.status(400).json({ error: "Missing data.agent_id in payload" });
    return;
  }

  // ── HMAC verification using the secret stored on the agent config ──────────
  // Look up the agent config by agent_id (modelId) to get its webhookSecret.
  // This allows each ElevenLabs agent to have its own signing secret.
  const agentCfg = await db
    .select({ webhookSecret: agentConfigsTable.webhookSecret })
    .from(agentConfigsTable)
    .where(and(
      eq(agentConfigsTable.provider, "elevenlabs"),
      eq(agentConfigsTable.modelId, data.agent_id),
    ))
    .limit(1)
    .then(rows => rows[0] ?? null);

  const secret = agentCfg?.webhookSecret ?? process.env["ELEVENLABS_WEBHOOK_SECRET"] ?? null;

  if (secret) {
    const sigHeader = req.headers["elevenlabs-signature"] as string | undefined;
    if (!sigHeader) {
      logger.warn({ agentId: data.agent_id }, "ElevenLabs webhook: missing signature header");
      res.status(401).json({ error: "Missing ElevenLabs-Signature header" });
      return;
    }
    const check = verifyElevenLabsSignature(rawBodyStr, sigHeader, secret);
    if (!check.ok) {
      logger.warn({ agentId: data.agent_id, reason: check.reason }, "ElevenLabs webhook: signature verification failed");
      res.status(401).json({ error: `Signature verification failed: ${check.reason}` });
      return;
    }
  } else {
    logger.warn({ agentId: data.agent_id }, "No webhook secret configured for this agent — skipping signature verification");
  }

  logger.info(
    { agentId: data.agent_id, conversationId: data.conversation_id, status: data.status },
    "ElevenLabs post-call webhook received",
  );

  // ── Match to an outbound call ─────────────────────────────────────────────
  const call = await findMatchingOutboundCall(data);

  if (!call) {
    logger.warn(
      { agentId: data.agent_id, conversationId: data.conversation_id },
      "ElevenLabs webhook: no matching outbound call found — webhook acknowledged but not stored",
    );
    // Still return 200 so ElevenLabs does not retry
    res.json({ received: true, matched: false });
    return;
  }

  // ── Store the result ──────────────────────────────────────────────────────
  const result = normalizeResult(data);

  await db
    .update(outboundCallsTable)
    .set({ result: JSON.stringify(result), status: "completed", updatedAt: new Date() })
    .where(eq(outboundCallsTable.id, call.id));

  logger.info(
    { outboundCallId: call.id, agentId: data.agent_id, conversationId: data.conversation_id },
    "ElevenLabs webhook: result stored",
  );

  // ── Fire caller's webhookUrl if configured ────────────────────────────────
  if (call.webhookUrl) {
    const webhookPayload = {
      event: "call_result",
      outboundCallId: call.id,
      extensionId: call.extensionId,
      phoneNumber: call.phoneNumber,
      result,
      timestamp: new Date().toISOString(),
    };
    fetch(call.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    }).catch((err: Error) =>
      logger.warn({ err, webhookUrl: call.webhookUrl }, "ElevenLabs webhook: caller webhookUrl delivery failed"),
    );
  }

  res.json({ received: true, matched: true, outboundCallId: call.id });
});

export default router;
