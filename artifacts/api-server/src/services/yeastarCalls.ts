/**
 * Yeastar P-Series Software Edition — active call status polling
 *
 * Provides `waitForCallAnswered()`, which polls GET /openapi/v1.0/call/query
 * every 600 ms until the outbound call leg shows member_status "ANSWER"
 * (customer picked up), then resolves true.
 *
 * Source: Yeastar P-Series Software Edition Developer Guide v1.0
 *
 * call/query response shape
 * ─────────────────────────
 * {
 *   "errcode": 0,
 *   "errmsg": "SUCCESS",
 *   "data": [
 *     {
 *       "call_id": "1650012665.266",
 *       "members": [
 *         { "extension": { "number": "1005", "channel_id": "...",
 *                          "member_status": "ALERT", "call_path": "" } },
 *         { "outbound":  { "from": "1005", "to": "+21266...",
 *                          "trunk_name": "...", "channel_id": "...",
 *                          "member_status": "RING", "call_path": "" } }
 *       ]
 *     }
 *   ]
 * }
 *
 * member_status lifecycle for an outbound call:
 *   extension  → ALERT   (caller hears ringback, customer not yet answered)
 *   outbound   → RING    (customer phone is ringing)
 *   ----- customer picks up -----
 *   extension  → ANSWERED (caller side connected)
 *   outbound   → ANSWER   (customer answered — this is our trigger)
 *
 * We wait for the outbound member to show "ANSWER", which is the precise
 * moment the customer picks up.  We also accept "ANSWERED" on any member
 * (extension side) as a fallback.
 *
 * Fail-open: any API error or timeout resolves immediately so a Yeastar
 * connectivity issue never silently blocks the call.
 */

import { getYeastarToken, yeastarGet, yeastarPost, evictYeastarToken, type YeastarClient } from "./yeastarAuth.js";
export type { YeastarClient };
import { logger } from "../lib/logger.js";

// ── Types matching the P-Series Software Edition Developer Guide ──────────────

interface ExtensionMember {
  number?: string;
  channel_id?: string;
  member_status?: string;
  call_path?: string;
}

interface OutboundMember {
  from?: string;
  to?: string;
  trunk_name?: string;
  channel_id?: string;
  member_status?: string;
  call_path?: string;
}

interface InboundMember {
  from?: string;
  to?: string;
  trunk_name?: string;
  channel_id?: string;
  member_status?: string;
  call_path?: string;
}

// Each element in the members array is a typed union object:
// { extension: ExtensionMember } | { outbound: OutboundMember } | { inbound: InboundMember }
type MemberEntry =
  | { extension: ExtensionMember; outbound?: never; inbound?: never }
  | { outbound: OutboundMember; extension?: never; inbound?: never }
  | { inbound: InboundMember; extension?: never; outbound?: never };

interface CallInfo {
  call_id?: string;
  members?: MemberEntry[];
}

interface QueryCallsResponse {
  errcode?: number;
  errmsg?: string;
  data?: CallInfo[];
}

// ── Status detection ──────────────────────────────────────────────────────────

/**
 * Returns true when the call is fully connected (customer answered).
 *
 * - Outbound member status "ANSWER"  = customer callee answered (primary signal)
 * - Extension member status "ANSWERED" = extension (AI) caller confirmed connected
 *
 * We accept either because some firmware versions may slightly differ.
 */
function isCallConnected(call: CallInfo): boolean {
  for (const entry of call.members ?? []) {
    if ("outbound" in entry && entry.outbound) {
      const s = (entry.outbound.member_status ?? "").toUpperCase();
      if (s === "ANSWER" || s === "ANSWERED") return true;
    }
    if ("extension" in entry && entry.extension) {
      const s = (entry.extension.member_status ?? "").toUpperCase();
      // ANSWERED on the extension side = remote party picked up
      if (s === "ANSWERED") return true;
    }
  }
  return false;
}

// ── Poll helper ───────────────────────────────────────────────────────────────

/**
 * Query active calls for a given extension (and optionally a specific call_id).
 * Returns null on any network/auth error (fail-open caller should skip waiting).
 */
