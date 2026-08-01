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
After=aio-voice-connect.service

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

# ── 6. Restart API server ─────────────────────────────────────────────────────
SERVICE_NAME="${SERVICE_NAME:-aio-voice-connect}"
echo ""
echo "▶ Restarting service ($SERVICE_NAME)"
if systemctl is-active --quiet "$SERVICE_NAME"; then
  systemctl restart "$SERVICE_NAME"
  echo "  ✓ Service restarted"
elif systemctl list-units --full --all | grep -q "${SERVICE_NAME}.service"; then
  systemctl start "$SERVICE_NAME"
  echo "  ✓ Service started"
else
  echo "  ✗ Service '$SERVICE_NAME' not found in systemd. Start it manually."
  echo "    sudo systemctl start $SERVICE_NAME"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "✅  Update complete — $(date '+%Y-%m-%d %H:%M:%S')"
echo "    API:      http://localhost:8080/api/healthz"
echo "    Logs:     journalctl -u $SERVICE_NAME -f"
