---
name: Yeastar P-Series OpenAPI quirks
description: Confirmed-working integration details for Yeastar P-Series PBX OpenAPI v1.0 — auth format, required headers, token passing, and endpoint names.
---

# Yeastar P-Series OpenAPI v1.0 — Integration Quirks

## Authentication (`/openapi/v1.0/get_token`)

- **Method:** `POST` with `Content-Type: application/json`
- **Body:** `{ "username": "<Client ID>", "password": "<Client Secret>" }`
  - Client ID and Client Secret come from Yeastar dashboard → Integrations → API
  - Password is the **raw** Client Secret — no MD5 hashing, no encoding
- **Required HTTP header:** `User-Agent: <any non-empty string>` — Yeastar returns errcode 40002 "PARAMETER ERROR" if this header is missing (curl sends it automatically; Node.js `http.request` does not)
- **Always returns HTTP 200** — success is `errcode === 0` in the body, not the HTTP status

## Token usage

- Pass the access token as a **query parameter**: `?access_token=<token>`
- Do NOT use `Authorization: Bearer <token>` — Yeastar ignores it and returns errcode 10004 "TOKEN EXPIRED"
- Each new `get_token` call **invalidates** previously issued tokens for the same client — avoid calling get_token more than needed (e.g. test-connection flows should update the shared cache, not fetch throwaway tokens)
- On errcode 10004 (TOKEN EXPIRED): evict cache and retry once with a fresh token

## Outbound call (`/openapi/v1.0/call/dial`)

- Correct endpoint: `/openapi/v1.0/call/dial` (NOT `dial_out` — that returns errcode 10001 "INTERFACE NOT EXISTED")
- Body: `{ "caller": "<extension_number>", "callee": "<phone_number>" }`
- Pass token as query param: `/openapi/v1.0/call/dial?access_token=<token>`

## Error codes

| Code  | Meaning |
|-------|---------|
| 0     | Success |
| 40002 | PARAMETER ERROR — missing/wrong field (check User-Agent header and body field names) |
| 10001 | INTERFACE NOT EXISTED — wrong endpoint URL |
| 10004 | TOKEN EXPIRED — evict cache and re-auth |

**Why:** These were discovered through iterative live debugging against a real Yeastar P-Series instance. None of them are obvious from the API docs.