async function queryActiveCalls(
  client: YeastarClient,
  extensionNumber: string,
  callId?: string,
  retrying = false,
): Promise<CallInfo[] | null> {
  try {
    const token = await getYeastarToken(client);
    const base = client.yeastarApiUrl!.replace(/\/$/, "");

    // Prefer to query by call_id (precise) if we have it, otherwise by extension
    const qs = callId
      ? `call_id=${encodeURIComponent(callId)}`
      : `extension=${encodeURIComponent(extensionNumber)}`;

    const url = `${base}/openapi/v1.0/call/query?${qs}&access_token=${encodeURIComponent(token)}`;
    const res = await yeastarGet(url);
    const data = res.json<QueryCallsResponse>();

    // Token expired — evict and retry once
    if (data.errcode === 10004 && !retrying) {
      evictYeastarToken(client.id);
      return queryActiveCalls(client, extensionNumber, callId, true);
    }

    if (data.errcode !== 0) {
      // Non-zero often means no active calls (empty query), not a real error.
      // Treat as empty list so polling continues until timeout.
      logger.debug(
        { errcode: data.errcode, errmsg: data.errmsg, extensionNumber, callId },
        "yeastarCalls: call/query returned non-zero errcode (no active calls or transient) — treating as empty",
      );
      return [];
    }

    return data.data ?? [];
  } catch (err) {
    logger.warn({ err, extensionNumber, callId }, "yeastarCalls: call/query request failed");
    return null; // signal fail-open
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

// ── Call drop ─────────────────────────────────────────────────────────────────

interface DropCallResponse {
  errcode?: number;
  errmsg?: string;
}

/**
 * Tell the Yeastar PBX to immediately hang up the active call on the given
 * extension.  Used when the AI fires `end_call` on an inbound leg — the binary
 * closes its ElevenLabs WS but never sends SIP BYE, so we drive the teardown
 * from the PBX side instead of relying on the binary's /bye HTTP endpoint.
 *
 * Flow:
 *   1. Query call/query?extension=<num> to get Yeastar's internal call_id.
 *   2. POST call/drop with that call_id → Yeastar sends SIP BYE to the caller.
 *
 * Returns true on success, false on any error (fail-open; caller must not block).
 * Never rejects.
 */
export async function dropCallViaYeastar(
  client: YeastarClient,
  extensionNumber: string,
  retrying = false,
): Promise<boolean> {
  if (!client.yeastarApiUrl || !client.yeastarClientId || !client.yeastarClientSecret) {
    logger.debug({ extensionNumber }, "dropCallViaYeastar: Yeastar not configured — skipping");
    return false;
  }

  try {
    // Step 1 — find the active Yeastar call_id for this extension
    const calls = await queryActiveCalls(client, extensionNumber);
    if (!calls || calls.length === 0) {
      logger.warn({ extensionNumber }, "dropCallViaYeastar: no active calls found for extension — cannot drop");
      return false;
    }

    const yeastarCallId = calls[0].call_id;
    if (!yeastarCallId) {
      logger.warn({ extensionNumber }, "dropCallViaYeastar: active call has no call_id — cannot drop");
      return false;
    }

    // Step 2 — ask the PBX to drop it
    const token = await getYeastarToken(client);
    const base = client.yeastarApiUrl.replace(/\/$/, "");
    const url = `${base}/openapi/v1.0/call/drop?access_token=${encodeURIComponent(token)}`;

    const res = await yeastarPost(url, { call_id: yeastarCallId });
    const data = res.json<DropCallResponse>();

    if (data.errcode === 10004 && !retrying) {
      // Token expired — evict and retry once
      evictYeastarToken(client.id);
      return dropCallViaYeastar(client, extensionNumber, true);
    }

    if (data.errcode !== 0) {
      logger.warn(
        { extensionNumber, yeastarCallId, errcode: data.errcode, errmsg: data.errmsg },
        "dropCallViaYeastar: call/drop returned non-zero errcode",
      );
      return false;
    }

    logger.info({ extensionNumber, yeastarCallId }, "dropCallViaYeastar: PBX call dropped via Yeastar API");
    return true;
  } catch (err) {
    logger.warn({ err, extensionNumber }, "dropCallViaYeastar: unexpected error — call may remain active");
    return false;
  }
}

export interface WaitForAnswerOptions {
  /** Yeastar call_id returned by call/dial. Used for precise per-call querying. */
  callId?: string;
  /** Max total wait time in ms. Default: 25 000 (25 s). */
  timeoutMs?: number;
  /** Polling interval in ms. Default: 600. */
  intervalMs?: number;
}

/**
 * Poll Yeastar's call/query endpoint until the outbound call for the given
 * extension shows member_status "ANSWER" on the outbound leg (customer picked up).
 *
 * Resolves true  → customer answered; context may be returned to binary.
 * Resolves false → timeout, Yeastar error, or no credentials (fail-open).
 *
 * Never rejects.
 *
 * @param client          Yeastar client DB row (needs yeastarApiUrl/ClientId/Secret)
 * @param extensionNumber Extension number string, e.g. "1005"
 * @param opts            Optional callId, timeout, interval overrides
 */
export async function waitForCallAnswered(
  client: YeastarClient,
  extensionNumber: string,
  opts: WaitForAnswerOptions = {},
): Promise<boolean> {
  const { callId, timeoutMs = 25_000, intervalMs = 600 } = opts;

  if (!client.yeastarApiUrl || !client.yeastarClientId || !client.yeastarClientSecret) {
    logger.debug({ extensionNumber }, "waitForCallAnswered: Yeastar not configured — returning immediately");
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  logger.info(
    { extensionNumber, callId: callId ?? "(unknown)", timeoutMs },
    "waitForCallAnswered: holding context response until customer answers",
  );

  while (Date.now() < deadline) {
    attempt++;
    const calls = await queryActiveCalls(client, extensionNumber, callId);

    if (calls === null) {
      // Network error — fail open immediately
      logger.warn(
        { extensionNumber, callId, attempt },
        "waitForCallAnswered: query error — releasing context immediately (fail-open)",
      );
      return false;
    }

    const connected = calls.some(isCallConnected);
    if (connected) {
      const elapsedMs = attempt * intervalMs;
      logger.info(
        { extensionNumber, callId, attempt, elapsedMs },
        "waitForCallAnswered: outbound leg ANSWER — releasing context to binary",
      );
      return true;
    }

    // Log the current statuses every 5 attempts for observability
    if (attempt % 5 === 1) {
      const statuses = calls.flatMap((c) =>
        (c.members ?? []).map((m) => {
          if ("extension" in m && m.extension) return `ext:${m.extension.member_status}`;
          if ("outbound" in m && m.outbound) return `out:${m.outbound.member_status}`;
          if ("inbound" in m && m.inbound) return `in:${m.inbound.member_status}`;
          return "?";
        }),
      );
      logger.debug(
        { extensionNumber, callId, attempt, statuses, callsFound: calls.length },
        "waitForCallAnswered: still waiting for ANSWER...",
      );
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((r) => setTimeout(r, Math.min(intervalMs, remaining)));
  }

  logger.warn(
    { extensionNumber, callId, timeoutMs, attempts: attempt },
    "waitForCallAnswered: timeout — releasing context anyway (fail-open)",
  );
  return false;
}
