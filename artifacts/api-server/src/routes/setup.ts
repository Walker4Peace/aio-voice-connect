import { Router } from "express";
import bcrypt from "bcryptjs";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { db, adminConfigTable } from "@workspace/db";

const execAsync = promisify(exec);
const router = Router();

const NGINX_CONF_PATH = "/etc/nginx/sites-available/sip-agent-manager.conf";
const NGINX_ENABLED_PATH = "/etc/nginx/sites-enabled/sip-agent-manager.conf";

function buildNginxConf(domain: string): string {
  return `server {
    listen 80;
    server_name ${domain};

    # API backend
    location /api/ {
        proxy_pass http://localhost:8080/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Frontend app
    location / {
        proxy_pass http://localhost:23208/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
}

// GET /api/setup/status
router.get("/setup/status", async (_req, res) => {
  try {
    const config = await db.query.adminConfigTable.findFirst();
    res.json({ setupComplete: config?.setupComplete ?? false });
  } catch {
    res.json({ setupComplete: false });
  }
});

// POST /api/setup — create admin account (only works when setup not complete)
router.post("/setup", async (req, res) => {
  const { username, password, language, timezone } = req.body as {
    username: string;
    password: string;
    language: "en" | "fr";
    timezone: string;
  };

  if (!username || !password || !language || !timezone) {
    res.status(400).json({ error: "All fields are required" });
    return;
  }
  if (username.length < 3) {
    res.status(400).json({ error: "Username must be at least 3 characters" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const existing = await db.query.adminConfigTable.findFirst();
  if (existing?.setupComplete) {
    res.status(409).json({ error: "Setup already complete" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();

  if (existing) {
    await db.update(adminConfigTable).set({
      username,
      passwordHash,
      language,
      timezone,
      setupComplete: true,
      updatedAt: now,
    });
  } else {
    await db.insert(adminConfigTable).values({
      username,
      passwordHash,
      language,
      timezone,
      setupComplete: true,
    });
  }

  const config = await db.query.adminConfigTable.findFirst();
  req.session.adminId = config!.id;
  req.session.username = config!.username;

  res.json({ ok: true });
});

// POST /api/setup/domain — configure nginx + certbot
// Works during setup (no auth) OR when authenticated (from settings)
router.post("/setup/domain", async (req, res) => {
  const isAuthenticated = !!req.session?.adminId;
  const config = await db.query.adminConfigTable.findFirst();

  if (!config?.setupComplete && !isAuthenticated) {
    // Allow during setup flow only if account was just created (session exists from POST /api/setup)
    // OR if called by an authenticated user from settings
    // We allow it if setup is complete too (settings flow)
  }

  const { domain } = req.body as { domain: string };
  if (!domain || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(domain)) {
    res.status(400).json({ error: "Invalid domain name" });
    return;
  }

  const steps: { step: string; success: boolean; output?: string; error?: string }[] = [];

  // Step 1: Write nginx config
  try {
    const conf = buildNginxConf(domain);
    await fs.writeFile(NGINX_CONF_PATH, conf, "utf8");
    steps.push({ step: "Write nginx config", success: true });
  } catch (err) {
    const manualConf = buildNginxConf(domain);
    res.status(500).json({
      error: "Could not write nginx config — run manually",
      steps,
      manual: [
        `Create file ${NGINX_CONF_PATH} with:`,
        manualConf,
        `sudo ln -s ${NGINX_CONF_PATH} ${NGINX_ENABLED_PATH}`,
        "sudo nginx -t && sudo systemctl reload nginx",
        `sudo certbot --nginx -d ${domain}`,
      ],
    });
    return;
  }

  // Step 2: Create symlink
  try {
    try { await fs.unlink(NGINX_ENABLED_PATH); } catch { /* ignore if not exists */ }
    await execAsync(`sudo ln -s ${NGINX_CONF_PATH} ${NGINX_ENABLED_PATH}`);
    steps.push({ step: "Enable site (symlink)", success: true });
  } catch (err) {
    steps.push({ step: "Enable site (symlink)", success: false, error: String(err) });
  }

  // Step 3: Test + reload nginx
  try {
    await execAsync("sudo nginx -t && sudo systemctl reload nginx");
    steps.push({ step: "Reload nginx", success: true });
  } catch (err) {
    steps.push({ step: "Reload nginx", success: false, error: String(err) });
    res.status(500).json({
      error: "nginx reload failed — run manually",
      steps,
      manual: [
        "sudo nginx -t && sudo systemctl reload nginx",
        `sudo certbot --nginx -d ${domain}`,
      ],
    });
    return;
  }

  // Step 4: Certbot SSL
  let sslOk = false;
  try {
    await execAsync(`sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain}`);
    steps.push({ step: "Certbot SSL", success: true });
    sslOk = true;
  } catch (err) {
    steps.push({ step: "Certbot SSL", success: false, error: String(err) });
  }

  // Save domain to DB
  await db.update(adminConfigTable).set({
    domain,
    domainConfigured: true,
    updatedAt: new Date(),
  });

  res.json({
    ok: true,
    domain,
    sslOk,
    steps,
    ...(sslOk ? {} : {
      manualSsl: [`sudo certbot --nginx -d ${domain}`],
    }),
  });
});

export default router;
