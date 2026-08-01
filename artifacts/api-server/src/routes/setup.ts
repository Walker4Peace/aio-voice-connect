import { Router } from "express";
import bcrypt from "bcryptjs";
import dns from "dns";
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

// GET /api/setup/domain/nginx-config — download the generated nginx config as a file
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

// POST /api/setup/domain — configure nginx + certbot
// Works during setup (no auth) OR when authenticated (from settings)
router.post("/setup/domain", async (req, res) => {
  const { domain } = req.body as { domain: string };
  if (!domain || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(domain)) {
    res.status(400).json({ error: "Invalid domain name" });
    return;
  }

  const steps: { step: string; success: boolean; error?: string }[] = [];

  // Step 0: DNS A-record check — fail fast if the domain doesn't resolve at all
  try {
    const ips = await dns.promises.resolve4(domain);
    steps.push({ step: `DNS A record resolved (${ips.join(", ")})`, success: true });
  } catch (err) {
    const errMsg = err instanceof Error ? (err as NodeJS.ErrnoException).code ?? err.message : String(err);
    steps.push({
      step: "DNS A record check",
      success: false,
      error: errMsg === "ENOTFOUND"
        ? `${domain} does not resolve — point an A record to this server's public IP first`
        : `DNS lookup failed: ${errMsg}`,
    });
    res.status(200).json({ ok: false, error: "DNS not configured yet", steps });
    return;
  }

  // Step 1: Write nginx config
  // The app user cannot write /etc/nginx directly. Write to /tmp first,
  // then pipe through `sudo tee` (NOPASSWD rule added by install.sh).
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
    // Capture the real error (e.g. "sudo: tee: command not allowed") rather than
    // dumping the config content. The frontend can download the config separately.
    const errMsg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "Write nginx config", success: false, error: errMsg });
    res.status(200).json({
      ok: false,
      needsManual: true,
      error: "Cannot write nginx config — sudo permission not set up",
      domain,
      steps,
      // Only shell commands here — no raw config content
      manualCommands: [
        `# 1. One-time sudoers setup (run as root or with sudo):`,
        `sudo tee /etc/sudoers.d/aio-voice-connect <<'EOF'\naio-voice-connect ALL=(ALL) NOPASSWD: /usr/bin/tee ${NGINX_CONF_PATH}\naio-voice-connect ALL=(ALL) NOPASSWD: /bin/ln -s ${NGINX_CONF_PATH} ${NGINX_ENABLED_PATH}\naio-voice-connect ALL=(ALL) NOPASSWD: /bin/rm -f ${NGINX_ENABLED_PATH}\naio-voice-connect ALL=(ALL) NOPASSWD: /usr/sbin/nginx -t\naio-voice-connect ALL=(ALL) NOPASSWD: /bin/systemctl reload nginx\naio-voice-connect ALL=(ALL) NOPASSWD: /usr/bin/certbot --nginx *\nEOF\nsudo chmod 440 /etc/sudoers.d/aio-voice-connect`,
        `# 2. After adding sudoers, click Validate again — OR apply manually:`,
        `# Download the config file from this UI, then:`,
        `sudo cp /tmp/aio-voice-connect.conf ${NGINX_CONF_PATH}`,
        `sudo ln -sf ${NGINX_CONF_PATH} ${NGINX_ENABLED_PATH}`,
        `sudo nginx -t && sudo systemctl reload nginx`,
        `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain}`,
      ],
    });
    return;
  }

  // Step 2: Create symlink
  try {
    await execAsync(`sudo rm -f ${NGINX_ENABLED_PATH}`).catch(() => {});
    await execAsync(`sudo ln -s ${NGINX_CONF_PATH} ${NGINX_ENABLED_PATH}`);
    steps.push({ step: "Enable site (symlink)", success: true });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "Enable site (symlink)", success: false, error: errMsg });
  }

  // Step 3: Test + reload nginx
  try {
    await execAsync("sudo nginx -t && sudo systemctl reload nginx");
    steps.push({ step: "Reload nginx", success: true });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "Reload nginx", success: false, error: errMsg });
    res.status(200).json({
      ok: false,
      needsManual: true,
      error: "nginx test/reload failed",
      domain,
      steps,
      manualCommands: [
        "sudo nginx -t && sudo systemctl reload nginx",
        `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain}`,
      ],
    });
    return;
  }

  // Step 4: Certbot SSL
  let sslOk = false;
  try {
    await execAsync(`sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain}`);
    steps.push({ step: "SSL certificate (Let's Encrypt)", success: true });
    sslOk = true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "SSL certificate (Let's Encrypt)", success: false, error: errMsg });
  }

  // Save domain to DB regardless of SSL result
  await db.update(adminConfigTable).set({ domain, domainConfigured: true, updatedAt: new Date() });

  res.json({
    ok: true,
    domain,
    sslOk,
    steps,
    ...(sslOk ? {} : {
      manualCommands: [`sudo certbot --nginx -d ${domain}`],
    }),
  });
});

export default router;
