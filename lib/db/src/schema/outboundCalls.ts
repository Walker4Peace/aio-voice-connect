import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { extensionsTable } from "./extensions";

export const OUTBOUND_CALL_STATUSES = [
  "pending",
  "dialing",
  "active",
  "completed",
  "failed",
] as const;
export type OutboundCallStatus = typeof OUTBOUND_CALL_STATUSES[number];

export const outboundCallsTable = pgTable("outbound_calls", {
  id: serial("id").primaryKey(),
  extensionId: integer("extension_id").references(() => extensionsTable.id),
  phoneNumber: text("phone_number").notNull(),
  callerId: text("caller_id"),
  variables: text("variables"), // JSON string
  firstMessage: text("first_message"),
  systemPromptOverride: text("system_prompt_override"),
  metadata: text("metadata"), // JSON string
  webhookUrl: text("webhook_url"),
  status: text("status")
    .notNull()
    .default("pending")
    .$type<OutboundCallStatus>(),
  callId: text("call_id"),
  result: text("result"), // JSON string
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type OutboundCall = typeof outboundCallsTable.$inferSelect;
export type InsertOutboundCall = typeof outboundCallsTable.$inferInsert;
