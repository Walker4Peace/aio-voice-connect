/**
 * Yeastar P-Series PBX OAuth token manager.
 *
 * Yeastar uses short-lived access tokens (default: 30 min) with a refresh token.
 * Authentication: POST /openapi/v1.0/get_token with { username: clientId, password: clientSecret }
 * Yeastar always returns HTTP 200 — success is determined by errcode === 0 in the body.
 * A User-Agent header is required by the Yeastar API.
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { logger } from "../lib/logger.js";

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
          "User-Agent": "SipAgent/1.0",
          ...headers,
        },
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          // Yeastar always returns HTTP 200 — treat as ok regardless of status
          resolve({
            ok: true,
            status: res.statusCode ?? 200,
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

interface TokenEntry {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const tokenCache = new Map<number, TokenEntry>();

interface YeastarTokenResponse {
  access_token?: string;
  refresh_token?: string;
  access_token_expire_time?: number;
  refresh_token_expire_time?: number;
  errcode?: number;
  errmsg?: string;
}

function buildEntry(data: YeastarTokenResponse): TokenEntry {
  const expiresAt = new Date(Date.now() + ((data.access_token_expire_time ?? 1800) - 60) * 1000);
  return { accessToken: data.access_token!, refreshToken: data.refresh_token!, expiresAt };
}

async function fetchNewToken(
  pbxUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<TokenEntry> {
  const url = `${pbxUrl.replace(/\/$/, "")}/openapi/v1.0/get_token`;
  const body = { username: clientId, password: clientSecret };

  logger.info(
    {
      url,
      requestFields: Object.keys(body),
      clientIdLength: clientId.length,
      clientSecretLength: clientSecret.length,
    },
    "Yeastar: requesting new access token",
  );

  const res = await yeastarPost(url, body);

  const data = res.json<YeastarTokenResponse>();
  logger.info(
    { status: res.status, errcode: data.errcode, errmsg: data.errmsg, rawBody: res.text },
    "Yeastar: get_token response",
  );

  // Yeastar returns HTTP 200 even on failure — success = errcode 0
  if (data.errcode !== 0 || !data.access_token) {
    const errcode = data.errcode ?? "?";
    const errmsg = data.errmsg ?? res.text;

    // Provide actionable messages for known Yeastar error codes
    if (data.errcode === 70087) {
      throw new Error(
        `IP FORBIDDEN (errcode 70087): The server's IP address is not whitelisted in Yeastar. ` +
        `Go to Yeastar PBX → Integrations → API → Application and add this server's IP to the allowed list. ` +
        `Note: cloud FQDNs (*.ras.yeastar.com) do not use port 8088 — use the URL without a port number.`,
      );
    }
    if (data.errcode === 60002) {
      throw new Error(
        `MAX LIMITATION EXCEEDED (errcode 60002): The Yeastar PBX has reached its maximum number of concurrent API sessions. ` +
        `Existing tokens expire after ~30 minutes. To clear them immediately, go to Yeastar PBX → Integrations → API → Application and revoke active tokens, then try again.`,
      );
    }
    if (data.errcode === 1) {
      throw new Error(
        `Invalid credentials (errcode 1): Check the Client ID and Client Secret in the Yeastar PBX API settings.`,
      );
    }
    if (data.errcode === 10001) {
      throw new Error(
        `Access token expired (errcode 10001). The token will be refreshed automatically on the next call.`,
      );
    }

    throw new Error(
      `Yeastar authentication failed (HTTP ${res.status}): errcode=${errcode} errmsg="${errmsg}"`,
    );
  }

  return buildEntry(data);
}

async function doRefreshToken(pbxUrl: string, entry: TokenEntry): Promise<TokenEntry> {
  const url = `${pbxUrl.replace(/\/$/, "")}/openapi/v1.0/refresh_token`;
  logger.info({ url }, "Yeastar: refreshing access token");

  const res = await yeastarPost(url, { refreshtoken: entry.refreshToken });

  const data = res.json<YeastarTokenResponse>();
  logger.info(
    { status: res.status, errcode: data.errcode, errmsg: data.errmsg },
    "Yeastar: refresh_token response",
  );

  if (data.errcode !== 0 || !data.access_token) {
    throw new Error(
      `Yeastar token refresh failed (HTTP ${res.status}): ${data.errmsg ?? res.text}`,
    );
  }

  return buildEntry({
    ...data,
    refresh_token: data.refresh_token ?? entry.refreshToken,
  });
}

export interface YeastarClient {
  id: number;
  yeastarApiUrl?: string | null;
  yeastarClientId?: string | null;
  yeastarClientSecret?: string | null;
}

export async function getYeastarToken(client: YeastarClient): Promise<string> {
  const { id, yeastarApiUrl, yeastarClientId, yeastarClientSecret } = client;

  if (!yeastarApiUrl || !yeastarClientId || !yeastarClientSecret) {
    throw new Error(
      "Yeastar API not fully configured (requires PBX URL, Client ID, and Client Secret)",
    );
  }

  const cached = tokenCache.get(id);
  if (cached && cached.expiresAt > new Date()) {
    return cached.accessToken;
  }

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

export function evictYeastarToken(clientDbId: number): void {
  tokenCache.delete(clientDbId);
}

// ── Generic GET helper ────────────────────────────────────────────────────────

/**
 * Make a GET request to a Yeastar PBX URL (token passed as query param).
 * Same quirks as yeastarPost: always returns HTTP 200, success = errcode 0.
 */
export async function yeastarGet(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; text: string; json<T>(): T }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib: typeof https = isHttps ? https : (http as unknown as typeof https);

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port) || (isHttps ? 443 : 80),
        path: parsed.pathname + (parsed.search || ""),
        method: "GET",
        headers: {
          "User-Agent": "SipAgent/1.0",
          ...headers,
        },
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: true,
            status: res.statusCode ?? 200,
            text,
            json<T>() { return JSON.parse(text) as T; },
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}
