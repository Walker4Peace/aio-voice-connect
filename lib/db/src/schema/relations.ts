import { relations } from "drizzle-orm";
import { clientsTable } from "./clients";
import { extensionsTable } from "./extensions";
import { agentConfigsTable } from "./agentConfigs";
import { deploymentsTable } from "./deployments";
import { agentToolsTable } from "./agentTools";
import { outboundCallsTable } from "./outboundCalls";

export const clientsRelations = relations(clientsTable, ({ many }) => ({
  extensions: many(extensionsTable),
}));

export const extensionsRelations = relations(extensionsTable, ({ one, many }) => ({
  client: one(clientsTable, {
    fields: [extensionsTable.clientId],
    references: [clientsTable.id],
  }),
  agentConfig: one(agentConfigsTable, {
    fields: [extensionsTable.agentConfigId],
    references: [agentConfigsTable.id],
  }),
  deployment: one(deploymentsTable, {
    fields: [extensionsTable.id],
    references: [deploymentsTable.extensionId],
  }),
  outboundCalls: many(outboundCallsTable),
}));

export const agentConfigsRelations = relations(agentConfigsTable, ({ many }) => ({
  extensions: many(extensionsTable),
  tools: many(agentToolsTable),
}));

export const agentToolsRelations = relations(agentToolsTable, ({ one }) => ({
  agentConfig: one(agentConfigsTable, {
    fields: [agentToolsTable.agentConfigId],
    references: [agentConfigsTable.id],
  }),
}));

export const outboundCallsRelations = relations(outboundCallsTable, ({ one }) => ({
  extension: one(extensionsTable, {
    fields: [outboundCallsTable.extensionId],
    references: [extensionsTable.id],
  }),
}));
