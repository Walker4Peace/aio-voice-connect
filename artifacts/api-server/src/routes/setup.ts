import { Router } from "express";
import bcrypt from "bcryptjs";
import dns from "dns";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import http from "http";
import https from "https";
import { db, adminConfigTable } from "@workspace/db";

const execAsync = promisify(exec);
const router = Router();

const NGINX_CONF_PATH = "/etc/nginx/sites-available/aio-voice-connect.conf";
const NGINX_ENABLED_PATH = "/etc/nginx/sites-enabled/aio-voice-connect.conf";

// ── nginx config builders ────────────────────────────────────────────────────

function nginxLocations(): string {
  const apiPort = process.env["PORT"] ?? "3101";
  const staticRoot = path.resolve(
    process.cwd(),
    "artifacts/aio-voice-connect-manager/dist/public",
  );

  return `
    # API backend — proxy to Node.js process
    location /api/ {
        proxy_pass         http://127.0.0.1:${apiPort}/api/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    # React SPA — serve static files; fall back to index.html
    root  ${staticRoot};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;

        # Cache hashed static assets aggressively
        location ~* \\.(?:js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp)$ {
            expires     1y;
            add_header  Cache-Control "public, immutable";
            access_log  off;
        }
    }

    # Security headers
    add_header X-Frame-Options        "SAMEORIGIN"    always;
    add_header X-Content-Type-Options "nosniff"       always;
    add_header Referrer-Policy        "strict-origin"  always;

    client_max_body_size 16M;`;
}

function buildNginxConf(domain?: string | null): string {
  const ipBlock = `# IP access — always reachable regardless of domain
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
${nginxLocations()}
}
`;

  if (!domain) return ipBlock;

  return `${ipBlock}
# Domain access
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
${nginxLocations()}
}
`;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Returns true if the file/symlink exists. */
async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Quick HTTP(S) GET — resolves with status code or rejects on network error. */
function httpGet(url: string, timeoutMs = 6000): Promise<number> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, res => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}

/**
 * Build the full set of manual commands needed to configure nginx for a domain.
 * These are returned when the service cannot run sudo (NoNewPrivileges=true in systemd).
 */
function manualSetupCommands(domain: string): string[] {
  return [
    `# Download the nginx config from the button above, then copy it to the server:`,
    `sudo cp /tmp/aio-voice-connect.conf ${NGINX_CONF_PATH}`,
    `sudo ln -sf ${NGINX_CONF_PATH} ${NGINX_ENABLED_PATH}`,
    `sudo nginx -t && sudo systemctl reload nginx`,
    `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain}`,
  ];
}

function cleanupCommands(): string[] {
  return [
    `sudo rm -f ${NGINX_CONF_PATH}`,
    `sudo rm -f ${NGINX_ENABLED_PATH}`,
    `sudo nginx -t && sudo systemctl reload nginx`,
  ];
}

// ── routes ───────────────────────────────────────────────────────────────────

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
      username, passwordHash, language, timezone,
      setupComplete: true, updatedAt: now,
    });
  } else {
    await db.insert(adminConfigTable).values({
      username, passwordHash, language, timezone, setupComplete: true,
    });
  }

  const config = await db.query.adminConfigTable.findFirst();
  req.session.adminId = config!.id;
  req.session.username = config!.username;
  res.json({ ok: true });
});

