#!/usr/bin/env bash
# =============================================================================
# AIO Voice Connect — Self-Hosted Installer
# Installs the full AIO Voice Connect platform on a fresh Ubuntu 22.04/24.04 server.
#
# Usage:
#   curl -fsSL https://your-domain/install.sh | sudo bash
#   — or —
#   sudo bash install.sh
#
# What this does:
#   1. Pre-flight checks (OS, arch, RAM, disk, network, ports, PostgreSQL)
#   2. Installs system dependencies (Node.js, pnpm, PostgreSQL, nginx)
#   3. Creates a dedicated system user
#   4. Clones the repository
#   5. Verifies the sip-agent binary
#   6. Configures PostgreSQL (user + database)
#   7. Generates the .env configuration file
#   8. Installs Node.js dependencies
#   9. Type-checks and builds all packages (frontend + backend)
#  10. Runs database migrations
#  11. Creates and starts a systemd service
#  12. Configures nginx as a reverse proxy on port 3100
#  13. Verifies that every component is healthy
#
# After installation:
#   Dashboard: http://<SERVER-IP>:3100
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
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
die()     { echo -e "\n${RED}[ERROR]${NC} $*" >&2; echo -e "${RED}Installation failed. See output above for details.${NC}" >&2; exit 1; }

# ── Configuration ─────────────────────────────────────────────────────────────
REPO_URL="${AIO_VOICE_CONNECT_REPO_URL:-https://github.com/Walker4Peace/ai-agent.git}"

APP_USER="aio-voice-connect"
INSTALL_DIR="/opt/aio-voice-connect"
NODE_MAJOR="20"          # Match the Node.js version used in development
API_PORT=3100            # Port for the Express API server (direct: http://SERVER_IP:3100)
UI_PORT=8080             # Port for the Vite frontend preview (direct: http://SERVER_IP:8080)
# nginx listens on ports 80/443 and proxies to the above two processes

DB_NAME="aio_voice_connect"
DB_USER="aio_voice_connect"

# Reuse existing DB_PASS / SESSION_SECRET from .env on re-runs so we never
# mismatch what PostgreSQL has stored with what we pass to drizzle-kit.
_EXISTING_ENV="${INSTALL_DIR}/.env"
if [[ -f "$_EXISTING_ENV" ]]; then
    _EXISTING_URL="$(grep -m1 '^DATABASE_URL=' "$_EXISTING_ENV" | cut -d= -f2-)"
    _EXISTING_SECRET="$(grep -m1 '^SESSION_SECRET=' "$_EXISTING_ENV" | cut -d= -f2-)"
fi

if [[ -n "${_EXISTING_URL:-}" ]]; then
    # Extract password and port from postgresql://user:PASS@host:PORT/db
    DB_PASS="$(printf '%s' "$_EXISTING_URL" | sed 's|.*://[^:]*:\([^@]*\)@.*|\1|')"
    DB_PORT_EXISTING="$(printf '%s' "$_EXISTING_URL" | sed 's|.*@[^:]*:\([0-9]*\)/.*|\1|')"
    [[ -z "$DB_PASS" ]] && DB_PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24 2>/dev/null || openssl rand -hex 16)"
else
    DB_PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24 2>/dev/null || openssl rand -hex 16)"
fi

if [[ -n "${_EXISTING_SECRET:-}" ]]; then
    SESSION_SECRET="$_EXISTING_SECRET"
else
    SESSION_SECRET="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48 2>/dev/null || openssl rand -hex 32)"
fi

# ── Pre-flight checks ─────────────────────────────────────────────────────────
[[ "${EUID}" -ne 0 ]] && die "This script must be run as root.\n\n  Try: sudo bash install.sh\n  or:  curl -fsSL https://your-domain/install.sh | sudo bash"

