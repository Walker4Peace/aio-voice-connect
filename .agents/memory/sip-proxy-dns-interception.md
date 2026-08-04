---
name: SIP FQDN Proxy — approach history and current implementation
description: Why iptables and /etc/hosts failed, and how the current direct FQDN interception works.
---

# SIP FQDN Proxy: approach history

## Key fact about the binary
The sip-agent binary DOES use the `SIP_SERVER` / `server` config field for packet routing (not just
Via/Contact construction). The earlier code comment claiming "server is NOT used for routing" was wrong —
Timer_B timeouts confirmed the binary sends packets to whatever SIP_SERVER is set to.

## Failed approach 1: iptables OUTPUT DNAT
iptables rule accumulated 0 packet hits regardless of configuration. Not reliable on this VPS.

## Failed approach 2: /etc/hosts DNS interception
Assigned unique loopback IPs (`127.1.0.N`) and rewrote /etc/hosts to point the Yeastar FQDN there.
Failed because the service account lacks write access to /etc/hosts (EACCES).
Critical bug: the code caught the EACCES error but still set `SIP_SERVER=127.1.0.N:5060` — the binary
then sent REGISTER to a loopback address with no proxy listener → Timer_B timeout.

## Current approach: direct FQDN interception (no root needed)
Since the binary uses SIP_SERVER for routing, no DNS trick is needed at all:

1. Resolve Yeastar FQDN → real IP (DNS, once at start).
2. Bind `localSock` on `127.0.0.1:<proxyLocalPort>` (sipLocalPort + 10000). No privileges needed.
3. Bind `extSock` on `0.0.0.0:<proxyExtPort>` (sipLocalPort + 20000).
4. Set `SIP_SERVER=127.0.0.1:<proxyLocalPort>` in binary env and config.json.
5. Binary sends all SIP to localSock → proxy relays to Yeastar via extSock.
6. `startSipProxy()` returns the proxy address string so callers use it directly.

**Why:** Avoids /etc/hosts, iptables, special loopback IPs, and root privileges entirely.

**Critical invariant:** `effectiveSipServer` must be determined (proxy address OR real FQDN fallback)
BEFORE calling `buildConfig`/`buildEnv`. If proxy fails to start, fall back to `realSipServer` — never
leave SIP_SERVER pointing at a loopback address where no proxy is listening.

**How to apply:** `startExtension` starts the proxy first, captures the returned address or falls back,
then passes `effectiveSipServer` to both `buildConfig` and `buildEnv`.
