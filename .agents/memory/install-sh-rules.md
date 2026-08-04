---
name: install.sh robustness rules
description: Key invariants the VPS installer must maintain to survive re-runs and non-standard server setups (Docker, occupied ports, no-home users).
---

## Rules

**DB_PASS must not regenerate on re-runs.**
Read the existing `DATABASE_URL` from `.env` (if present) and extract `DB_PASS` from it. Only generate a new password on a truly fresh install. Regenerating every run causes a password mismatch between PostgreSQL and the URL passed to drizzle-kit.

**Why:** Each `install.sh` run that fails mid-way leaves PostgreSQL with password N. The next run generates password N+1, updates PostgreSQL, but if the ALTER USER fails silently the URL has N+1 while PG still has N.

**PostgreSQL port must be detected, not hardcoded.**
Before starting system PostgreSQL, stop it, then check with `ss -tlnp` if port 5432 is still in use. If yes, pick the first free port in 5433–5438, patch `postgresql.conf` with `sed`, then start. Store the chosen port in `DATABASE_URL` and reuse it on re-runs by extracting it from `.env`.

**Why:** Servers running Docker containers frequently have PostgreSQL containers on 5432. Hardcoding 5432 breaks the connectivity probe and drizzle-kit.

**Run drizzle-kit directly, not via pnpm recursive runner.**
Call `lib/db/node_modules/.bin/drizzle-kit push --force --config ./drizzle.config.ts` from `lib/db/` directly as root (with `HOME=/tmp`). Using `pnpm --filter @workspace/db run push-force` swallows drizzle-kit's stderr output, making failures silent.

**How to apply:** Migration step in install.sh and update.sh.

**Add a psql connectivity probe before drizzle-kit.**
Run `PGPASSWORD=... psql -h 127.0.0.1 -p ${PG_PORT} -U ... -c "SELECT 1;"` before invoking drizzle-kit. This gives a clear human-readable error if the URL or port is wrong, instead of a silent spinner hang.

**System user has no home directory.**
`aio-voice-connect` is created with `--no-create-home`. Any tool that writes to `$HOME` (drizzle-kit, npm caches) must be given `HOME=/tmp` when run as that user, or run as root instead.