# 1. OS — Ubuntu 22.04 or newer
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    if [[ "${ID}" != "ubuntu" ]]; then
        die "Unsupported OS: ${PRETTY_NAME:-${ID}}. This installer requires Ubuntu 22.04 or newer."
    fi
    OS_VER_MAJOR="${VERSION_ID%%.*}"
    OS_VER_MINOR="${VERSION_ID##*.}"
    if [[ "${OS_VER_MAJOR}" -lt 22 ]] || { [[ "${OS_VER_MAJOR}" -eq 22 ]] && [[ "${OS_VER_MINOR}" -lt 4 ]]; }; then
        die "Ubuntu ${VERSION_ID} is not supported. Please use Ubuntu 22.04 or newer."
    fi
else
    die "/etc/os-release not found. Cannot determine OS. This installer requires Ubuntu 22.04 or newer."
fi

# 2. CPU architecture — x86_64 or aarch64 only
ARCH="$(uname -m)"
if [[ "${ARCH}" != "x86_64" && "${ARCH}" != "aarch64" ]]; then
    die "Unsupported CPU architecture: ${ARCH}. This installer supports x86_64 and aarch64 only."
fi

# 3. Minimum RAM — 1 GB hard minimum, warn below 2 GB
TOTAL_RAM_KB="$(grep -i MemTotal /proc/meminfo | awk '{print $2}')"
TOTAL_RAM_MB=$(( TOTAL_RAM_KB / 1024 ))
if [[ "${TOTAL_RAM_MB}" -lt 1024 ]]; then
    die "Insufficient RAM: ${TOTAL_RAM_MB} MB detected. At least 1 GB is required (2 GB recommended)."
fi
if [[ "${TOTAL_RAM_MB}" -lt 2048 ]]; then
    warn "Low RAM: ${TOTAL_RAM_MB} MB detected. 2 GB or more is recommended for stable operation."
fi

# 4. Free disk space — 3 GB minimum on the install partition
INSTALL_PARENT="$(dirname "${INSTALL_DIR}")"
mkdir -p "${INSTALL_PARENT}"
FREE_KB="$(df -k "${INSTALL_PARENT}" | tail -1 | awk '{print $4}')"
FREE_MB=$(( FREE_KB / 1024 ))
if [[ "${FREE_MB}" -lt 3072 ]]; then
    die "Insufficient disk space: ${FREE_MB} MB free on $(df -k "${INSTALL_PARENT}" | tail -1 | awk '{print $6}'). At least 3 GB is required."
fi

# 5. Internet connectivity
if ! curl -fsSL --max-time 10 https://registry.npmjs.org/ >/dev/null 2>&1; then
    die "No internet access or npm registry unreachable. Please check your network connection."
fi

# 6. Required ports must be free (3100 = API, 8080 = frontend static server)
for PORT_CHECK in "${API_PORT}" "${UI_PORT}"; do
    if ss -tlnp 2>/dev/null | grep -q ":${PORT_CHECK} " || \
       netstat -tlnp 2>/dev/null | grep -q ":${PORT_CHECK} "; then
        die "Port ${PORT_CHECK} is already in use. Free the port or change the configuration at the top of this script."
    fi
done

# 7. PostgreSQL — available via apt or already installed
if ! command -v psql &>/dev/null; then
    if ! apt-cache show postgresql >/dev/null 2>&1; then
        die "PostgreSQL is not installed and cannot be found in the apt package cache. Check your apt sources."
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────

# Detect the server's primary IP address for the final message
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -z "${SERVER_IP}" ]] && SERVER_IP="<your-server-ip>"

# Validate repo URL placeholder was replaced
if [[ "${REPO_URL}" == *"YOUR_ORG"* ]]; then
    die "REPO_URL has not been set.\n\n  Edit install.sh and replace the REPO_URL value with your actual GitHub repository URL,\n  or set the environment variable before running:\n\n    AIO_VOICE_CONNECT_REPO_URL=https://github.com/your-org/sip-agent.git sudo bash install.sh"
fi