// GET /api/setup/domain/nginx-config — download the generated nginx config
router.get("/setup/domain/nginx-config", (req, res) => {
  const domain = typeof req.query.domain === "string" ? req.query.domain.trim() : null;
  if (domain && !/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(domain)) {
    res.status(400).send("Invalid domain");
    return;
  }
  const conf = buildNginxConf(domain ?? undefined);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="aio-voice-connect.conf"`);
  res.send(conf);
});

// DELETE /api/setup/domain — reset domain config (returns cleanup commands since service
// cannot write /etc/nginx directly under systemd NoNewPrivileges=true)
router.delete("/setup/domain", async (req, res) => {
  const confExists = await fileExists(NGINX_CONF_PATH);
  const linkExists = await fileExists(NGINX_ENABLED_PATH);

  // Reset DB
  await db.update(adminConfigTable).set({
    domain: null, domainConfigured: false, updatedAt: new Date(),
  }).catch(() => {});

  if (!confExists && !linkExists) {
    res.json({ ok: true, message: "No nginx files found — domain reset." });
    return;
  }

  res.json({
    ok: false,
    needsManual: true,
    message: "Nginx files exist — run these commands on the server to clean up:",
    cleanupCommands: cleanupCommands(),
  });
});

// POST /api/setup/domain — configure nginx + SSL
//
// The systemd service runs with NoNewPrivileges=true, so sudo is completely
// blocked. Strategy: check file state, guide user through manual steps, then
// verify by re-validating (HTTP probe + config presence).
router.post("/setup/domain", async (req, res) => {
  const { domain } = req.body as { domain: string };
  if (!domain || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(domain)) {
    res.status(400).json({ error: "Invalid domain name" });
    return;
  }

  const steps: { step: string; success: boolean; error?: string }[] = [];

  // ── Step 0: DNS A-record resolution ─────────────────────────────────────
  let resolvedIps: string[] = [];
  try {
    resolvedIps = await dns.promises.resolve4(domain);
    steps.push({
      step: `DNS resolved → ${resolvedIps.join(", ")}`,
      success: true,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    steps.push({
      step: "DNS A record check",
      success: false,
      error: code === "ENOTFOUND"
        ? `${domain} does not resolve — point an A record to this server's public IP first, then wait for propagation (up to 48h). Tip: run \`dig @8.8.8.8 ${domain} A\` to bypass local caching.`
        : `DNS lookup failed: ${code ?? String(err)}`,
    });
    res.json({ ok: false, error: "DNS not configured yet", steps });
    return;
  }

  // ── Step 1: Check nginx config file ──────────────────────────────────────
  const confExists = await fileExists(NGINX_CONF_PATH);
  if (!confExists) {
    steps.push({ step: "Nginx config file", success: false, error: "File not found — see setup instructions below" });
    res.json({
      ok: false,
      needsManual: true,
      domain,
      steps,
      manualCommands: manualSetupCommands(domain),
      cleanupCommands: cleanupCommands(),
    });
    return;
  }
  steps.push({ step: "Nginx config file exists", success: true });

  // ── Step 2: Check symlink ─────────────────────────────────────────────────
  const linkExists = await fileExists(NGINX_ENABLED_PATH);
  if (!linkExists) {
    steps.push({ step: "Site enabled symlink", success: false, error: `${NGINX_ENABLED_PATH} not found` });
    res.json({
      ok: false,
      needsManual: true,
      domain,
      steps,
      manualCommands: [
        `sudo ln -sf ${NGINX_CONF_PATH} ${NGINX_ENABLED_PATH}`,
        `sudo nginx -t && sudo systemctl reload nginx`,
        `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain}`,
      ],
      cleanupCommands: cleanupCommands(),
    });
    return;
  }
  steps.push({ step: "Site enabled (symlink exists)", success: true });

  // ── Step 3: Verify nginx is serving the domain (HTTP probe) ───────────────
  let httpOk = false;
  try {
    const status = await httpGet(`http://${domain}/api/health`);
    httpOk = status >= 200 && status < 500; // 200 or even 401 = nginx is proxying
    steps.push({
      step: `HTTP probe → ${status}`,
      success: httpOk,
      error: httpOk ? undefined : `Unexpected HTTP status ${status}`,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    steps.push({
      step: "HTTP probe",
      success: false,
      error: `Cannot reach http://${domain} — nginx may not be running or config has errors: ${errMsg}`,
    });
    res.json({
      ok: false,
      needsManual: true,
      domain,
      steps,
      manualCommands: [
        `sudo nginx -t`,
        `sudo systemctl reload nginx`,
        `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain}`,
      ],
      cleanupCommands: cleanupCommands(),
    });
    return;
  }

  // ── Step 4: SSL check ─────────────────────────────────────────────────────
  let sslOk = false;
  try {
    const status = await httpGet(`https://${domain}/api/health`);
    sslOk = status >= 200 && status < 500;
    steps.push({
      step: `HTTPS probe → ${status}`,
      success: sslOk,
      error: sslOk ? undefined : `HTTPS responded with ${status}`,
    });
  } catch {
    steps.push({ step: "HTTPS / SSL certificate", success: false, error: "Not yet configured" });
  }

  // ── Persist domain to DB ──────────────────────────────────────────────────
  await db.update(adminConfigTable).set({ domain, domainConfigured: true, updatedAt: new Date() });

  res.json({
    ok: true,
    domain,
    sslOk,
    steps,
    ...(sslOk ? {} : {
      manualCommands: [
        `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain}`,
      ],
    }),
  });
});

export default router;
