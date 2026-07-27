import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, adminConfigTable } from "@workspace/db";

const router = Router();

// GET /api/auth/me — returns setup status + current user (public)
router.get("/auth/me", async (req, res) => {
  // Never cache — browser must always get a fresh session check after login/logout
  res.set("Cache-Control", "no-store");
  try {
    const config = await db.query.adminConfigTable.findFirst();
    if (!config?.setupComplete) {
      res.json({ setupComplete: false, user: null });
      return;
    }
    if (!req.session?.adminId) {
      res.json({ setupComplete: true, user: null });
      return;
    }
    res.json({
      setupComplete: true,
      user: {
        id: config.id,
        username: config.username,
        language: config.language,
        timezone: config.timezone,
        domain: config.domain,
        domainConfigured: config.domainConfigured,
      },
    });
  } catch {
    res.json({ setupComplete: false, user: null });
  }
});

// POST /api/auth/login
router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body as { username: string; password: string };
  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }
  const config = await db.query.adminConfigTable.findFirst();
  if (!config) {
    res.status(400).json({ error: "Setup not complete" });
    return;
  }
  const valid = await bcrypt.compare(password, config.passwordHash);
  if (!valid || config.username !== username) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  req.session.adminId = config.id;
  req.session.username = config.username;
  res.json({
    user: {
      id: config.id,
      username: config.username,
      language: config.language,
      timezone: config.timezone,
      domain: config.domain,
      domainConfigured: config.domainConfigured,
    },
  });
});

// POST /api/auth/logout
router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

export default router;
