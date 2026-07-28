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
    throw new Error(
      `Yeastar authentication failed (HTTP ${res.status}): errcode=${data.errcode ?? "?"} errmsg="${data.errmsg ?? res.text}"`,
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
