/**
 * Outbound Call Context Store
 *
 * Stores pending runtime context for an outbound call keyed by extensionId.
 * When an outbound call is triggered, the runtime overrides (firstMessage,
 * systemPromptOverride, variables) are stored here. The sip-agent binary
 * can poll GET /api/outbound/context/:extensionId to retrieve and consume
 * this context at the start of a call.
 */

export interface OutboundCallContext {
  callId: number; // outbound_calls.id from DB
  firstMessage?: string;
  systemPromptOverride?: string;
  variables?: Record<string, unknown>;
  webhookUrl?: string;
  createdAt: Date;
}

// Map from extensionId → pending context
const pendingContexts = new Map<number, OutboundCallContext>();

export function setPendingContext(extensionId: number, ctx: OutboundCallContext): void {
  pendingContexts.set(extensionId, ctx);
}

export function getPendingContext(extensionId: number): OutboundCallContext | undefined {
  return pendingContexts.get(extensionId);
}

/** Consume and remove the pending context (call start). */
export function consumePendingContext(extensionId: number): OutboundCallContext | undefined {
  const ctx = pendingContexts.get(extensionId);
  if (ctx) pendingContexts.delete(extensionId);
  return ctx;
}

export function clearPendingContext(extensionId: number): void {
  pendingContexts.delete(extensionId);
}
