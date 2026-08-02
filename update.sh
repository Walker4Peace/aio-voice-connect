#!/usr/bin/env bash
# AIO Voice Connect — VPS update script
# Usage: sudo bash /opt/aio-voice-connect/update.sh
#
# What it does:
#   1. Pulls latest code from GitHub (hard-reset — build artifacts are ignored)
#   2. Installs / updates pnpm dependencies
#   3. Rebuilds frontend and API server
#   4. Applies any new DB migrations (schema push)
#   5. Restarts the systemd service (default: aio-voice-connect)
#
# Requirements on the VPS:
#   - pnpm installed globally  (npm install -g pnpm)
#   - DATABASE_URL set in /opt/aio-voice-connect/.env
#   - The git remote "origin" points to the GitHub repo
#   - A systemd service named "aio-voice-connect" (or set SERVICE_NAME=...)

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

# ── 5. Refresh nginx helper (if installed) ────────────────────────────────────
# The helper script runs as root via a systemd path unit.  Re-copy it after
# every deploy so the latest version is always in use.
HELPER_SRC="$DEPLOY_DIR/scripts/nginx-helper.sh"
HELPER_DEST="$DEPLOY_DIR/nginx-helper.sh"

if [[ -f "$HELPER_SRC" ]]; then
  echo ""
  echo "▶ Refreshing nginx helper"
  cp "$HELPER_SRC" "$HELPER_DEST"
  chmod 700 "$HELPER_DEST"
  chown root:root "$HELPER_DEST" 2>/dev/null || true   # no-op if already root-owned

  # Always re-write the systemd units so path/binary changes take effect
  cat > /etc/systemd/system/aio-nginx-setup.path <<EOF
[Unit]
Description=Watch for AIO Voice Connect nginx config request
After=aio-voice-connect-api.service

[Path]
PathExists=/tmp/aio-vc-nginx-pending.conf
Unit=aio-nginx-setup.service

[Install]
WantedBy=multi-user.target
EOF
  cat > /etc/systemd/system/aio-nginx-setup.service <<EOF
[Unit]
Description=AIO Voice Connect nginx setup helper (runs as root)

[Service]
Type=oneshot
ExecStart=${HELPER_DEST}
Environment=INSTALL_DIR=${DEPLOY_DIR}
User=root
StandardOutput=journal
StandardError=journal
SyslogIdentifier=aio-nginx-setup
EOF
  systemctl daemon-reload
  systemctl enable aio-nginx-setup.path --quiet
  systemctl restart aio-nginx-setup.path 2>/dev/null || systemctl start aio-nginx-setup.path
  echo "  ✓ nginx helper updated and path unit restarted"
fi

# ── 6. Migrate services (old single-service → new split architecture) ─────────
# If the old monolithic aio-voice-connect.service exists but the new split
# services do not, create them now so a fresh install.sh is not required.
API_PORT=3100
UI_PORT=8080
NODE_BIN="$(command -v node)"
PNPM_BIN="$(command -v pnpm)"

NEEDS_MIGRATION=false
# Use list-unit-files (shows ALL installed units, not just loaded/active ones)
if systemctl list-unit-files --no-pager 2>/dev/null | grep -q "^aio-voice-connect\.service" \
   && ! systemctl list-unit-files --no-pager 2>/dev/null | grep -q "^aio-voice-connect-api\.service"; then
  NEEDS_MIGRATION=true
fi

if [[ "$NEEDS_MIGRATION" == true ]]; then
  echo ""
  echo "▶ Migrating from single-service to split-service architecture"

  # Load .env to get APP_USER (set in install.sh; default to aio-voice-connect)
  APP_USER="$(systemctl show aio-voice-connect --property=User 2>/dev/null | cut -d= -f2)"
  [[ -z "$APP_USER" ]] && APP_USER="aio-voice-connect"

  # Create API service
  cat > /etc/systemd/system/aio-voice-connect-api.service <<EOF
[Unit]
Description=AIO Voice Connect API Server
Documentation=https://github.com/Walker4Peace/ai-agent
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${DEPLOY_DIR}
EnvironmentFile=${DEPLOY_DIR}/.env

ExecStart=${NODE_BIN} --enable-source-maps ${DEPLOY_DIR}/artifacts/api-server/dist/index.mjs

Restart=on-failure
RestartSec=5
StartLimitInterval=60
StartLimitBurst=5

StandardOutput=journal
StandardError=journal
SyslogIdentifier=aio-voice-connect-api

AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

  # Create UI service (plain Node.js static server — no vite at runtime)
  STATIC_SERVER="${DEPLOY_DIR}/artifacts/aio-voice-connect-manager/serve-static.mjs"
  cat > /etc/systemd/system/aio-voice-connect-ui.service <<EOF
[Unit]
Description=AIO Voice Connect Frontend (static file server)
Documentation=https://github.com/Walker4Peace/ai-agent
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${DEPLOY_DIR}
Environment=NODE_ENV=production
Environment=PORT=${UI_PORT}
Environment=HOST=0.0.0.0

ExecStart=${NODE_BIN} ${STATIC_SERVER}

Restart=on-failure
RestartSec=5
StartLimitInterval=60
StartLimitBurst=5

StandardOutput=journal
StandardError=journal
SyslogIdentifier=aio-voice-connect-ui

[Install]
WantedBy=multi-user.target
EOF

  # Remove stale installer-created nginx sites (no .conf extension).
  # The app-managed aio-voice-connect.conf (with .conf) is left untouched.
  for STALE in \
      /etc/nginx/sites-enabled/aio-voice-connect \
      /etc/nginx/sites-available/aio-voice-connect; do
    if [[ -e "$STALE" || -L "$STALE" ]]; then
      rm -f "$STALE"
      echo "  ✓ Removed stale nginx site: ${STALE}"
    fi
  done
  nginx -t &>/dev/null && systemctl reload nginx 2>/dev/null || true

  # Stop and disable old service
  systemctl stop aio-voice-connect 2>/dev/null || true
  systemctl disable aio-voice-connect 2>/dev/null || true
  echo "  ✓ Old aio-voice-connect service stopped and disabled"

  # Enable new services
  systemctl daemon-reload
  systemctl enable aio-voice-connect-api --quiet
  systemctl enable aio-voice-connect-ui --quiet
  echo "  ✓ New split services created and enabled"
fi

# ── 7. Restart services ───────────────────────────────────────────────────────
echo ""
echo "▶ Restarting services"

for SVC in aio-voice-connect-api aio-voice-connect-ui; do
  if systemctl is-active --quiet "$SVC"; then
    systemctl restart "$SVC"
    echo "  ✓ $SVC restarted"
  elif systemctl list-unit-files --no-pager 2>/dev/null | grep -q "^${SVC}\.service"; then
    systemctl start "$SVC"
    echo "  ✓ $SVC started"
  else
    echo "  ✗ $SVC not found — run: sudo bash ${DEPLOY_DIR}/migrate.sh"
  fi
done

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "✅  Update complete — $(date '+%Y-%m-%d %H:%M:%S')"
echo "    API (direct):      http://localhost:3100/api/healthz"
echo "    Frontend (direct): http://localhost:8080/"
echo "    Dashboard (nginx): http://localhost/"
echo "    API logs:          journalctl -u aio-voice-connect-api -f"
echo "    UI logs:           journalctl -u aio-voice-connect-ui -f"
