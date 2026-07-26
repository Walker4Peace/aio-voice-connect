import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { extensionsTable } from "./extensions";

export const DEPLOYMENT_STATUSES = ["stopped", "starting", "registered", "reconnecting", "error"] as const;
export type DeploymentStatus = typeof DEPLOYMENT_STATUSES[number];

export const deploymentsTable = pgTable("deployments", {
  id: serial("id").primaryKey(),
  extensionId: integer("extension_id")
    .notNull()
    .unique()
    .references(() => extensionsTable.id, { onDelete: "cascade" }),
  status: text("status").$type<DeploymentStatus>().notNull().default("stopped"),
  pid: integer("pid"),
  sipLocalPort: integer("sip_local_port"),
  httpPort: integer("http_port"),
  serviceName: text("service_name"),
  sipRegistered: boolean("sip_registered").notNull().default(false),
  lastStartedAt: timestamp("last_started_at"),
  lastStoppedAt: timestamp("last_stopped_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Deployment = typeof deploymentsTable.$inferSelect;
