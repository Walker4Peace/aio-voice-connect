#!/usr/bin/env bash
# =============================================================================
# AIO Voice Connect — Architecture Migration Script
# Migrates from the old single-service setup to the new split-service setup:
#
#   OLD:  aio-voice-connect.service  (API on 3101, nginx serves static on 3100)
#   NEW:  aio-voice-connect-api.service  (API on 3100)
#         aio-voice-connect-ui.service   (Vite preview on 8080)
#         nginx on port 80, pure reverse proxy to both
#
# Usage: sudo bash /opt/aio-voice-connect/migrate.sh
# Safe to run multiple times — all steps are idempotent.
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[✓]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
step()    { echo -e "\n${BOLD}${BLUE}▶ $*${NC}"; }
die()     { echo -e "\n${RED}[ERROR]${NC} $*" >&2; exit 1; }

[[ "${EUID}" -ne 0 ]] && die "This script must be run as root.\n\n  Try: sudo bash migrate.sh"

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${DEPLOY_DIR}/.env"
API_PORT=3100
UI_PORT=8080
NODE_BIN="$(command -v node)"
PNPM_BIN="$(command -v pnpm)"

echo ""
echo -e "${BOLD}AIO Voice Connect — Architecture Migration${NC}"
echo -e "Deploy dir: ${DEPLOY_DIR}"
echo -e "API port:   ${API_PORT}  (was 3101)"
echo -e "UI port:    ${UI_PORT}"
echo ""

# ── Step 1: Patch .env ────────────────────────────────────────────────────────
step "Patching .env (PORT 3101 → 3100)"

if [[ ! -f "$ENV_FILE" ]]; then
  die ".env not found at ${ENV_FILE}. Is this the right directory?"
fi

# Change PORT= line (whatever value) to 3100
if grep -q '^PORT=' "$ENV_FILE"; then
  sed -i "s|^PORT=.*|PORT=${API_PORT}|" "$ENV_FILE"
  success "PORT set to ${API_PORT} in .env"
else
  echo "PORT=${API_PORT}" >> "$ENV_FILE"
  success "PORT=${API_PORT} added to .env"
fi

# Add UI_PORT if not present
if ! grep -q '^UI_PORT=' "$ENV_FILE"; then
  echo "UI_PORT=${UI_PORT}" >> "$ENV_FILE"
  success "UI_PORT=${UI_PORT} added to .env"
else
  sed -i "s|^UI_PORT=.*|UI_PORT=${UI_PORT}|" "$ENV_FILE"
  success "UI_PORT set to ${UI_PORT} in .env"
fi

# ── Step 2: Stop and disable the old service ─────────────────────────────────
step "Stopping old aio-voice-connect service"

if systemctl list-unit-files --no-pager 2>/dev/null | grep -q "^aio-voice-connect.service"; then
  systemctl stop    aio-voice-connect 2>/dev/null && success "Old service stopped"   || warn "Old service was not running"
  systemctl disable aio-voice-connect 2>/dev/null && success "Old service disabled"  || warn "Old service was not enabled"
else
  info "aio-voice-connect.service not found — skipping"
fi

# ── Step 3: Detect APP_USER ───────────────────────────────────────────────────
step "Detecting service user"

APP_USER="$(systemctl show aio-voice-connect --property=User 2>/dev/null | cut -d= -f2 || true)"
[[ -z "$APP_USER" ]] && APP_USER="aio-voice-connect"

# Verify the user exists; fall back to current sudo user
if ! id "$APP_USER" &>/dev/null; then
  APP_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"
  warn "Could not find user from old service — using '${APP_USER}'"
fi
success "Service user: ${APP_USER}"

# ── Step 4: Create aio-voice-connect-api.service ──────────────────────────────
step "Creating aio-voice-connect-api.service (API on port ${API_PORT})"

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
success "aio-voice-connect-api.service written"

# ── Step 5: Create aio-voice-connect-ui.service ───────────────────────────────
step "Creating aio-voice-connect-ui.service (static server on port ${UI_PORT})"

STATIC_SERVER="${DEPLOY_DIR}/artifacts/aio-voice-connect-manager/serve-static.mjs"

if [[ ! -f "$STATIC_SERVER" ]]; then
  die "Static server script not found at ${STATIC_SERVER}.\n  Make sure you have pulled the latest code: sudo bash ${DEPLOY_DIR}/update.sh"
fi

cat > /etc/systemd/system/aio-voice-connect-ui.service <<EOF
[Unit]
Description=AIO Voice Connect Frontend (static file server)
Documentation=https://github.com/Walker4Peace/ai-agent
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${DEPLOY_DIR}
# Explicit env — does NOT inherit from .env (PORT there is for the API)
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
success "aio-voice-connect-ui.service written (uses node serve-static.mjs — no vite at runtime)"

