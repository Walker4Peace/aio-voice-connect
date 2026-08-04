---
name: SIP FQDN Proxy — DNS interception approach
description: Why iptables DNAT failed and how the /etc/hosts DNS interception approach works for the SIP proxy.
---

# SIP FQDN Proxy: DNS interception via /etc/hosts

## The problem
The sip-agent binary uses sipgo's RFC 3263 transport routing — it resolves the Request-URI host
(e.g. `aioprocess-demo.ras.yeastar.com`) via DNS and sends packets to that real IP.
The `server` config field does NOT control which IP packets go to; it only affects Via/Contact construction.

## Failed approach: iptables OUTPUT DNAT
We tried an iptables OUTPUT chain DNAT rule to redirect UDP to the Yeastar IP to a local proxy socket.
Despite `route_localnet=1` being set, the iptables rule accumulated **0 packet hits** across multiple attempts.
The exact cause is unclear (Docker iptables chains, kernel/VPS interaction), but the result is definitive —
iptables DNAT in the OUTPUT chain is not reliable on this server.

## Working approach: /etc/hosts DNS interception
For extension N:
1. Resolve real Yeastar IP (for extSock forwarding).
2. Assign loopback IP: `127.1.0.N` (safe — full 127.0.0.0/8 is loopback on Linux).
3. Add `/etc/hosts`: `127.1.0.N  <yeastar-fqdn>  # sip-proxy:<fqdn>`
4. Bind `localSock` to `127.1.0.N:5060` (real Yeastar port).
5. Binary resolves FQDN → `127.1.0.N` via /etc/hosts, sends REGISTER directly to proxy.
6. `extSock` bound to `0.0.0.0:proxyExtPort` forwards to real Yeastar IP:port.
7. On stop: remove /etc/hosts entry, close sockets.

Also set binary's `server` config field to `127.1.0.N:5060` explicitly so sipgo has both paths covered.

**Why:**  Requires no iptables, no kernel routing tricks. Works regardless of how sipgo routes.

**How to apply:** Whenever FQDN proxy needs to intercept SIP from a binary on the same host, prefer DNS interception over iptables DNAT.
