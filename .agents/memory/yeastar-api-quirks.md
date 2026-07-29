---
name: Yeastar P-Series OpenAPI quirks
description: Confirmed-working integration details for Yeastar P-Series PBX OpenAPI v1.0 — auth format, required headers, token passing, endpoint names, and call/query response structure.
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
- **Response includes `call_id`** (String) — the Yeastar call ID for this specific call. Capture and store it for use with `call/query` to poll the exact call state.
- `caller` MUST be an internal extension number — external phone numbers as caller silently do nothing (API returns errcode 0 but no call is placed).
- `caller/callee` are NOT simultaneously dialed. Yeastar is caller-first: rings extension (caller) first, then calls customer (callee) after extension answers.

## Query active calls (`/openapi/v1.0/call/query`)

Source: P-Series Software Edition Developer Guide (PDF, confirmed July 2026)

- **GET** with token as query param. Filter options:
  - `?call_id=<id>` — query a specific call (preferred, most precise)
  - `?extension=<ext_num>` — query all active calls for an extension
  - `?type=outbound` — query all outbound calls

- **Response structure** (NOT a flat array of members — each member is a typed object):
```json
{
  "errcode": 0,
  "errmsg": "SUCCESS",
  "data": [
    {
      "call_id": "1650012665.266",
      "members": [
        {
          "extension": {
            "number": "1005",
            "channel_id": "PJSIP/1005-0000008a",
            "member_status": "ALERT",
            "call_path": ""
          }
        },
        {
          "outbound": {
            "from": "1005",
            "to": "+212661209845",
            "trunk_name": "my-trunk",
            "channel_id": "PJSIP/trunk-endpoint-0000008b",
            "member_status": "RING",
            "call_path": ""
          }
        }
      ]
    }
  ]
}
```

- **`member_status` values** (same for `extension`, `outbound`, and `inbound` member types):

  | Status     | Meaning |
  |------------|---------|
  | `ALERT`    | Caller (extension) hears ringback — customer not yet answered |
  | `RING`     | Callee (customer/trunk) phone is ringing |
  | `ANSWERED` | Call confirmed connected from caller (extension) perspective |
  | `ANSWER`   | Callee answered and is in talking state |
  | `HOLD`     | Call is held |
  | `BYE`      | Call is hung up |

- **Customer answered detection**: wait for `outbound.member_status === "ANSWER"` OR `extension.member_status === "ANSWERED"` (either confirms the customer picked up).
- Non-zero errcode on `call/query` usually means no active calls (not a real error) — treat as empty list and continue polling.

## sip-agent binary: context_webhook_url vs first_message in config.json

**Confirmed from live logs (July 2026):**

- `first_message` **present** in config.json → binary uses it directly, **skips** `context_webhook_url` entirely. Greeting plays immediately into ringback.
- `first_message` **absent** in config.json → binary calls `context_webhook_url`, which is the timing-control hook.

**Why this matters:** To delay the greeting until the customer answers (outbound timing fix), `first_message` must be **omitted** from the outbound config.json. The Node.js context endpoint then serves the greeting after `waitForCallAnswered()` resolves.

**How to apply:** In `deployment.ts` `buildConfig()`, for the `elevenlabs` case: only include `first_message` when `overrides` is not provided (inbound). When `overrides` is provided (outbound restart), omit it — condition: `!overrides && firstMsg`.

The previous session had this backwards (thought non-empty first_message triggered the webhook — wrong).

## Error codes

| Code  | Meaning |
|-------|---------|
| 0     | Success |
| 40002 | PARAMETER ERROR — missing/wrong field (check User-Agent header and body field names) |
| 10001 | INTERFACE NOT EXISTED — wrong endpoint URL |
| 10004 | TOKEN EXPIRED — evict cache and re-auth |

**Why:** These were discovered through iterative live debugging against a real Yeastar P-Series instance and confirmed from the official P-Series Software Edition Developer Guide PDF (July 2026).