# ── Step 6: Clean up stale installer-created nginx sites ─────────────────────
# Previous versions of install.sh and migrate.sh created an nginx virtual host.
# Remove every variant now so the app-generated aio-voice-connect.conf (written
# by Settings → Domain) is the only one and there are no duplicate default_server
# conflicts.
step "Cleaning up stale installer nginx sites"

REMOVED_ANY=false
for STALE in \
    /etc/nginx/sites-enabled/aio-voice-connect \
    /etc/nginx/sites-available/aio-voice-connect; do
  if [[ -e "$STALE" || -L "$STALE" ]]; then
    rm -f "$STALE"
    success "Removed ${STALE}"
    REMOVED_ANY=true
  fi
done

if [[ "$REMOVED_ANY" == true ]]; then
  nginx -t && systemctl reload nginx && success "nginx reloaded (stale sites removed)"
else
  info "No stale installer sites found — nothing to remove"
fi

# Note: /etc/nginx/sites-available/aio-voice-connect.conf (with .conf extension)
# is written by the application domain-setup flow and must NOT be removed here.

# ── Step 7: Reload systemd and enable new services ────────────────────────────
step "Reloading systemd and enabling new services"

systemctl daemon-reload
systemctl enable aio-voice-connect-api --quiet && success "aio-voice-connect-api enabled"
systemctl enable aio-voice-connect-ui  --quiet && success "aio-voice-connect-ui enabled"

# ── Step 8: Start new services ────────────────────────────────────────────────
step "Starting aio-voice-connect-api"
systemctl restart aio-voice-connect-api || die "Failed to start API service.\n  Check: journalctl -u aio-voice-connect-api -n 50 --no-pager"
success "aio-voice-connect-api started"

step "Starting aio-voice-connect-ui"
systemctl restart aio-voice-connect-ui || die "Failed to start UI service.\n  Check: journalctl -u aio-voice-connect-ui -n 50 --no-pager"
success "aio-voice-connect-ui started"

# ── Step 9: Verify ────────────────────────────────────────────────────────────
step "Verifying — waiting 5 s for processes to bind ports"
sleep 5

echo ""
echo "Service status:"
systemctl is-active aio-voice-connect-api && echo -e "  ${GREEN}[✓]${NC} aio-voice-connect-api — active" \
  || echo -e "  ${RED}[✗]${NC} aio-voice-connect-api — NOT active"
systemctl is-active aio-voice-connect-ui  && echo -e "  ${GREEN}[✓]${NC} aio-voice-connect-ui  — active" \
  || echo -e "  ${RED}[✗]${NC} aio-voice-connect-ui  — NOT active"

echo ""
echo "Listening ports:"
ss -tlnp | grep -E ":(${API_PORT}|${UI_PORT}) " || echo "  (none matched — see full list below)"
ss -tlnp

echo ""
API_CODE="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${API_PORT}/api/healthz" 2>/dev/null || echo "000")"
UI_CODE="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${UI_PORT}/" 2>/dev/null || echo "000")"

[[ "$API_CODE" == "200" ]] && success "API   direct (port ${API_PORT}): HTTP ${API_CODE}" \
  || warn "API   direct (port ${API_PORT}): HTTP ${API_CODE}  ← check journalctl -u aio-voice-connect-api"
[[ "$UI_CODE"  == "200" ]] && success "UI    direct (port ${UI_PORT}):  HTTP ${UI_CODE}" \
  || warn "UI    direct (port ${UI_PORT}):  HTTP ${UI_CODE}   ← check journalctl -u aio-voice-connect-ui"

# ── Done ──────────────────────────────────────────────────────────────────────
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║           Migration complete                                  ║${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║  Dashboard  (direct): http://${SERVER_IP}:${UI_PORT}              ║${NC}"
echo -e "${GREEN}${BOLD}║  API        (direct): http://${SERVER_IP}:${API_PORT}             ║${NC}"
echo -e "${GREEN}${BOLD}║                                                              ║${NC}"
echo -e "${GREEN}${BOLD}║  nginx is running. Connect a domain in Settings → Domain     ║${NC}"
echo -e "${GREEN}${BOLD}║  to enable port 80/443 access.                               ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Useful commands:"
echo "  journalctl -u aio-voice-connect-api -f   # API logs"
echo "  journalctl -u aio-voice-connect-ui  -f   # Frontend logs"
echo "  systemctl restart aio-voice-connect-api  # restart API"
echo "  systemctl restart aio-voice-connect-ui   # restart frontend"
echo ""