echo ""
echo -e "${BOLD}AIO Voice Connect Installer${NC}"
echo -e "Server IP  : ${SERVER_IP}"
echo -e "Install dir: ${INSTALL_DIR}"
echo -e "Frontend   : http://${SERVER_IP}:${UI_PORT}  (direct)"
echo -e "API        : http://${SERVER_IP}:${API_PORT}  (direct)"
echo -e "Dashboard  : http://${SERVER_IP}  (via nginx on port 80)"
echo -e "OS         : ${PRETTY_NAME}"
echo -e "Arch       : ${ARCH}"
echo -e "RAM        : ${TOTAL_RAM_MB} MB"
echo -e "Free disk  : ${FREE_MB} MB"
echo ""

# ── Step 1: System dependencies ───────────────────────────────────────────────
step "Installing system dependencies"

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq || die "apt-get update failed. Check your internet connection."
apt-get install -y -qq \
    git \
    curl \
    ca-certificates \
    gnupg \
    lsb-release \
    build-essential \
    nginx \
    postgresql \
    postgresql-contrib \
    openssl \
    certbot \
    python3-certbot-nginx \
    || die "Failed to install base system packages."

success "certbot $(certbot --version 2>&1 | head -1)"

# Node.js via NodeSource
if ! command -v node &>/dev/null || [[ "$(node --version | cut -d. -f1 | tr -d 'v')" -lt "${NODE_MAJOR}" ]]; then
    info "Installing Node.js ${NODE_MAJOR} LTS..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1 \
        || die "Failed to configure NodeSource repository."
    apt-get install -y -qq nodejs || die "Failed to install Node.js."
fi
success "Node.js $(node --version)"

# pnpm (via npm so we get the correct version)
if ! command -v pnpm &>/dev/null; then
    info "Installing pnpm..."
    npm install -g pnpm --loglevel=error || die "Failed to install pnpm."
fi
success "pnpm $(pnpm --version)"

# ── Step 2: Create dedicated system user ─────────────────────────────────────
step "Creating system user"

if ! id "${APP_USER}" &>/dev/null; then
    # --no-create-home: we let git clone create the directory cleanly below,
    # avoiding the "non-empty directory" error caused by skeleton files.
    useradd \
        --system \
        --shell /bin/bash \
        --no-create-home \
        --home-dir "${INSTALL_DIR}" \
        "${APP_USER}" \
        || die "Failed to create system user '${APP_USER}'."
    success "User '${APP_USER}' created"
else
    success "User '${APP_USER}' already exists"
fi

# ── Step 3: Clone the repository ──────────────────────────────────────────────
step "Cloning repository"

if [[ -d "${INSTALL_DIR}/.git" ]]; then
    info "Repository already present — fixing ownership and pulling..."
    # The directory may have been cloned by root (e.g. via manual `git clone`).
    # Git refuses to operate on a repo owned by a different user, so we must
    # correct ownership before switching to APP_USER for the pull.
    chown -R "${APP_USER}:${APP_USER}" "${INSTALL_DIR}" 2>/dev/null || true
    sudo -u "${APP_USER}" git -C "${INSTALL_DIR}" pull --ff-only \
        || die "git pull failed. Resolve conflicts in ${INSTALL_DIR} before re-running."
    success "Repository updated"
else
    # If the directory exists but is not a git repo (e.g. left over from a
    # previous failed run or created by useradd), remove it so git clone
    # can create it cleanly.
    if [[ -d "${INSTALL_DIR}" ]]; then
        info "Removing existing non-git directory ${INSTALL_DIR}..."
        rm -rf "${INSTALL_DIR}"
    fi
    info "Cloning ${REPO_URL} → ${INSTALL_DIR} ..."
    git clone --depth=1 "${REPO_URL}" "${INSTALL_DIR}" \
        || die "git clone failed. Check that the repository URL is correct and accessible."
    chown -R "${APP_USER}:${APP_USER}" "${INSTALL_DIR}"
    success "Repository cloned"
fi

# ── Step 4: sip-agent binary ─────────────────────────────────────────────────────
step "Setting up sip-agent binary"

