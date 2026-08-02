#!/usr/bin/env node
/**
 * AIO Voice Connect — Production static file server
 *
 * Serves the pre-built Vite output from dist/public.
 * Uses only Node.js built-in modules — no vite, no pnpm, no node_modules
 * write access required at runtime.
 *
 * SPA routing: any path that doesn't match a real file falls back to index.html.
 * Hashed assets (*.js, *.css, etc.) get a 1-year immutable cache header.
 *
 * Usage:
 *   PORT=8080 node artifacts/aio-voice-connect-manager/serve-static.mjs
 */

import http from "node:http";
import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, "dist", "public");
const PORT      = Number(process.env.PORT ?? 8080);
const HOST      = process.env.HOST ?? "0.0.0.0";

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME = {
  ".html" : "text/html; charset=utf-8",
  ".js"   : "application/javascript; charset=utf-8",
  ".mjs"  : "application/javascript; charset=utf-8",
  ".css"  : "text/css; charset=utf-8",
  ".json" : "application/json; charset=utf-8",
  ".svg"  : "image/svg+xml",
  ".png"  : "image/png",
  ".jpg"  : "image/jpeg",
  ".jpeg" : "image/jpeg",
  ".gif"  : "image/gif",
  ".webp" : "image/webp",
  ".ico"  : "image/x-icon",
  ".woff" : "font/woff",
  ".woff2": "font/woff2",
  ".ttf"  : "font/ttf",
  ".eot"  : "application/vnd.ms-fontobject",
  ".txt"  : "text/plain; charset=utf-8",
  ".xml"  : "application/xml",
  ".map"  : "application/json",
};

// Hashed filenames (content-hash in name) can be cached for 1 year.
// index.html must never be cached so users always get the latest shell.
const HASHED_EXT = new Set([".js", ".mjs", ".css", ".woff", ".woff2", ".ttf", ".eot", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const HASH_RE    = /[.\-][0-9a-f]{8,}\./i; // e.g. main.3f2a1b4c.js

function cacheHeader(filePath) {
  const ext  = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  if (base === "index.html") return "no-cache, no-store, must-revalidate";
  if (HASHED_EXT.has(ext) && HASH_RE.test(base)) return "public, max-age=31536000, immutable";
  return "public, max-age=3600"; // 1 hour for everything else
}

// ── Request handler ───────────────────────────────────────────────────────────
function handler(req, res) {
  // Strip query string and decode
  let urlPath = decodeURIComponent(req.url.split("?")[0]);

  // Map "/" to "/index.html"
  if (urlPath.endsWith("/")) urlPath += "index.html";

  let filePath = path.join(ROOT, urlPath);

  // Prevent path traversal outside ROOT
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // If the exact file doesn't exist → SPA fallback to index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, "index.html");
  }

  const ext         = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] ?? "application/octet-stream";
  const cacheCtrl   = cacheHeader(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type"  : contentType,
      "Cache-Control" : cacheCtrl,
      "X-Content-Type-Options": "nosniff",
    });
    res.end(data);
  });
}

// ── Start server ──────────────────────────────────────────────────────────────
if (!fs.existsSync(ROOT)) {
  console.error(`[serve-static] ERROR: dist/public not found at ${ROOT}`);
  console.error("[serve-static] Run 'pnpm --filter @workspace/aio-voice-connect-manager run build' first.");
  process.exit(1);
}

const server = http.createServer(handler);

server.listen(PORT, HOST, () => {
  console.log(`[serve-static] Serving ${ROOT}`);
  console.log(`[serve-static] Listening on http://${HOST}:${PORT}`);
});

server.on("error", (err) => {
  console.error("[serve-static] Server error:", err);
  process.exit(1);
});
