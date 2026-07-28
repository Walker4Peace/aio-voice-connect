import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  sipDomain: text("sip_domain"),
  sipServer: text("sip_server"),
  // Yeastar P-Series PBX API — OAuth 2.0 credentials for outbound call triggering
  yeastarApiUrl: text("yeastar_api_url"),
  yeastarClientId: text("yeastar_client_id"),
  yeastarClientSecret: text("yeastar_client_secret"),
  // null = not tested yet, true = test passed, false = test failed
  yeastarVerified: boolean("yeastar_verified"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
