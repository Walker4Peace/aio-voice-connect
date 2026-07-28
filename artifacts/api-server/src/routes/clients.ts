import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, clientsTable } from "@workspace/db";
import {
  CreateClientBody,
  UpdateClientBody,
  GetClientParams,
  UpdateClientParams,
  DeleteClientParams,
} from "@workspace/api-zod";
import { testYeastarConnection, evictYeastarToken } from "../services/yeastarAuth.js";
import { logger } from "../lib/logger.js";


const router = Router();

router.get("/clients", async (req, res) => {
  try {
    const clients = await db.select().from(clientsTable).orderBy(clientsTable.createdAt);
    res.json(clients);
  } catch (err) {
    logger.error({ err }, "Failed to list clients — possible missing DB migration (run: pnpm --filter @workspace/db run push)");
    res.status(500).json({ error: "Database error listing IPBXs" });
  }
});

// ── Standalone Yeastar connection test (no saved client needed) ──────────────
// Must be registered before /clients/:id routes to avoid param conflict.

const StandaloneTestBody = z.object({
  pbxUrl: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

/**
 * POST /api/clients/yeastar/test
 * Test Yeastar credentials without needing a saved client (used by the Create form).
 */
router.post("/clients/yeastar/test", async (req, res) => {
  const parsed = StandaloneTestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "pbxUrl, clientId, and clientSecret are required" });
    return;
  }
  const { pbxUrl, clientId, clientSecret } = parsed.data;
  logger.info({ pbxUrl, clientId }, "Standalone Yeastar connection test");
  const result = await testYeastarConnection(pbxUrl, clientId, clientSecret);
  if (result.success) {
    res.json({ success: true });
  } else {
    logger.warn({ pbxUrl, error: result.error }, "Standalone Yeastar connection test failed");
    res.status(422).json({ success: false, error: result.error });
  }
});

router.post("/clients", async (req, res) => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Insert the client first so we have an ID
  const [client] = await db
    .insert(clientsTable)
    .values(parsed.data)
    .returning();

  // Auto-test Yeastar credentials if provided, store the result
  let yeastarVerified: boolean | null = null;
  if (parsed.data.yeastarApiUrl && parsed.data.yeastarClientId && parsed.data.yeastarClientSecret) {
    const testResult = await testYeastarConnection(
      parsed.data.yeastarApiUrl,
      parsed.data.yeastarClientId,
      parsed.data.yeastarClientSecret,
    );
    yeastarVerified = testResult.success;
    logger.info({ clientId: client!.id, yeastarVerified }, "Yeastar auto-test on create");
    const [updated] = await db
      .update(clientsTable)
      .set({ yeastarVerified })
      .where(eq(clientsTable.id, client!.id))
      .returning();
    res.status(201).json(updated);
    return;
  }

  res.status(201).json(client);
});

router.get("/clients/:id", async (req, res) => {
  const { id } = GetClientParams.parse({ id: Number(req.params.id) });
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(client);
});

router.put("/clients/:id", async (req, res) => {
  const { id } = UpdateClientParams.parse({ id: Number(req.params.id) });
  const parsed = UpdateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Evict cached token if Yeastar credentials changed
  evictYeastarToken(id);

  // Auto-test Yeastar credentials if provided
  let yeastarVerified: boolean | null = null;
  if (parsed.data.yeastarApiUrl && parsed.data.yeastarClientId && parsed.data.yeastarClientSecret) {
    const testResult = await testYeastarConnection(
      parsed.data.yeastarApiUrl,
      parsed.data.yeastarClientId,
      parsed.data.yeastarClientSecret,
    );
    yeastarVerified = testResult.success;
    logger.info({ clientId: id, yeastarVerified }, "Yeastar auto-test on update");
  }

  const [client] = await db
    .update(clientsTable)
    .set({ ...parsed.data, yeastarVerified, updatedAt: new Date() })
    .where(eq(clientsTable.id, id))
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(client);
});

router.delete("/clients/:id", async (req, res) => {
  const { id } = DeleteClientParams.parse({ id: Number(req.params.id) });
  evictYeastarToken(id);
  await db.delete(clientsTable).where(eq(clientsTable.id, id));
  res.status(204).send();
});

// ── Per-client Yeastar connection test ───────────────────────────────────────

const TestYeastarBody = z.object({
  pbxUrl: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

/**
 * POST /api/clients/:id/yeastar/test
 * Test the Yeastar OAuth credentials stored (or provided inline) for this client.
 * Credentials from the request body are used if provided; otherwise the stored ones.
 */
router.post("/clients/:id/yeastar/test", async (req, res) => {
  const clientDbId = Number(req.params.id);

  // Allow testing with inline credentials (before saving)
  const bodyParsed = TestYeastarBody.safeParse(req.body);
  let pbxUrl: string;
  let clientId: string;
  let clientSecret: string;

  if (bodyParsed.success) {
    pbxUrl = bodyParsed.data.pbxUrl;
    clientId = bodyParsed.data.clientId;
    clientSecret = bodyParsed.data.clientSecret;
  } else {
    // Fall back to stored credentials
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientDbId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    if (!client.yeastarApiUrl || !client.yeastarClientId || !client.yeastarClientSecret) {
      res.status(400).json({ error: "Yeastar API not configured on this IPBX" });
      return;
    }
    pbxUrl = client.yeastarApiUrl;
    clientId = client.yeastarClientId;
    clientSecret = client.yeastarClientSecret;
  }

  logger.info({ clientDbId, pbxUrl, clientId }, "Testing Yeastar connection");
  const result = await testYeastarConnection(pbxUrl, clientId, clientSecret);

  // Persist the verification result
  await db
    .update(clientsTable)
    .set({ yeastarVerified: result.success, updatedAt: new Date() })
    .where(eq(clientsTable.id, clientDbId));

  if (result.success) {
    evictYeastarToken(clientDbId); // will be re-fetched on next real call
    res.json({ success: true });
  } else {
    logger.warn({ clientDbId, pbxUrl, error: result.error }, "Yeastar connection test failed");
    res.status(422).json({ success: false, error: result.error });
  }
});

export default router;