SIP_AGENT_BIN="${INSTALL_DIR}/.bin/sip-agent"
BIND_SO="${INSTALL_DIR}/.bin/bind_override.so"

[[ -f "${SIP_AGENT_BIN}" ]] || die "Binary not found at ${SIP_AGENT_BIN}. Make sure the .bin/ directory is committed to the repository."

chmod +x "${SIP_AGENT_BIN}"

# bind_override.so lets the binary rebind SIP ports; copy it to a system path
if [[ -f "${BIND_SO}" ]]; then
    cp "${BIND_SO}" /usr/local/lib/bind_override.so
    success "bind_override.so installed to /usr/local/lib/"
fi

success "sip-agent binary ready at ${SIP_AGENT_BIN}"

# ── Step 5: PostgreSQL database ───────────────────────────────────────────────
step "Configuring PostgreSQL"

# ── Determine which port system PostgreSQL should use ────────────────────────
# Port 5432 may already be occupied by Docker or another service.  We detect
# this by stopping our system PG temporarily and checking with ss; if 5432 is
# still in use we pick the first free port in 5433-5438 and patch
# postgresql.conf before starting.

PG_CONF="$(find /etc/postgresql -name postgresql.conf 2>/dev/null | sort -V | tail -1)"
[[ -z "$PG_CONF" ]] && die "Cannot find postgresql.conf — is postgresql installed?"

# Helper: pick the first TCP port not currently LISTEN-ing
_pick_free_port() {
    local _p
    for _p in 5433 5434 5435 5436 5437 5438; do
        ss -tlnp 2>/dev/null | awk '{print $4}' | grep -q ":${_p}$" || { echo "${_p}"; return 0; }
    done
    return 1
}

# Default port; may be overridden below
PG_PORT=5432

if [[ -n "${DB_PORT_EXISTING:-}" && "${DB_PORT_EXISTING}" != "5432" ]]; then
    # Re-run: restore the previously chosen non-default port so the stored
    # DATABASE_URL remains valid without needing to update docker containers.
    PG_PORT="${DB_PORT_EXISTING}"
    info "Re-using previously configured PostgreSQL port ${PG_PORT}"
    sed -i "s/^#*[[:space:]]*port[[:space:]]*=.*/port = ${PG_PORT}/" "$PG_CONF"
else
    # Temporarily stop system PG so its own socket releases 5432.
    systemctl stop postgresql 2>/dev/null || true
    sleep 1
    # Now check if 5432 is still occupied (by Docker or another service).
    if ss -tlnp 2>/dev/null | awk '{print $4}' | grep -q ':5432$'; then
        PG_PORT="$(_pick_free_port)" \
            || die "Port 5432 is occupied and no free alternative port found in 5433-5438. Free a port and re-run."
        info "Port 5432 is occupied by another service — configuring system PostgreSQL to use port ${PG_PORT}"
        sed -i "s/^#*[[:space:]]*port[[:space:]]*=.*/port = ${PG_PORT}/" "$PG_CONF"
    fi
fi

systemctl enable postgresql --quiet
systemctl start postgresql || die "Failed to start PostgreSQL service. Check: journalctl -u postgresql -n 50"

# Shortcut so every psql call targets the right port automatically
_psql() { sudo -u postgres psql -p "${PG_PORT}" "$@"; }

# Create role if it doesn't exist
if ! _psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
    _psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" >/dev/null \
        || die "Failed to create PostgreSQL user '${DB_USER}'."
    success "Database user '${DB_USER}' created"
else
    _psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" >/dev/null
    success "Database user '${DB_USER}' already exists (password updated)"
fi

# Create database if it doesn't exist
if ! _psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    _psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" >/dev/null \
        || die "Failed to create PostgreSQL database '${DB_NAME}'."
    success "Database '${DB_NAME}' created"
else
    success "Database '${DB_NAME}' already exists"
fi

_psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:${PG_PORT}/${DB_NAME}"

