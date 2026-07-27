/**
 * Yeastar P-Series PBX OAuth token manager.
 *
 * Yeastar uses short-lived OAuth 2.0 access tokens (default: 30 min) with
 * a refresh token.  Tokens are cached in memory keyed by client DB id and
 * refreshed automatically before expiry.  On server restart the cache is
 * empty and we re-authenticate lazily on the first request.
 *
 * TLS note: Yeastar PBXes on local networks commonly use self-signed
 * certificates.  All requests to the PBX use Node's `https` module with
 * `rejectUnauthorized: false` so they work without importing the PBX's CA.
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { logger } from "../lib/logger.js";

// ── Low-level helper ──────────────────────────────────────────────────────────

/**
 * POST JSON to a Yeastar PBX endpoint.
 * Works for both HTTP and HTTPS; always skips TLS certificate verification.
 */
export async function yeastarPost(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; text: string; json<T>(): T }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib: typeof https = isHttps ? https : (http as unknown as typeof https);
    const bodyStr = JSON.stringify(body);
    const bodyBuf = Buffer.from(bodyStr, "utf8");

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port) || (isHttps ? 443 : 80),
        path: parsed.pathname + (parsed.search || ""),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": bodyBuf.byteLength,
          ...headers,
        },
        rejectUnauthorized: false, // Yeastar local PBXes use self-signed certs
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
          resolve({
            ok,
            status: res.statusCode ?? 0,
            text,
            json<T>() { return JSON.parse(text) as T; },
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

// ── Token cache ───────────────────────────────────────────────────────────────

interface TokenEntry {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

// Keyed by client DB id; cleared on server restart (re-auths lazily).
const tokenCache = new Map<number, TokenEntry>();

interface YeastarTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  errcode?: number;
  errmsg?: string;
}

function buildEntry(data: YeastarTokenResponse): TokenEntry {
  // Expire 60 s early to avoid clock-skew races
  const expiresAt = new Date(Date.now() + ((data.expires_in ?? 1800) - 60) * 1000);
  return { accessToken: data.access_token!, refreshToken: data.refresh_token!, expiresAt };
}

// ── Token fetch / refresh ─────────────────────────────────────────────────────

async function fetchNewToken(
  pbxUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<TokenEntry> {
  const url = `${pbxUrl.replace(/\/$/, "")}/api/v1.0.0/get_token`;
  logger.info({ url, clientId }, "Yeastar: requesting new access token");

  const res = await yeastarPost(url, {
    username: clientId,
    password: clientSecret,
    grant_type: "password",
  });

  const data = res.json<YeastarTokenResponse>();
  logger.info(
    { status: res.status, errcode: data.errcode, errmsg: data.errmsg },
    "Yeastar: get_token response",
  );

  if (!res.ok || data.errcode !== 0 || !data.access_token) {
    throw new Error(
      `Yeastar authentication failed (HTTP ${res.status}): errcode=${data.errcode ?? "?"} errmsg="${data.errmsg ?? res.text}"`,
    );
  }

  return buildEntry(data);
}

async function doRefreshToken(pbxUrl: string, entry: TokenEntry): Promise<TokenEntry> {
  const url = `${pbxUrl.replace(/\/$/, "")}/api/v1.0.0/refresh_token`;
  logger.info({ url }, "Yeastar: refreshing access token");

  const res = await yeastarPost(url, { refreshtoken: entry.refreshToken });

  const data = res.json<YeastarTokenResponse>();
  logger.info(
    { status: res.status, errcode: data.errcode, errmsg: data.errmsg },
    "Yeastar: refresh_token response",
  );

  if (!res.ok || data.errcode !== 0 || !data.access_token) {
    throw new Error(
      `Yeastar token refresh failed (HTTP ${res.status}): ${data.errmsg ?? res.text}`,
    );
  }

  return buildEntry({
    ...data,
    refresh_token: data.refresh_token ?? entry.refreshToken,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface YeastarClient {
  id: number;
  yeastarApiUrl?: string | null;
  yeastarClientId?: string | null;
  yeastarClientSecret?: string | null;
}

/**
 * Return a valid access token for the given IPBX client.
 * Uses the cache if the token is still alive, refreshes if expired,
 * and falls back to full re-authentication if the refresh fails.
 */
export async function getYeastarToken(client: YeastarClient): Promise<string> {
  const { id, yeastarApiUrl, yeastarClientId, yeastarClientSecret } = client;

  if (!yeastarApiUrl || !yeastarClientId || !yeastarClientSecret) {
    throw new Error(
      "Yeastar API not fully configured on this IPBX (requires PBX URL, Client ID, and Client Secret)",
    );
  }

  const cached = tokenCache.get(id);
  if (cached && cached.expiresAt > new Date()) {
    return cached.accessToken;
  }

  // Try refresh first
  if (cached?.refreshToken) {
    try {
      const refreshed = await doRefreshToken(yeastarApiUrl, cached);
      tokenCache.set(id, refreshed);
      return refreshed.accessToken;
    } catch (err) {
      logger.warn({ err, clientDbId: id }, "Yeastar token refresh failed — falling back to full re-auth");
    }
  }

  const entry = await fetchNewToken(yeastarApiUrl, yeastarClientId, yeastarClientSecret);
  tokenCache.set(id, entry);
  return entry.accessToken;
}

/**
 * Test a Yeastar connection with explicit credentials (for the "Test Connection" button).
 * Does NOT update the token cache.
 */
export async function testYeastarConnection(
  pbxUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await fetchNewToken(pbxUrl, clientId, clientSecret);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Evict the cached token for a client.
 * Call this when credentials change so the next request forces a fresh auth.
 */
export function evictYeastarToken(clientDbId: number): void {
  tokenCache.delete(clientDbId);
}
