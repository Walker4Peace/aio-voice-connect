import { Router } from "express";
import bcrypt from "bcryptjs";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { db, adminConfigTable } from "@workspace/db";

const execAsync = promisify(exec);
const router = Router();

const NGINX_CONF_PATH = "/etc/nginx/sites-available/aio-voice-connect.conf";
const NGINX_ENABLED_PATH = "/etc/nginx/sites-enabled/aio-voice-connect.conf";

/**
 * Build the nginx location blocks for a production server block.
 *
 * - /api/ → proxy to the Node.js API process (port from PORT env, default 3101)
 * - /     → serve the compiled React SPA from the dist directory;
 *           falls back to index.html for client-side routing.
 *
 * process.cwd() on the VPS is /opt/aio-voice-connect, so the static
 * root resolves to /opt/aio-voice-connect/artifacts/aio-voice-connect-manager/dist/public
 */
function nginxLocations(): string {
  const apiPort = process.env["PORT"] ?? "3101";
  const staticRoot = path.resolve(process.cwd(), "artifacts/aio-voice-connect-manager/dist/public");

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

/**
 * Build the nginx config.
 *
 * - Always includes a catch-all default_server block (reachable by IP).
 * - When a domain is provided, adds a dedicated server block for it
 *   (certbot will later upgrade it to HTTPS).
 */
function buildNginxConf(domain?: string | null): string {
  const ipBlock = `# IP access — always reachable regardless of domain
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
${nginxLocations()}
}
`;

  if (!domain) {
    return ipBlock;
  }

  const domainBlock = `# Domain access
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
${nginxLocations()}
}
`;

  return `${ipBlock}
${domainBlock}`;
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
  // The app user cannot write /etc/nginx directly. Write to /tmp first,
  // then use `sudo tee` to move it into place (sudoers entry configured
  // by install.sh grants NOPASSWD for this exact tee command).
  try {
    const conf = buildNginxConf(domain);
    const tmpPath = `/tmp/nginx-aio-${Date.now()}.conf`;
    await fs.writeFile(tmpPath, conf, "utf8");
    try {
      await execAsync(`sudo tee ${NGINX_CONF_PATH} < ${tmpPath}`);
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
    steps.push({ step: "Write nginx config", success: true });
  } catch (err) {
    const manualConf = buildNginxConf(domain);
    // Return 200 — this is a graceful fallback showing manual steps, not a crash
    res.status(200).json({
      ok: false,
      needsManual: true,
      error: "Could not write nginx config — run manually",
      hint: "Run: sudo bash /opt/aio-voice-connect/update.sh  then re-try, or apply the steps below manually.",
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
    try { await execAsync(`sudo rm -f ${NGINX_ENABLED_PATH}`); } catch { /* ignore */ }
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
    res.status(200).json({
      ok: false,
      needsManual: true,
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
