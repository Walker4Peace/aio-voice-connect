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
step "Creating aio-voice-connect-ui.service (Vite preview on port ${UI_PORT})"

cat > /etc/systemd/system/aio-voice-connect-ui.service <<EOF
[Unit]
Description=AIO Voice Connect Frontend (Vite preview)
Documentation=https://github.com/Walker4Peace/ai-agent
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${DEPLOY_DIR}
# Explicit env — do NOT inherit PORT from .env (that's the API port)
Environment=NODE_ENV=production
Environment=PORT=${UI_PORT}
Environment=BASE_PATH=/

ExecStart=${PNPM_BIN} --filter @workspace/aio-voice-connect-manager run serve

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
success "aio-voice-connect-ui.service written"

# ── Step 6: Update nginx to pure reverse proxy ────────────────────────────────
step "Updating nginx config (proxy-only, port 80)"

# Remove any old nginx config that served static files or listened on port 3100
for OLD_PORT_CONF in /etc/nginx/sites-enabled/default; do
  rm -f "$OLD_PORT_CONF"
done

cat > /etc/nginx/sites-available/aio-voice-connect <<'NGINXEOF'
# aio-voice-connect — generated by migrate.sh
# nginx is a pure reverse proxy; it never serves static files directly.
#
#   API (Express)           → http://127.0.0.1:3100
#   Frontend (Vite preview) → http://127.0.0.1:8080
#
# Both services are also reachable directly without nginx:
#   http://SERVER_IP:3100   — API
#   http://SERVER_IP:8080   — Frontend
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # API → Express on port 3100
    location /api/ {
        proxy_pass         http://127.0.0.1:3100/api/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    # Frontend → Vite preview on port 8080
    location / {
        proxy_pass         http://127.0.0.1:8080/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    add_header X-Frame-Options        "SAMEORIGIN"   always;
    add_header X-Content-Type-Options "nosniff"      always;
    add_header Referrer-Policy        "strict-origin" always;
    client_max_body_size 16M;
}
NGINXEOF

ln -sf /etc/nginx/sites-available/aio-voice-connect /etc/nginx/sites-enabled/aio-voice-connect

if nginx -t 2>&1; then
  systemctl reload nginx && success "nginx updated and reloaded (port 80, proxy-only)"
else
  die "nginx config test failed — check /etc/nginx/sites-available/aio-voice-connect"
fi

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
ss -tlnp | grep -E ":(${API_PORT}|${UI_PORT}|80) " || echo "  (none matched — see full list below)"
ss -tlnp

echo ""
API_CODE="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${API_PORT}/api/healthz" 2>/dev/null || echo "000")"
UI_CODE="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${UI_PORT}/" 2>/dev/null || echo "000")"
NGINX_CODE="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:80/" 2>/dev/null || echo "000")"

[[ "$API_CODE"   == "200" ]] && success "API   direct (port ${API_PORT}): HTTP ${API_CODE}" \
  || warn "API   direct (port ${API_PORT}): HTTP ${API_CODE}  ← check journalctl -u aio-voice-connect-api"
[[ "$UI_CODE"    == "200" ]] && success "UI    direct (port ${UI_PORT}):  HTTP ${UI_CODE}" \
  || warn "UI    direct (port ${UI_PORT}):  HTTP ${UI_CODE}   ← check journalctl -u aio-voice-connect-ui"
[[ "$NGINX_CODE" == "200" ]] && success "nginx via   (port 80):    HTTP ${NGINX_CODE}" \
  || warn "nginx via   (port 80):    HTTP ${NGINX_CODE}  ← check journalctl -u nginx"

# ── Done ──────────────────────────────────────────────────────────────────────
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║           Migration complete                                  ║${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║  Dashboard  (nginx): http://${SERVER_IP}                       ║${NC}"
echo -e "${GREEN}${BOLD}║  Frontend   (direct):http://${SERVER_IP}:${UI_PORT}              ║${NC}"
echo -e "${GREEN}${BOLD}║  API        (direct):http://${SERVER_IP}:${API_PORT}             ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Useful commands:"
echo "  journalctl -u aio-voice-connect-api -f   # API logs"
echo "  journalctl -u aio-voice-connect-ui  -f   # Frontend logs"
echo "  systemctl restart aio-voice-connect-api  # restart API"
echo "  systemctl restart aio-voice-connect-ui   # restart frontend"
echo ""
