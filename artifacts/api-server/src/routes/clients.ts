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
  const clients = await db.select().from(clientsTable).orderBy(clientsTable.createdAt);
  res.json(clients);
});

router.post("/clients", async (req, res) => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [client] = await db
    .insert(clientsTable)
    .values(parsed.data)
    .returning();
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
  const [client] = await db
    .update(clientsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
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

// ── Yeastar connection test ───────────────────────────────────────────────────

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

  if (result.success) {
    // Cache the fresh token for this client
    evictYeastarToken(clientDbId); // will be re-fetched on next real call
    res.json({ success: true });
  } else {
    logger.warn({ clientDbId, pbxUrl, error: result.error }, "Yeastar connection test failed");
    res.status(422).json({ success: false, error: result.error });
  }
});

export default router;
