import { Router } from "express";
import { eq, asc } from "drizzle-orm";
import { db, agentToolsTable } from "@workspace/db";
import { z } from "zod/v4";

const router = Router();

const createToolSchema = z.object({
  agentConfigId: z.number().int().positive(),
  name: z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Name must be a valid identifier (letters, numbers, underscores)"),
  description: z.string().min(1),
  parametersSchema: z.string().nullable().optional(),
  executionType: z.enum(["http_request", "webhook", "transfer_call", "hang_up", "send_dtmf", "custom_js"]),
  executionConfig: z.string().nullable().optional(),
  timeout: z.number().int().min(1).max(300).default(10),
  requireConfirmation: z.boolean().default(false),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const updateToolSchema = createToolSchema.partial().omit({ agentConfigId: true });

// GET /api/agent-tools?agentConfigId=X
router.get("/agent-tools", async (req, res) => {
  const agentConfigId = Number(req.query["agentConfigId"]);
  if (!Number.isFinite(agentConfigId) || agentConfigId <= 0) {
    res.status(400).json({ error: "agentConfigId query parameter is required" });
    return;
  }
  const tools = await db
    .select()
    .from(agentToolsTable)
    .where(eq(agentToolsTable.agentConfigId, agentConfigId))
    .orderBy(asc(agentToolsTable.sortOrder), asc(agentToolsTable.createdAt));
  res.json(tools);
});

// POST /api/agent-tools
router.post("/agent-tools", async (req, res) => {
  const parsed = createToolSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [tool] = await db.insert(agentToolsTable).values(parsed.data).returning();
  res.status(201).json(tool);
});

// GET /api/agent-tools/:id
router.get("/agent-tools/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [tool] = await db.select().from(agentToolsTable).where(eq(agentToolsTable.id, id));
  if (!tool) {
    res.status(404).json({ error: "Tool not found" });
    return;
  }
  res.json(tool);
});

// PUT /api/agent-tools/:id
router.put("/agent-tools/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = updateToolSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [tool] = await db
    .update(agentToolsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(agentToolsTable.id, id))
    .returning();
  if (!tool) {
    res.status(404).json({ error: "Tool not found" });
    return;
  }
  res.json(tool);
});

// DELETE /api/agent-tools/:id
router.delete("/agent-tools/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(agentToolsTable).where(eq(agentToolsTable.id, id));
  res.status(204).send();
});

export default router;