# ── Step 6: Generate .env file ────────────────────────────────────────────────
step "Generating .env configuration"

cat > "${INSTALL_DIR}/.env" <<EOF
# AIO Voice Connect configuration — generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Do not edit this file manually unless you know what you are doing.

NODE_ENV=production
PORT=${API_PORT}
UI_PORT=${UI_PORT}
DATABASE_URL=${DATABASE_URL}
SESSION_SECRET=${SESSION_SECRET}
SIP_AGENT_BIN=${SIP_AGENT_BIN}

# ── ElevenLabs Post-Call Webhook (optional) ───────────────────────────────────
# Set this to the signing secret shown in ElevenLabs → Agents → Settings →
# Post-Call Webhooks.  When set, every incoming webhook is HMAC-verified.
# Leave empty to skip verification (useful for initial testing only).
# ELEVENLABS_WEBHOOK_SECRET=whsec_your_secret_here
EOF

chown "${APP_USER}:${APP_USER}" "${INSTALL_DIR}/.env"
chmod 600 "${INSTALL_DIR}/.env"
success ".env written to ${INSTALL_DIR}/.env"

# ── Step 7: Install project dependencies ──────────────────────────────────────
step "Installing project dependencies (this may take a few minutes)"

sudo -u "${APP_USER}" bash -c "
    set -e
    cd '${INSTALL_DIR}'
    if [[ -f pnpm-lock.yaml ]]; then
        echo '[INFO]  Lock file found — using --frozen-lockfile'
        pnpm install --frozen-lockfile 2>&1
    else
        echo '[WARN]  No lock file found — falling back to pnpm install'
        pnpm install 2>&1
    fi
" || die "pnpm install failed. Check the output above for details."
success "Node.js dependencies installed"

# ── Step 8: Type-check and build (frontend + backend) ─────────────────────────
# Type-check uses the root script (covers all workspace packages).
# Build targets only the two production artifacts — Replit-specific dev tools
# such as mockup-sandbox are intentionally excluded.
step "Type-checking and building all packages (this may take a few minutes)"

sudo -u "${APP_USER}" bash -c "
    set -e
    cd '${INSTALL_DIR}'
    echo '[INFO]  Running type-check (shared libs)...'
    pnpm run typecheck:libs 2>&1
    echo '[INFO]  Running type-check (artifacts)...'
    pnpm -r --reporter=append-only --filter './artifacts/**' --filter './scripts' --if-present run typecheck 2>&1
" || die "Type-check failed. Fix the TypeScript errors above before re-running the installer."
success "Type-check passed"

step "Building production artifacts"

sudo -u "${APP_USER}" bash -c "
    set -e
    cd '${INSTALL_DIR}'
    # NODE_ENV=production suppresses dev-only Vite plugins (cartographer, dev-banner).
    # BASE_PATH=/ — the frontend is served from the root path via nginx or directly.
    echo '[INFO]  Building API server...'
    NODE_ENV=production pnpm --filter @workspace/api-server run build 2>&1
    echo '[INFO]  Building dashboard frontend...'
    BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/aio-voice-connect-manager run build 2>&1
" || die "Build failed. Fix the errors above before re-running the installer."
success "API server and dashboard built successfully"

# ── Step 9: Database migrations ──────────────────────────────────────────────
step "Running database migrations"

# Verify the DB is reachable before running drizzle-kit
PGPASSWORD="${DB_PASS}" psql \
    -h 127.0.0.1 -p "${PG_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    -c "SELECT 1;" >/dev/null 2>&1 \
    || die "Cannot connect to PostgreSQL as '${DB_USER}' on port ${PG_PORT} — check pg_hba.conf and that the .env password matches the database user."

bash -c "
    set -e
    cd '${INSTALL_DIR}/lib/db'
    HOME=/tmp \
    DATABASE_URL='${DATABASE_URL}' \
    '${INSTALL_DIR}/lib/db/node_modules/.bin/drizzle-kit' push --force --config ./drizzle.config.ts
