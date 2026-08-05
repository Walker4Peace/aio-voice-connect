# AIO Voice Connect

A SIP AI agent management platform — React dashboard + Express REST API + PostgreSQL.

## Project overview

| Layer | Package | Description |
|---|---|---|
| Frontend | `@workspace/aio-voice-connect-manager` | React 19 + Vite 7 + Tailwind 4 + shadcn/ui |
| Backend | `@workspace/api-server` | Express 5 REST API (port 8080) |
| Database | `@workspace/db` | Drizzle ORM schema + PostgreSQL client |
| Shared libs | `api-zod`, `api-spec`, `api-client-react` | Zod schemas, types, React Query hooks |

## Local IP testing (VM-to-VM, Postman)

When testing between VMs (Yeastar PBX on one VM, AIO Voice Connect on another) **without a real domain or SSL**, you have two options:

### Option A — No nginx (Postman / API only)

The API server already listens on all interfaces. Just start it and hit it directly:

```bash
# On the AIO Voice Connect VM:
export DATABASE_URL=postgresql://user:pass@localhost:5432/aio_voice_connect
export SESSION_SECRET=any-secret-for-testing
export OUTBOUND_API_KEY=test-key        # or leave blank and use dashboard key
export NODE_ENV=production
export PORT=8080
node artifacts/api-server/dist/index.mjs
```

Then from Postman (or any machine on the same LAN):

```
POST  http://<aio-vm-ip>:8080/api/outbound/call
GET   http://<aio-vm-ip>:8080/api/healthz

Headers:
  X-Api-Key: test-key
  Content-Type: application/json

Body:
  { "extensionId": 1, "phoneNumber": "+212661209845", "firstMessage": "Hello!" }
```

> **Firewall**: open port 8080 — `sudo ufw allow 8080`

### Option B — nginx HTTP (dashboard + API through port 80)

Use `deploy/nginx-local.conf.example` — it serves the frontend and proxies `/api` over plain HTTP with no domain required (matches any IP):

```bash
# 1. Build everything
pnpm install --frozen-lockfile && pnpm run build
cd lib/db && pnpm run push && cd ..

# 2. Install the local nginx config
sudo cp deploy/nginx-local.conf.example /etc/nginx/sites-available/aio-voice-connect
# Edit the root path inside the file to match your deploy directory
sudo ln -s /etc/nginx/sites-available/aio-voice-connect /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 3. Start the API with PM2
pm2 start deploy/ecosystem.config.cjs --env production
```

Open `http://<aio-vm-ip>/` in your browser and `http://<aio-vm-ip>/api/healthz` to verify.

> **Firewall**: open port 80 — `sudo ufw allow 80` (port 8080 can stay closed)

### Switch to production

When you move from local IP testing to a real domain, swap the nginx config:

```bash
sudo rm /etc/nginx/sites-enabled/aio-voice-connect
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/aio-voice-connect
# Edit: replace your-domain.com and the root path
sudo ln -s /etc/nginx/sites-available/aio-voice-connect /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com
```

---

## VPS deployment (primary target)

### One-time setup

```bash
# 1. Clone and enter the repo
git clone <repo-url> /opt/aio-voice-connect
cd /opt/aio-voice-connect

# 2. Copy and fill in environment variables
cp .env.example .env
nano .env   # fill in DATABASE_URL, SESSION_SECRET, OUTBOUND_API_KEY

# 3. Run the automated setup (installs deps, builds, applies DB schema)
export $(grep -v '^#' .env | xargs)
bash deploy/setup-vps.sh

# 4. Start the API server with PM2
pm2 start deploy/ecosystem.config.cjs --env production
pm2 save && pm2 startup

# 5. Configure nginx + SSL
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/aio-voice-connect
# Edit the file: replace your-domain.com and the root path
sudo ln -s /etc/nginx/sites-available/aio-voice-connect /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com
```

### Re-deploy after code changes

```bash
cd /opt/aio-voice-connect
git pull
pnpm install --frozen-lockfile
pnpm run build
# If schema changed:
cd lib/db && pnpm run push && cd ..
pm2 restart api-server
```

### Required environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SESSION_SECRET` | ✅ | Express session signing key (long random string) |
| `OUTBOUND_API_KEY` | Optional | Static API key for `POST /api/outbound/call`. Leave blank to use dashboard-managed keys only. |
| `NODE_ENV` | Optional | Set to `production` in production |

### Outbound call API

```
POST /api/outbound/call
X-Api-Key: your-key
Content-Type: application/json

{
  "extensionId": 1,
  "phoneNumber": "+1234567890",
  "firstMessage": "Hello!"
}
```

API keys can be created from the dashboard (API page) or set via `OUTBOUND_API_KEY`.

### Healthcheck

```bash
curl https://your-domain.com/api/healthz   # → {"status":"ok"}
```

## Development on Replit

```bash
# Install deps
pnpm install

# Apply schema (requires DATABASE_URL)
cd lib/db && pnpm run push && cd ..

# Start API (terminal 1)
PORT=8080 pnpm --filter @workspace/api-server run dev

# Start frontend (terminal 2)
PORT=23208 BASE_PATH=/ pnpm --filter @workspace/aio-voice-connect-manager run dev
```

## Key files

- `artifacts/api-server/src/services/deployment.ts` — SIP process management + call event parsing
- `artifacts/api-server/src/routes/outbound.ts` — outbound call API + auth
- `artifacts/api-server/src/routes/deploy.ts` — call history API
- `artifacts/aio-voice-connect-manager/src/pages/calls/` — Call History page
- `lib/db/src/schema/` — database schema (Drizzle)
- `deploy/` — VPS deployment configs (nginx, PM2, setup script)

## User preferences

<!-- Agent: add user preferences here when asked to remember something -->
