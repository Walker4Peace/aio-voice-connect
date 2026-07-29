/**
 * Outbound Call Context Store
 *
 * Stores pending runtime context for an outbound call keyed by extensionId.
 * When an outbound call is triggered, the runtime overrides (firstMessage,
 * systemPromptOverride, variables) are stored here. The sip-agent binary
 * fetches GET /api/outbound/context/:extensionId to retrieve this context.
 *
 * WHY we no longer consume (delete) on first read:
 * Yeastar sends TWO SIP INVITEs for every outbound call:
 *   1. Initial INVITE — extension answers before the customer picks up.
 *      The binary starts an ElevenLabs session immediately (session 1), which
 *      runs into silence and disconnects after a few seconds.
 *   2. Re-INVITE — sent when the customer answers and Yeastar bridges the legs.
 *      The binary starts a second ElevenLabs session (session 2) — this is the
 *      real call the customer hears.
 * If we consumed the context on the first read (session 1), session 2 would
 * find no context and fall back to the inbound default config. By keeping the
 * context readable for both INVITEs and expiring it via TTL instead, both
 * sessions get the correct outbound overrides, and the customer hears the
 * right first_message and system prompt.
 */

export interface OutboundCallContext {
  callId: number; // outbound_calls.id from DB
  /** Yeastar call_id returned by call/dial — used for precise call/query polling */
  yeastarCallId?: string;
  firstMessage?: string;
  systemPromptOverride?: string;
  variables?: Record<string, unknown>;
  webhookUrl?: string;
  createdAt: Date;
}

// Map from extensionId → pending context
const pendingContexts = new Map<number, OutboundCallContext>();

// TTL timers — auto-expire context after 3 minutes so memory doesn't leak
// if a call never completes (busy signal, no answer, network error, etc.)
const TTL_MS = 3 * 60 * 1000;
const ttlTimers = new Map<number, ReturnType<typeof setTimeout>>();

export function setPendingContext(extensionId: number, ctx: OutboundCallContext): void {
  // Cancel any existing TTL timer before replacing
  const existing = ttlTimers.get(extensionId);
  if (existing) clearTimeout(existing);

  pendingContexts.set(extensionId, ctx);

  const timer = setTimeout(() => {
    pendingContexts.delete(extensionId);
    ttlTimers.delete(extensionId);
  }, TTL_MS);
  ttlTimers.set(extensionId, timer);
}

/**
 * Read context WITHOUT deleting it so that the second SIP INVITE
 * (fired when the customer actually answers) can also use it.
 * Use clearPendingContext() to explicitly remove it when the call ends.
 */
export function getPendingContext(extensionId: number): OutboundCallContext | undefined {
  return pendingContexts.get(extensionId);
}

/** @deprecated — kept for backward compatibility; now delegates to getPendingContext */
export function consumePendingContext(extensionId: number): OutboundCallContext | undefined {
  return getPendingContext(extensionId);
}

/** Explicitly clear context (e.g. call completed/failed, or new call replaces old). */
export function clearPendingContext(extensionId: number): void {
  const timer = ttlTimers.get(extensionId);
  if (timer) clearTimeout(timer);
  ttlTimers.delete(extensionId);
  pendingContexts.delete(extensionId);
}
