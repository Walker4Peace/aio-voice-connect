import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, extensionsTable, clientsTable, agentConfigsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  CreateExtensionBody,
  UpdateExtensionBody,
  GetExtensionParams,
  UpdateExtensionParams,
  DeleteExtensionParams,
  ListExtensionsQueryParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/extensions", async (req, res) => {
  const query = ListExtensionsQueryParams.safeParse(req.query);
  const clientId = query.success ? query.data.clientId : undefined;

  try {
    const extensions = await db.query.extensionsTable.findMany({
      where: clientId ? eq(extensionsTable.clientId, clientId) : undefined,
      with: {
        client: true,
        agentConfig: true,
      },
      orderBy: extensionsTable.createdAt,
    });
    res.json(extensions);
  } catch (err) {
    logger.error({ err }, "Failed to list extensions — possible missing DB migration (run: pnpm --filter @workspace/db run push)");
    res.status(500).json({ error: "Database error listing extensions" });
  }
});

router.post("/extensions", async (req, res) => {
  const parsed = CreateExtensionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [ext] = await db
    .insert(extensionsTable)
    .values(parsed.data)
    .returning();

  const full = await db.query.extensionsTable.findFirst({
    where: eq(extensionsTable.id, ext.id),
    with: { client: true, agentConfig: true },
  });
  res.status(201).json(full);
});

router.get("/extensions/:id", async (req, res) => {
  const { id } = GetExtensionParams.parse({ id: Number(req.params.id) });
  const ext = await db.query.extensionsTable.findFirst({
    where: eq(extensionsTable.id, id),
    with: { client: true, agentConfig: true },
  });
  if (!ext) {
    res.status(404).json({ error: "Extension not found" });
    return;
  }
  res.json(ext);
});

router.put("/extensions/:id", async (req, res) => {
  const { id } = UpdateExtensionParams.parse({ id: Number(req.params.id) });
  const parsed = UpdateExtensionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db
    .update(extensionsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(extensionsTable.id, id));
  const full = await db.query.extensionsTable.findFirst({
    where: eq(extensionsTable.id, id),
    with: { client: true, agentConfig: true },
  });
  if (!full) {
    res.status(404).json({ error: "Extension not found" });
    return;
  }
  res.json(full);
});

router.delete("/extensions/:id", async (req, res) => {
  const { id } = DeleteExtensionParams.parse({ id: Number(req.params.id) });
  await db.delete(extensionsTable).where(eq(extensionsTable.id, id));
  res.status(204).send();
});

export default router;
