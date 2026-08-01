---
name: nginx helper approach
description: How one-click domain setup works — privileged systemd path unit, not sudo
---

## Rule
The service runs with `CapabilityBoundingSet=CAP_NET_BIND_SERVICE`, which makes sudo/setuid impossible from the process. Domain/nginx automation uses a systemd path unit instead.

## How it works
- Node writes `nginx-pending.conf` + `nginx-pending-domain.txt` to `process.cwd()` (= `/opt/aio-voice-connect`)
- `aio-nginx-setup.path` (systemd) watches for `nginx-pending.conf`
- When detected, `aio-nginx-setup.service` runs `/opt/aio-voice-connect/nginx-helper.sh` as root
- Helper: copies config → creates symlink → nginx -t → reload → certbot → writes `nginx-setup-result.json`
- Node polls `nginx-setup-result.json` for up to 30 s; falls back to manual instructions on timeout

## Files
- `scripts/nginx-helper.sh` — source (tracked in git, copied by install.sh / update.sh)
- `nginx-helper.sh` — installed copy at `/opt/aio-voice-connect/nginx-helper.sh`, owned root:root chmod 700
- `/etc/systemd/system/aio-nginx-setup.path` + `aio-nginx-setup.service` — systemd units

## update.sh behaviour
`update.sh` (which runs as root) re-copies the helper script and installs the units if missing. No manual step required after the first deploy with this code.

**Why:** `NoNewPrivileges=true` was not explicitly set but `CapabilityBoundingSet=CAP_NET_BIND_SERVICE` has the same effect on sudo — it strips CAP_SETUID/SETGID. A separate root-owned systemd service is the clean solution.
