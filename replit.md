# AIO Voice Connect

A SIP AI agent management platform — React dashboard + Express REST API + PostgreSQL.

## Stack

| Layer | Package | Description |
|---|---|---|
| Frontend | `@workspace/aio-voice-connect-manager` | React 19 + Vite 7 + Tailwind 4 + shadcn/ui — port 23208 |
| Backend | `@workspace/api-server` | Express 5 REST API — port 8080 |
| Database | `@workspace/db` | Drizzle ORM + Replit PostgreSQL |
| Shared libs | `api-zod`, `api-spec`, `api-client-react` | Zod schemas, types, React Query hooks |

## Running on Replit

Two workflows are configured and start automatically:

- **API Server** — `PORT=8080 pnpm --filter @workspace/api-server run dev`
- **Frontend** — `PORT=23208 BASE_PATH=/ pnpm --filter @workspace/aio-voice-connect-manager run dev`

The database schema is managed by Drizzle. To push schema changes:

```bash
cd lib/db && pnpm run push
```

## Required secrets

| Secret | Notes |
|---|---|
| `SESSION_SECRET` | Express session signing key — already set |
| `DATABASE_URL` | Provided automatically by Replit's built-in PostgreSQL |

`OUTBOUND_API_KEY` is optional — leave blank to manage API keys from the dashboard.

## Key files

- `artifacts/api-server/src/services/deployment.ts` — SIP process management + call event parsing
- `artifacts/api-server/src/routes/outbound.ts` — outbound call API + auth
- `artifacts/aio-voice-connect-manager/src/pages/calls/` — Call History page
- `lib/db/src/schema/` — database schema (Drizzle)
- `deploy/` — VPS deployment configs (nginx, PM2, setup script)

## User preferences

<!-- Agent: add user preferences here when asked to remember something -->