" 2>&1 || die "Database migration (drizzle push) failed."
success "Database schema applied"

# ── Step 10: systemd services ────────────────────────────────────────────────
step "Creating systemd services"

NODE_BIN="$(command -v node)"
PNPM_BIN="$(command -v pnpm)"

# ── API service (Express, port 3100) ─────────────────────────────────────────
cat > /etc/systemd/system/aio-voice-connect-api.service <<EOF
[Unit]
Description=AIO Voice Connect API Server
Documentation=https://github.com/Walker4Peace/ai-agent
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env

ExecStart=${NODE_BIN} --enable-source-maps ${INSTALL_DIR}/artifacts/api-server/dist/index.mjs

Restart=on-failure
RestartSec=5
StartLimitInterval=60
StartLimitBurst=5

StandardOutput=journal
StandardError=journal
SyslogIdentifier=aio-voice-connect-api

# CAP_NET_BIND_SERVICE — sip-agent binary binds privileged SIP ports
# CAP_NET_ADMIN        — SIP FQDN proxy adds/removes iptables DNAT rules
AmbientCapabilities=CAP_NET_BIND_SERVICE CAP_NET_ADMIN
CapabilityBoundingSet=CAP_NET_BIND_SERVICE CAP_NET_ADMIN

[Install]
WantedBy=multi-user.target
EOF

# ── Frontend service (static file server, port 8080) ─────────────────────────
# Uses a plain Node.js static server — no vite, no node_modules write access.
STATIC_SERVER="${INSTALL_DIR}/artifacts/aio-voice-connect-manager/serve-static.mjs"

cat > /etc/systemd/system/aio-voice-connect-ui.service <<EOF
[Unit]
Description=AIO Voice Connect Frontend (static file server)
Documentation=https://github.com/Walker4Peace/ai-agent
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${INSTALL_DIR}
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

systemctl daemon-reload
systemctl enable aio-voice-connect-api --quiet
systemctl enable aio-voice-connect-ui --quiet
systemctl restart aio-voice-connect-api || die "Failed to start API service. Check: journalctl -u aio-voice-connect-api -n 50"
systemctl restart aio-voice-connect-ui  || die "Failed to start UI service. Check: journalctl -u aio-voice-connect-ui -n 50"
success "aio-voice-connect-api service enabled and started (port ${API_PORT})"
success "aio-voice-connect-ui  service enabled and started (port ${UI_PORT})"

# ── Step 10b: privileged nginx helper (systemd path unit) ────────────────────
#
# The main service runs with CapabilityBoundingSet=CAP_NET_BIND_SERVICE, which
# blocks sudo and setuid entirely.  Instead we install a small helper script
# owned by root and a pair of systemd units:
#
#   aio-nginx-setup.path    — watches for nginx-pending.conf
#   aio-nginx-setup.service — runs nginx-helper.sh as root when triggered
#
# The Node.js API writes the trigger file; systemd runs the helper as root;
# the helper writes back a JSON result that the API reads.  No sudo needed.
step "Installing privileged nginx setup helper"

HELPER_SRC="${INSTALL_DIR}/scripts/nginx-helper.sh"
HELPER_DEST="${INSTALL_DIR}/nginx-helper.sh"

if [[ ! -f "$HELPER_SRC" ]]; then
    die "Helper script not found at ${HELPER_SRC} — ensure the repo is fully cloned"
fi

cp "$HELPER_SRC" "$HELPER_DEST"
chmod 700 "$HELPER_DEST"
chown root:root "$HELPER_DEST"

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
Environment=INSTALL_DIR=${INSTALL_DIR}
User=root
StandardOutput=journal
StandardError=journal
SyslogIdentifier=aio-nginx-setup
EOF

systemctl daemon-reload
systemctl enable aio-nginx-setup.path --quiet
systemctl start aio-nginx-setup.path
success "nginx helper installed — path unit is active (${HELPER_DEST})"

