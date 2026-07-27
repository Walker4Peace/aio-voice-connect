# SIP Agent Manager

A SIP (Session Initiation Protocol) agent management platform with a React dashboard and Express REST API.

## Project Structure

This is a pnpm monorepo with the following packages:

| Package | Path | Description |
|---|---|---|
| `@workspace/sip-agent-manager` | `artifacts/sip-agent-manager/` | React + Vite frontend dashboard |
| `@workspace/api-server` | `artifacts/api-server/` | Express 5 REST API backend |
| `@workspace/db` | `lib/db/` | Drizzle ORM schema + database client |
| `@workspace/api-zod` | `lib/api-zod/` | Shared Zod validation schemas |
| `@workspace/api-spec` | `lib/api-spec/` | API type definitions |
| `@workspace/api-client-react` | `lib/api-client-react/` | React Query API client hooks |

## How to Run

Both services start automatically via the configured workflows:

- **Frontend** — Vite dev server on `PORT=23208`, preview path `/`
- **API Server** — Express on `PORT=8080`, mounted at `/api`

To start manually:
```bash
pnpm --filter @workspace/sip-agent-manager run dev   # frontend
pnpm --filter @workspace/api-server run dev           # backend
```

## Required Secrets

| Secret | Description |
|---|---|
| `SESSION_SECRET` | Express session signing key |
| `DATABASE_URL` | PostgreSQL connection string (auto-provisioned by Replit) |

## Database

Uses Drizzle ORM with PostgreSQL. To apply schema changes:
```bash
cd lib/db && pnpm run push
```

## Tech Stack

- **Frontend**: React 19, Vite 7, Tailwind CSS 4, shadcn/ui, TanStack Query, Wouter, Framer Motion
- **Backend**: Express 5, Pino logger, express-session, bcryptjs, CORS
- **Database**: PostgreSQL via Drizzle ORM
- **Language**: TypeScript throughout

## User Preferences

<!-- Agent: add user preferences here when asked to remember something -->
