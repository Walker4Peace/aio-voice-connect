import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, adminConfigTable } from "@workspace/db";

const router = Router();

// PATCH /api/settings/account — update password / language / timezone (requires auth)
router.patch("/settings/account", async (req, res) => {
  if (!req.session?.adminId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { password, language, timezone } = req.body as {
    password?: string;
    language?: "en" | "fr";
    timezone?: string;
  };

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (password) {
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }
    patch.passwordHash = await bcrypt.hash(password, 12);
  }
  if (language) patch.language = language;
  if (timezone) patch.timezone = timezone;

  await db.update(adminConfigTable).set(patch);
  const config = await db.query.adminConfigTable.findFirst();
  res.json({
    user: {
      id: config!.id,
      username: config!.username,
      language: config!.language,
      timezone: config!.timezone,
      domain: config!.domain,
      domainConfigured: config!.domainConfigured,
    },
  });
});

export default router;
