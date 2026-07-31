#!/usr/bin/env bash
# AIO Voice Connect — VPS update script
# Usage: sudo bash /opt/aio-voice-connect/update.sh
#
# What it does:
#   1. Pulls latest code from GitHub (hard-reset — build artifacts are ignored)
#   2. Installs / updates pnpm dependencies
#   3. Rebuilds frontend and API server
#   4. Applies any new DB migrations (schema push)
#   5. Restarts the API server via PM2
#
# Requirements on the VPS:
#   - pnpm installed globally  (npm install -g pnpm)
#   - PM2 installed globally   (npm install -g pm2)
#   - DATABASE_URL exported in the environment or in /etc/environment
#   - The git remote "origin" points to the GitHub repo

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH="${BRANCH:-main}"
PM2_APP_NAME="${PM2_APP_NAME:-api-server}"

# ── Git safe.directory ────────────────────────────────────────────────────────
# When run as root (sudo bash update.sh) the deploy dir may be owned by another
# user, causing git to refuse to operate ("dubious ownership").  Mark it safe.
git config --global --add safe.directory "$DEPLOY_DIR" 2>/dev/null || true

# ── Load .env if present ──────────────────────────────────────────────────────
ENV_FILE="$DEPLOY_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  # Export only non-comment, non-empty lines
  set -o allexport
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +o allexport
  echo "  ✓ Loaded $ENV_FILE"
fi

cd "$DEPLOY_DIR"

# ── 1. Pull latest source ─────────────────────────────────────────────────────
echo ""
echo "▶ Pulling latest changes from GitHub (branch: $BRANCH)"

git fetch origin "$BRANCH"

# Hard-reset tracked files to match remote (handles stale build artifacts that
# were previously committed to the repo but are now gitignored).
git reset --hard "origin/$BRANCH"

# Remove any untracked files/dirs that would have blocked the old `git pull`
# (e.g. lib/*/dist/, *.tsbuildinfo left over from a local build).
# -f = force, -d = include dirs, -x = also remove gitignored files
git clean -fdx \
  --exclude='.env' \
  --exclude='logs/' \
  --exclude='node_modules/'

echo "  ✓ Code is up to date with origin/$BRANCH"

# ── 2. Install dependencies ───────────────────────────────────────────────────
echo ""
echo "▶ Installing dependencies"
pnpm install --frozen-lockfile
echo "  ✓ Dependencies installed"

# ── 3. Build frontend + API server ───────────────────────────────────────────
echo ""
echo "▶ Building workspace"
pnpm run build
echo "  ✓ Build complete"

# ── 4. Apply database schema ──────────────────────────────────────────────────
echo ""
echo "▶ Applying database schema"
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "  ⚠  DATABASE_URL not set — skipping schema push."
  echo "     Set it in $ENV_FILE or export it before running this script."
else
  (cd "$DEPLOY_DIR/lib/db" && pnpm run push)
  echo "  ✓ Schema up to date"
fi

# ── 5. Restart API server ─────────────────────────────────────────────────────
echo ""
echo "▶ Restarting API server ($PM2_APP_NAME)"
if pm2 list | grep -q "$PM2_APP_NAME"; then
  pm2 restart "$PM2_APP_NAME"
else
  echo "  ℹ  PM2 process '$PM2_APP_NAME' not found — starting it now"
  pm2 start "$DEPLOY_DIR/deploy/ecosystem.config.cjs" --env production
  pm2 save
fi
echo "  ✓ API server restarted"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "✅  Update complete — $(date '+%Y-%m-%d %H:%M:%S')"
echo "    API:      http://localhost:8080/api/healthz"
echo "    PM2 log:  pm2 logs $PM2_APP_NAME --lines 50"
