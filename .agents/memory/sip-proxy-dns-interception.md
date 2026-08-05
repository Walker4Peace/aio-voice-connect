---
name: SIP FQDN Proxy — approach history and current implementation
description: Why iptables and /etc/hosts failed, and how the current SIP_OUTBOUND_PROXY approach works.
---

# SIP FQDN Proxy: approach history

## Key fact about the binary
The sip-agent binary (`sip4ai`) supports `SIP_OUTBOUND_PROXY` as a documented env var.
This is the correct SIP mechanism — SIP_SERVER stays as the real registrar FQDN (correct headers),
while all packets physically route through the proxy.

## Failed approach 1: iptables OUTPUT DNAT
iptables rule accumulated 0 packet hits regardless of configuration. Not reliable on this VPS.

## Failed approach 2: /etc/hosts DNS interception
Rewrote /etc/hosts to point the Yeastar FQDN at a unique loopback IP (127.1.0.N).
Failed because the service account lacks write access to /etc/hosts (EACCES).
Critical bug from this phase: code caught EACCES but still set SIP_SERVER=127.1.0.N:5060 →
binary sent REGISTER to a dead loopback → Timer_B timeout.

## Failed approach 3: rewrite SIP_SERVER to proxy address
Set SIP_SERVER=127.0.0.1:<proxyPort>. This caused Timer_B too — the binary resolves the
SIP domain (aioprocess-demo.ras.yeastar.com) via RFC 3263 DNS for packet routing, ignoring
the changed SIP_SERVER for actual UDP destination in some code paths.

## Current approach: SIP_OUTBOUND_PROXY (correct SIP standard)
The binary natively supports outbound proxy via `SIP_OUTBOUND_PROXY` env var (confirmed from
`--help` output and binary strings: `Outbound Proxy: %s`).

Configuration when proxy is active:
```
SIP_DOMAIN=aioprocess-demo.ras.yeastar.com   (unchanged — correct SIP headers)
SIP_SERVER=aioprocess-demo.ras.yeastar.com:5060  (unchanged — real registrar)
SIP_OUTBOUND_PROXY=127.0.0.1:17060           (proxy address — all packets route here first)
```

Proxy (`sip-proxy.ts`) binds `localSock` on `127.0.0.1:<sipLocalPort+10000>`, no root needed.

**Why:** Standard SIP outbound proxy mechanism. No DNS tricks, no iptables, no /etc/hosts.
SIP headers stay correct for Yeastar; proxy handles NAT/rport rewriting.

**How to apply:**
- `buildEnv` adds `SIP_OUTBOUND_PROXY` only when `proxyAddress` is non-null (proxy started successfully)
- `SIP_SERVER` is never changed from the real FQDN/IP value stored in the IPBX record
- `buildConfig` (config.json `sip.server`) also stays as the real FQDN — binary reads SIP_OUTBOUND_PROXY from env only
- If proxy fails to start, binary connects directly (no dead loopback risk)
