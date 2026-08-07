---
name: sip-agent Go binary
description: Source location, build command, concurrent-write fix, and sipgo v1.0.0 API gotchas for the sip-agent binary.
---

## Source location
`sip2/` in the repo root. Files: config.go, main.go, helpers.go, audio.go, rtp.go, api.go, elevenlabs.go, sip.go, outbound.go, stubs.go.

## Build command
```bash
cd sip2
go mod tidy  # first run: downloads dependencies (requires Go ≥1.23 — install go-1.25 module)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o sip-agent-new .
cp sip-agent-new ../.bin/sip-agent
chmod +x ../.bin/sip-agent
```

## The concurrent-write fix (WHY the old binary panicked)
gorilla/websocket requires serialized writes. The old binary had two goroutines (`rtpToElevenLabs` and `elevenLabsToRTP`) writing to the same `*websocket.Conn` concurrently → `panic: concurrent write to websocket connection`.

**Fix:** `ElevenLabsConn` wrapper in `elevenlabs.go` uses a single writer goroutine (`writerLoop`) fed via a buffered channel (`writeCh chan elMsg`). ALL goroutines write to `writeCh`; the `writerLoop` is the only goroutine calling `conn.WriteMessage`. See `newElevenLabsConn()`.

## sipgo v1.0.0 API gotchas
- UA type is `sipgo.UserAgent` (not `sipgo.UA`). Constructor: `sipgo.NewUA(...UserAgentOption)`.
- `sipgo.DialogUA` struct has only `Client *sipgo.Client` and `ContactHDR sip.ContactHeader` fields (no `Server` field).
- For outbound INVITE: `dialogUA.WriteInvite(ctx, req, sipgo.ClientRequestAddVia)` → `session.WaitAnswer(ctx, sipgo.AnswerOptions{Username, Password, OnResponse})`. `WaitAnswer` handles 401/407 digest auth automatically.
- For ACK: `session.Ack(ctx)`. For BYE: `session.Bye(ctx)`.
- `resp.Headers()` is a method returning `[]sip.Header` — iterate with `range`, not `.VisitAll()`.
- `client.DoDigestAuth(ctx, req, resp401, sipgo.DigestAuth{Username, Password})` for REGISTER auth.
- `sipgo.ClientRequestAddVia` and `sipgo.ClientRequestAddRecordRoute` are exported package-level functions.
- `tx.Terminate()` exists; `tx.Cancel()` does NOT exist on `sip.ClientTransaction`.
- `sip.NewAckRequest` / `sip.NewByeRequest` do NOT exist as exported functions; use `session.Ack()` / `session.Bye()`.

## sipgo v1.0.0 requires Go ≥1.23
Install `go-1.25` module (not `go-1.21`) before building. `GONOSUMDB='*'` may be needed for `go mod tidy`.

## Config + env vars the binary reads
- `CONFIG_FILE` — path to JSON config (required)
- `SIP_USERNAME`, `SIP_AUTH_ID`, `SIP_PASSWORD`, `SIP_DOMAIN`, `SIP_SERVER` — override JSON config fields
- `SIP_OUTBOUND_PROXY` — proxy address for SIP packets
- `SIP_LOCAL_PORT`, `HTTP_PORT` — override api_port / sip.listen
- `ELEVENLABS_API_KEY` or `AI_API_KEY` — ElevenLabs API key

## Log strings deployment.ts watches for
- `"Registration successful!"` → sets sipRegistered=true
- `"Re-registration successful"` → same
- `"Error during re-registration"` → status=reconnecting
- `"INVITE received for call: <ID>"` → inbound call event
- `"BYE received for call: <ID>"` / `"Call ended: <ID>"` → call ended
- `"Connected to ElevenLabs Conversational AI"` → triggers synthetic "AI responded" log
- `"Registered bridge for call: <ID>"` / `"Unregistered bridge for call: <ID>"` → call tracking
- Raw JSON with `"tool_name":"end_call"` or `"type":"conversation_ended"` → AI ended call
- `"WARN SIP request handler not found.*method=BYE"` → outbound BYE fallback (binary killed)
