import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const AI_PROVIDERS = ["openai", "elevenlabs", "gemini", "deepgram", "cartesia"] as const;
export type AiProvider = typeof AI_PROVIDERS[number];

export const agentConfigsTable = pgTable("agent_configs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider").$type<AiProvider>().notNull(),
  apiKey: text("api_key").notNull(),
  voiceId: text("voice_id"),
  modelId: text("model_id"),
  systemPrompt: text("system_prompt"),
  greeting: text("greeting"),
  language: text("language"),
  // "inbound" = only handle inbound calls, "outbound" = only handle outbound calls
  mode: text("mode").notNull().default("inbound"),
  extraConfig: text("extra_config"),
  // ElevenLabs post-call webhook signing secret (stored per-agent, not in env)
  webhookSecret: text("webhook_secret"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAgentConfigSchema = createInsertSchema(agentConfigsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAgentConfig = z.infer<typeof insertAgentConfigSchema>;
export type AgentConfig = typeof agentConfigsTable.$inferSelect;
