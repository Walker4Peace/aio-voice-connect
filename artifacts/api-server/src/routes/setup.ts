import { Router } from "express";
import bcrypt from "bcryptjs";
import dns from "dns";
import fs from "fs/promises";
import path from "path";
import http from "http";
import https from "https";
import { db, adminConfigTable } from "@workspace/db";

const router = Router();

const NGINX_CONF_PATH = "/etc/nginx/sites-available/aio-voice-connect.conf";
const NGINX_ENABLED_PATH = "/etc/nginx/sites-enabled/aio-voice-connect.conf";

// On the VPS, process.cwd() === /opt/aio-voice-connect
const INSTALL_DIR = process.cwd();
const PENDING_CONF = path.join(INSTALL_DIR, "nginx-pending.conf");
const PENDING_DOMAIN = path.join(INSTALL_DIR, "nginx-pending-domain.txt");
const RESULT_FILE = path.join(INSTALL_DIR, "nginx-setup-result.json");

// ── nginx config builders ────────────────────────────────────────────────────

function nginxLocations(): string {
  const apiPort = process.env["PORT"] ?? "3101";
  const staticRoot = path.resolve(INSTALL_DIR, "artifacts/aio-voice-connect-manager/dist/public");

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

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

function httpGet(url: string, timeoutMs = 6000): Promise<number> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, res => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}

/** Resolve a domain using Google/Cloudflare to bypass OS DNS cache. */
async function resolveDomain(domain: string): Promise<string[]> {
  const resolver = new dns.promises.Resolver();
  resolver.setServers(["8.8.8.8", "1.1.1.1"]);
  return resolver.resolve4(domain);
}

/**
 * Write trigger files and wait up to 30 s for the systemd path-unit helper
 * to process them and write nginx-setup-result.json.
 * Returns null if the helper never responds (not installed / not running).
 */
async function runHelper(conf: string, domain: string): Promise<{
  ok: boolean; sslOk?: boolean; sslError?: string; step?: string; error?: string;
} | null> {
  // Clear any stale result from a previous run
  await fs.unlink(RESULT_FILE).catch(() => {});

  // Write trigger files — systemd path unit watches for PENDING_CONF
  await fs.writeFile(PENDING_CONF, conf, "utf8");
  await fs.writeFile(PENDING_DOMAIN, domain, "utf8");

  const TIMEOUT = 30_000;
  const INTERVAL = 500;
  const deadline = Date.now() + TIMEOUT;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, INTERVAL));
    try {
      const raw = await fs.readFile(RESULT_FILE, "utf8");
      await fs.unlink(RESULT_FILE).catch(() => {});
      return JSON.parse(raw.trim());
    } catch {
      // Not ready yet — keep polling
    }
  }

  // Timeout — clean up and report
  await fs.unlink(PENDING_CONF).catch(() => {});
  await fs.unlink(PENDING_DOMAIN).catch(() => {});
  return null;
}

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

