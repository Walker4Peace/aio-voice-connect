import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";

export const adminConfigTable = pgTable("admin_config", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  language: text("language").$type<"en" | "fr">().notNull().default("en"),
  timezone: text("timezone").notNull().default("UTC"),
  domain: text("domain"),
  domainConfigured: boolean("domain_configured").notNull().default(false),
  setupComplete: boolean("setup_complete").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AdminConfig = typeof adminConfigTable.$inferSelect;
