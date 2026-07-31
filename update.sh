#!/usr/bin/env bash
# =============================================================================
# AIO Voice Connect — Update Script
# Run this on your VPS after pushing changes to GitHub.
#
# Usage:
#   sudo bash /opt/aio-voice-connect/update.sh
#   — or from anywhere —
#   curl -fsSL https://raw.githubusercontent.com/Walker4Peace/ai-agent/main/update.sh | sudo bash
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[✓]${NC}    $*"; }
die()     { echo -e "\n${RED}[ERROR]${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}▶ $*${NC}"; }

[[ "${EUID}" -ne 0 ]] && die "Run as root: sudo bash update.sh"

APP_USER="aio-voice-connect"
INSTALL_DIR="/opt/aio-voice-connect"
SERVICE="aio-voice-connect"

[[ -d "${INSTALL_DIR}/.git" ]] || die "${INSTALL_DIR} is not a git repository. Run install.sh first."

# ── Step 1: Pull latest code ──────────────────────────────────────────────────
step "Pulling latest changes from GitHub"

sudo -u "${APP_USER}" git -C "${INSTALL_DIR}" pull --ff-only \
  || die "git pull failed. Resolve any conflicts in ${INSTALL_DIR} first."
success "Repository updated"

# ── Step 2: Install dependencies (fast if nothing changed) ───────────────────
step "Installing dependencies"

sudo -u "${APP_USER}" bash -c "
  set -e
  cd '${INSTALL_DIR}'
  pnpm install --frozen-lockfile 2>&1
" || die "pnpm install failed."
success "Dependencies up to date"

# ── Step 3: Apply database schema changes ────────────────────────────────────
step "Applying database schema"

sudo -u "${APP_USER}" bash -c "
  set -e
  cd '${INSTALL_DIR}/lib/db'
  pnpm run push 2>&1
" || die "Database schema push failed. Check DATABASE_URL is set correctly."
success "Database schema up to date"

# ── Step 4: Build ─────────────────────────────────────────────────────────────
step "Building API server"

sudo -u "${APP_USER}" bash -c "
  set -e
  cd '${INSTALL_DIR}'
  NODE_ENV=production pnpm --filter @workspace/api-server run build 2>&1
" || die "API server build failed."
success "API server built"

step "Building dashboard frontend"

sudo -u "${APP_USER}" bash -c "
  set -e
  cd '${INSTALL_DIR}'
  BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/aio-voice-connect-manager run build 2>&1
" || die "Frontend build failed."
success "Frontend built"

# ── Step 4: Restart service ───────────────────────────────────────────────────
step "Restarting service"

systemctl restart "${SERVICE}" || die "Failed to restart ${SERVICE}. Check: journalctl -u ${SERVICE} -n 50"
sleep 2

if systemctl is-active --quiet "${SERVICE}"; then
  success "Service is running"
else
  die "Service failed to start. Check: journalctl -u ${SERVICE} -n 50"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✓ Update complete — AIO Voice Connect is running the latest version.${NC}"
echo ""
echo "Useful commands:"
echo "  journalctl -u ${SERVICE} -f        # stream live logs"
echo "  systemctl status ${SERVICE}        # service status"
echo ""
