# SIP Agent Configuration Manager

A web dashboard for Yeastar solution providers to manage AI voice agent deployments. Onboard a new client, configure any AI provider, and generate ready-to-use `config.json` + systemd service files in under 2 minutes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, served at /api)
- `pnpm --filter @workspace/sip-agent-manager run dev` — run the frontend (served at /)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS + wouter + React Query
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (single source of truth for all API contracts)
- `lib/db/src/schema/` — Drizzle schema: clients, extensions, agentConfigs, relations
- `artifacts/api-server/src/routes/` — Express route handlers: clients, extensions, agentConfigs, stats, generate
- `artifacts/sip-agent-manager/src/` — React frontend

## Architecture decisions

- Extensions have an optional one-to-one relationship with an AgentConfig (one AI config per extension)
- Config generation (`/generate/:id/config` and `/generate/:id/service`) is read-only — it builds config.json and systemd service files on the fly from the stored credentials and AI config
- Deployments allocate and persist one local SIP port, HTTP port, process ID, and service name per extension; the Yeastar server remains on its configured SIP port
- API keys are stored in plaintext in the DB (consider encrypting at rest for production)
- Drizzle relations are declared in `lib/db/src/schema/relations.ts` — required for `db.query.*` with `with:` clauses

## Product

- **Clients** — manage Yeastar PBX installations (company name, server IP)
- **Extensions** — SIP extension credentials per client (extension number, auth_id, password, domain, server)
- **Agent Configs** — AI provider config per extension (OpenAI, ElevenLabs, Gemini, Deepgram, Cartesia)
- **Config Generator** — download ready-to-use `config.json` and systemd `.service` files for any extension

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After changing `lib/db/src/schema/`, run `pnpm --filter @workspace/db run push` then `pnpm run typecheck:libs` before checking the API server typecheck
- Drizzle `db.query.*` with `with:` requires relations defined in `schema/relations.ts` and exported from schema index
- The `generate.ts` route casts the Drizzle query result to `ExtensionWithRelations` to access `agentConfig` — keep that type in sync with the schema

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
