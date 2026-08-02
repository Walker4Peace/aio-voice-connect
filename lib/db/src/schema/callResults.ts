import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

/**
 * Stores post-call webhook payloads keyed by provider conversation_id.
 * Populated by the ElevenLabs post-call webhook; designed to be
 * provider-agnostic so future providers (OpenAI Realtime, Gemini Live, etc.)
 * can reuse the same table without schema changes.
 */
export const callResultsTable = pgTable("call_results", {
  id: serial("id").primaryKey(),

  /** Provider conversation ID — primary lookup key (e.g. ElevenLabs conv_XXX). */
  conversationId: text("conversation_id").notNull().unique(),

  /** SIP call UUID — linked when we can match the webhook to a call event row. */
  callId: text("call_id"),

  /** JSON array: [{ role, message, time_in_call_secs? }] */
  transcriptJson: text("transcript_json"),

  /**
   * JSON object: provider-level analysis fields.
   * For ElevenLabs: { call_successful, transcript_summary, evaluation_criteria_results }
   * evaluation_criteria_results is stored at full fidelity — key → { result, rationale }.
   */
  analysisJson: text("analysis_json"),

  /**
   * JSON object: key → { value, rationale? }
   * For ElevenLabs: data_collection_results stored at full fidelity.
   */
  dataCollectionJson: text("data_collection_json"),

  /** Plain-text summary (transcript_summary from ElevenLabs analysis). */
  summary: text("summary"),

  /** Complete raw webhook payload JSON — useful for debugging and future integrations. */
  rawPayloadJson: text("raw_payload_json"),

  storedAt: timestamp("stored_at").defaultNow().notNull(),
});

export type DbCallResult = typeof callResultsTable.$inferSelect;
export type InsertCallResult = typeof callResultsTable.$inferInsert;
