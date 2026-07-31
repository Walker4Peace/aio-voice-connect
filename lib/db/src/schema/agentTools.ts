import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { agentConfigsTable } from "./agentConfigs";

export const AGENT_TOOL_EXECUTION_TYPES = [
  "http_request",
  "webhook",
  "save_result",
  "transfer_call",
  "hang_up",
  "send_dtmf",
  "custom_js",
] as const;
export type AgentToolExecutionType = typeof AGENT_TOOL_EXECUTION_TYPES[number];

export const agentToolsTable = pgTable("agent_tools", {
  id: serial("id").primaryKey(),
  agentConfigId: integer("agent_config_id")
    .notNull()
    .references(() => agentConfigsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  parametersSchema: text("parameters_schema"), // JSON Schema string
  executionType: text("execution_type").notNull().$type<AgentToolExecutionType>(),
  executionConfig: text("execution_config"), // JSON config specific to execution type
  timeout: integer("timeout").notNull().default(10), // seconds
  requireConfirmation: boolean("require_confirmation").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AgentTool = typeof agentToolsTable.$inferSelect;
export type InsertAgentTool = typeof agentToolsTable.$inferInsert;