// POST /api/setup — create admin account
router.post("/setup", async (req, res) => {
  const { username, password, language, timezone } = req.body as {
    username: string; password: string; language: "en" | "fr"; timezone: string;
  };
  if (!username || !password || !language || !timezone) {
    res.status(400).json({ error: "All fields are required" }); return;
  }
  if (username.length < 3) { res.status(400).json({ error: "Username must be at least 3 characters" }); return; }
  if (password.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }

  const existing = await db.query.adminConfigTable.findFirst();
  if (existing?.setupComplete) { res.status(409).json({ error: "Setup already complete" }); return; }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  if (existing) {
    await db.update(adminConfigTable).set({ username, passwordHash, language, timezone, setupComplete: true, updatedAt: now });
  } else {
    await db.insert(adminConfigTable).values({ username, passwordHash, language, timezone, setupComplete: true });
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
    res.status(400).send("Invalid domain"); return;
  }
  const conf = buildNginxConf(domain ?? undefined);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="aio-voice-connect.conf"`);
  res.send(conf);
});

// DELETE /api/setup/domain — reset domain in DB + return cleanup commands
router.delete("/setup/domain", async (_req, res) => {
  const [confExists, linkExists] = await Promise.all([
    fileExists(NGINX_CONF_PATH),
    fileExists(NGINX_ENABLED_PATH),
  ]);
  await db.update(adminConfigTable).set({ domain: null, domainConfigured: false, updatedAt: new Date() }).catch(() => {});

  if (!confExists && !linkExists) {
    res.json({ ok: true, message: "No nginx files found — domain reset." }); return;
  }
  res.json({
    ok: false,
    needsManual: true,
    message: "Nginx files exist on the server — run these commands to clean up:",
    cleanupCommands: cleanupCommands(),
  });
});

// POST /api/setup/domain — configure nginx + SSL
//
// The app runs under systemd with CapabilityBoundingSet=CAP_NET_BIND_SERVICE,
// which means sudo and setuid are blocked in the service process.
//
// One-click flow: write trigger files → poll for the privileged
// nginx-helper.sh result (run as root via aio-nginx-setup.path systemd unit).
//
// Graceful fallback: if the helper is not installed or doesn't respond within
// 30 s, check whether files are already in place (manual setup), then do an
// HTTP probe. If everything looks good, save and report success; otherwise
// return manual setup instructions.
router.post("/setup/domain", async (req, res) => {
  const { domain } = req.body as { domain: string };
  if (!domain || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(domain)) {
    res.status(400).json({ error: "Invalid domain name" }); return;
  }

  const steps: { step: string; success: boolean; error?: string }[] = [];

  // ── Step 0: DNS check via public resolvers (bypasses OS DNS cache) ────────
  let resolvedIps: string[] = [];
  try {
    resolvedIps = await resolveDomain(domain);
    steps.push({ step: `DNS resolved via 8.8.8.8 → ${resolvedIps.join(", ")}`, success: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    steps.push({
      step: "DNS A record check",
      success: false,
      error: code === "ENOTFOUND"
        ? `${domain} does not resolve yet — point an A record to this server's IP and wait a few minutes. Propagation usually takes 5–15 min (up to 48h). Run \`dig @8.8.8.8 ${domain} A\` to check without local caching.`
        : `DNS lookup failed: ${code ?? String(err)}`,
    });
    res.json({ ok: false, error: "DNS not configured yet", steps });
    return;
  }

  // ── Step 1: try the privileged helper (systemd path unit) ────────────────
  const conf = buildNginxConf(domain);
  const helperResult = await runHelper(conf, domain);

  if (helperResult !== null) {
    // Helper responded — build step list from its result
    if (!helperResult.ok) {
      steps.push({
        step: helperResult.step ?? "nginx setup",
        success: false,
        error: helperResult.error ?? "Unknown error",
      });
      res.json({ ok: false, needsManual: false, domain, steps, cleanupCommands: cleanupCommands() });
      return;
    }

    steps.push({ step: "nginx config written & site enabled", success: true });
    steps.push({ step: "nginx reloaded", success: true });

    if (helperResult.sslOk) {
      steps.push({ step: "SSL certificate issued (Let's Encrypt)", success: true });
    } else {
      steps.push({
        step: "SSL certificate",
        success: false,
        error: helperResult.sslError ?? "certbot did not complete — see /var/log/letsencrypt/",
      });
    }

    await db.update(adminConfigTable).set({ domain, domainConfigured: true, updatedAt: new Date() });

    res.json({
      ok: true, domain, sslOk: helperResult.sslOk, steps,
      ...(helperResult.sslOk ? {} : {
        manualCommands: [`sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain}`],
      }),
    });
    return;
  }

  // ── Helper not responding — check if files are already in place ───────────
  steps.push({
    step: "Auto-setup helper",
    success: false,
    error: "Helper service not responding (run update.sh to install it), checking for manual setup…",
  });

  const [confExists, linkExists] = await Promise.all([
    fileExists(NGINX_CONF_PATH),
    fileExists(NGINX_ENABLED_PATH),
  ]);

  if (!confExists) {
    steps.push({ step: "Nginx config file", success: false, error: "File not found" });
    res.json({ ok: false, needsManual: true, domain, steps, manualCommands: manualSetupCommands(domain), cleanupCommands: cleanupCommands() });
    return;
  }
  steps.push({ step: "Nginx config file exists", success: true });

  if (!linkExists) {
    steps.push({ step: "Site enabled symlink", success: false, error: `${NGINX_ENABLED_PATH} not found` });
    res.json({
      ok: false, needsManual: true, domain, steps,
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

  // HTTP probe — verify nginx is actually serving the domain
  let httpOk = false;
  try {
    const status = await httpGet(`http://${domain}/api/health`);
    httpOk = status >= 200 && status < 500;
    steps.push({ step: `HTTP probe → ${status}`, success: httpOk, error: httpOk ? undefined : `Unexpected status ${status}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "HTTP probe", success: false, error: `Cannot reach http://${domain}: ${msg}` });
    res.json({
      ok: false, needsManual: true, domain, steps,
      manualCommands: [
        `sudo nginx -t`,
        `sudo systemctl reload nginx`,
        `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain}`,
      ],
      cleanupCommands: cleanupCommands(),
    });
    return;
  }

  // SSL probe
  let sslOk = false;
  try {
    const status = await httpGet(`https://${domain}/api/health`);
    sslOk = status >= 200 && status < 500;
    steps.push({ step: `HTTPS probe → ${status}`, success: sslOk });
  } catch {
    steps.push({ step: "HTTPS / SSL", success: false, error: "Not yet configured" });
  }

  await db.update(adminConfigTable).set({ domain, domainConfigured: true, updatedAt: new Date() });
  res.json({
    ok: true, domain, sslOk, steps,
    ...(sslOk ? {} : {
      manualCommands: [`sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain}`],
    }),
  });
});

export default router;