# ── Step 11: nginx (install + start only — NO virtual host) ──────────────────
# nginx is installed and started here as a blank proxy infrastructure.
# Virtual host configuration is the application's responsibility, done
# exclusively from Settings → Domain when the user connects a domain.
# This keeps installer concerns separate from application configuration and
# prevents "duplicate default server" conflicts between install.sh and the
# app-generated /etc/nginx/sites-available/aio-voice-connect.conf.
step "Enabling nginx (no virtual host — configure domain in Settings)"

# Remove any stale aio-voice-connect site left over from earlier installers
rm -f /etc/nginx/sites-enabled/aio-voice-connect
rm -f /etc/nginx/sites-enabled/aio-voice-connect.conf
rm -f /etc/nginx/sites-available/aio-voice-connect
# Leave sites-available/aio-voice-connect.conf alone — it may have been written
# by the domain-setup flow and should survive a reinstall.

systemctl enable nginx --quiet
systemctl restart nginx || die "Failed to start nginx. Check: journalctl -u nginx -n 30"
success "nginx enabled and started (Debian default site only — no app virtual host)"

# ── Step 12: Health verification ─────────────────────────────────────────────
step "Verifying installation"

# Give the services a moment to fully start
sleep 5

ALL_OK=true

# 1. API server direct health check
API_HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${API_PORT}/api/healthz" 2>/dev/null || echo "000")"
if [[ "${API_HTTP_CODE}" == "200" ]]; then
    success "API server is healthy — direct port ${API_PORT} (/api/healthz → HTTP 200)"
else
    warn "API server returned HTTP ${API_HTTP_CODE} on port ${API_PORT}. Check: journalctl -u aio-voice-connect-api -n 50"
    ALL_OK=false
fi

# 2. Frontend direct check (static file server)
UI_HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${UI_PORT}/" 2>/dev/null || echo "000")"
if [[ "${UI_HTTP_CODE}" == "200" ]]; then
    success "Frontend is reachable — direct port ${UI_PORT} (HTTP ${UI_HTTP_CODE})"
else
    warn "Frontend returned HTTP ${UI_HTTP_CODE} on port ${UI_PORT}. Check: journalctl -u aio-voice-connect-ui -n 50"
    ALL_OK=false
fi

# 3. PostgreSQL
if sudo -u postgres psql -c '\q' &>/dev/null; then
    success "PostgreSQL is running"
else
    warn "PostgreSQL may not be running. Check: systemctl status postgresql"
    ALL_OK=false
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║           Installation completed successfully                 ║${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║  Dashboard  (direct): http://${SERVER_IP}:${UI_PORT}              ║${NC}"
echo -e "${GREEN}${BOLD}║  API        (direct): http://${SERVER_IP}:${API_PORT}             ║${NC}"
echo -e "${GREEN}${BOLD}║                                                              ║${NC}"
echo -e "${GREEN}${BOLD}║  nginx is installed and running (no virtual host yet).       ║${NC}"
echo -e "${GREEN}${BOLD}║  Connect a domain in Settings → Domain to enable port 80/443.║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"

if [[ "${ALL_OK}" == false ]]; then
    echo ""
    echo -e "${YELLOW}One or more health checks did not pass. Useful diagnostic commands:${NC}"
    echo "  journalctl -u aio-voice-connect-api -n 80 --no-pager   # API server logs"
    echo "  journalctl -u aio-voice-connect-ui  -n 80 --no-pager   # Frontend logs"
    echo "  systemctl status aio-voice-connect-api                 # API status"
    echo "  systemctl status aio-voice-connect-ui                  # Frontend status"
fi

echo ""
echo "Useful commands:"
echo "  journalctl -u aio-voice-connect-api -f      # stream API server logs"
echo "  journalctl -u aio-voice-connect-ui  -f      # stream frontend logs"
echo "  systemctl restart aio-voice-connect-api     # restart API server"
echo "  systemctl restart aio-voice-connect-ui      # restart frontend"
echo "  cat ${INSTALL_DIR}/.env                      # view configuration (root only)"
echo ""
