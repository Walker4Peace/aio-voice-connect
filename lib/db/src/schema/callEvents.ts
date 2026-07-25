import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const callEventsTable = pgTable("call_events", {
  id: serial("id").primaryKey(),
  extensionId: integer("extension_id").notNull(),
  callId: text("call_id").notNull(),
  event: text("event").$type<"invite" | "answered" | "ended" | "connected_ai" | "error">().notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DbCallEvent = typeof callEventsTable.$inferSelect;
