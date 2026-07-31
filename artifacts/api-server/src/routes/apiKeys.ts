/**
 * API Key Management Routes (session-auth required)
 *
 * POST   /api/api-keys          — create a new key (returns plaintext ONCE)
 * GET    /api/api-keys          — list all keys (hashes never returned)
 * DELETE /api/api-keys/:id      — revoke a key
 */
import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db, apiKeysTable } from "@workspace/db";

const router = Router();

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// ── Create ────────────────────────────────────────────────────────────────────

router.post("/api-keys", async (req, res) => {
  if (!req.session?.adminId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  // Generate a secure random key: aio_sk_ + 32 random hex bytes = 72 chars total
  const raw = "aio_sk_" + randomBytes(32).toString("hex");
  const prefix = raw.slice(0, 14); // "aio_sk_" + 7 chars

  const [row] = await db.insert(apiKeysTable).values({
    name: name.trim(),
    keyHash: hashKey(raw),
    keyPrefix: prefix,
  }).returning();

  // Return the plaintext key ONCE — never stored
  res.status(201).json({ ...row, plaintext: raw });
});

// ── List ──────────────────────────────────────────────────────────────────────

router.get("/api-keys", async (req, res) => {
  if (!req.session?.adminId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const keys = await db
    .select({
      id: apiKeysTable.id,
      name: apiKeysTable.name,
      keyPrefix: apiKeysTable.keyPrefix,
      active: apiKeysTable.active,
      createdAt: apiKeysTable.createdAt,
      lastUsedAt: apiKeysTable.lastUsedAt,
    })
    .from(apiKeysTable)
    .orderBy(apiKeysTable.createdAt);

  res.json(keys);
});

// ── Revoke ────────────────────────────────────────────────────────────────────

router.delete("/api-keys/:id", async (req, res) => {
  if (!req.session?.adminId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.delete(apiKeysTable).where(eq(apiKeysTable.id, id));
  res.status(204).send();
});

// ── Export hash helper so outbound auth can use it ───────────────────────────
export { hashKey };

export default router;
