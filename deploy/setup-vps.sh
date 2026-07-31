#!/usr/bin/env bash
# AIO Voice Connect — VPS first-time setup script
# Run as a non-root user with sudo rights.
# Usage: bash deploy/setup-vps.sh
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/aio-voice-connect}"
NODE_VERSION="20"

echo "==> 1/6  Checking Node.js >= $NODE_VERSION ..."
if ! command -v node &>/dev/null || [[ $(node -e "process.exit(parseInt(process.versions.node)<$NODE_VERSION?1:0)" && echo ok || echo fail) == "fail" ]]; then
  echo "     Node $NODE_VERSION+ not found. Install via nvm or nodesource and re-run."
  exit 1
fi
echo "     $(node --version) ✓"

echo "==> 2/6  Checking pnpm ..."
if ! command -v pnpm &>/dev/null; then
  echo "     pnpm not found. Installing ..."
  npm install -g pnpm
fi
echo "     $(pnpm --version) ✓"

echo "==> 3/6  Installing workspace dependencies ..."
pnpm install --frozen-lockfile

echo "==> 4/6  Building frontend and API server ..."
pnpm run build

echo "==> 5/6  Applying database schema ..."
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "     ⚠  DATABASE_URL is not set — skipping schema push."
  echo "        Set DATABASE_URL and run: cd lib/db && pnpm run push"
else
  cd lib/db && pnpm run push && cd -
  echo "     Schema applied ✓"
fi

echo "==> 6/6  Creating log directory ..."
mkdir -p logs

echo ""
echo "✅  Setup complete."
echo ""
echo "Next steps:"
echo "  1. Copy .env.example → .env and fill in DATABASE_URL, SESSION_SECRET, OUTBOUND_API_KEY"
echo "  2. Source your .env:   export \$(grep -v '^#' .env | xargs)"
echo "  3. Start with PM2:     pm2 start deploy/ecosystem.config.cjs --env production"
echo "  4. Configure nginx:    see deploy/nginx.conf.example"
echo "  5. Get SSL:            sudo certbot --nginx -d your-domain.com"
