#!/usr/bin/env bash
# =============================================================================
# SIP Agent — Self-Hosted Installer
# Installs the full SIP Agent platform on a fresh Ubuntu 22.04/24.04 server.
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
# TODO: Replace with the actual GitHub repository URL before hosting this script.
REPO_URL="${SIP_AGENT_REPO_URL:-https://github.com/Walker4Peace/ai-agent.git}"

APP_USER="sip-agent"
INSTALL_DIR="/opt/sip-agent"
NODE_MAJOR="20"          # Match the Node.js version used in development
API_PORT=3101            # Internal port for the Node.js API server
DASHBOARD_PORT=3100      # Public-facing port served by nginx

DB_NAME="sip_agent"
DB_USER="sip_agent"
# Generate a random 24-character alphanumeric password
DB_PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24 2>/dev/null || openssl rand -hex 16)"
SESSION_SECRET="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48 2>/dev/null || openssl rand -hex 32)"

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

# 6. Required ports must be free
for PORT_CHECK in "${API_PORT}" "${DASHBOARD_PORT}"; do
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
    die "REPO_URL has not been set.\n\n  Edit install.sh and replace the REPO_URL value with your actual GitHub repository URL,\n  or set the environment variable before running:\n\n    SIP_AGENT_REPO_URL=https://github.com/your-org/sip-agent.git sudo bash install.sh"
fi

echo ""
echo -e "${BOLD}SIP Agent Installer${NC}"
echo -e "Server IP  : ${SERVER_IP}"
echo -e "Install dir: ${INSTALL_DIR}"
echo -e "Dashboard  : http://${SERVER_IP}:${DASHBOARD_PORT}"
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
    || die "Failed to install base system packages."

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
    info "Repository already present — pulling latest changes..."
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

systemctl enable postgresql --quiet
systemctl start postgresql

# Create role if it doesn't exist
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" >/dev/null \
        || die "Failed to create PostgreSQL user '${DB_USER}'."
    success "Database user '${DB_USER}' created"
else
    # Update the password on re-runs so the .env stays consistent
    sudo -u postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" >/dev/null
    success "Database user '${DB_USER}' already exists (password updated)"
fi

# Create database if it doesn't exist
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" >/dev/null \
        || die "Failed to create PostgreSQL database '${DB_NAME}'."
    success "Database '${DB_NAME}' created"
else
    success "Database '${DB_NAME}' already exists"
fi

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"

# ── Step 6: Generate .env file ────────────────────────────────────────────────
step "Generating .env configuration"

cat > "${INSTALL_DIR}/.env" <<EOF
# SIP Agent configuration — generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Do not edit this file manually unless you know what you are doing.

NODE_ENV=production
PORT=${API_PORT}
DATABASE_URL=${DATABASE_URL}
SESSION_SECRET=${SESSION_SECRET}
SIP_AGENT_BIN=${SIP_AGENT_BIN}
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
# The root build script runs: pnpm run typecheck && pnpm -r --if-present run build
# This builds all workspace packages in the correct dependency order and
# prevents enabling a broken service by running typecheck first.
step "Type-checking and building all packages (this may take a few minutes)"

sudo -u "${APP_USER}" bash -c "
    set -e
    cd '${INSTALL_DIR}'
    # BASE_PATH=/ because nginx serves the SPA from the root of port 3100.
    # NODE_ENV=production suppresses dev-only Vite plugins.
    BASE_PATH=/ NODE_ENV=production pnpm run build 2>&1
" || die "Build failed (typecheck or compilation error). Fix the errors above before re-running the installer."
success "All packages type-checked and built"

# ── Step 10: Database migrations ─────────────────────────────────────────────
step "Running database migrations"

sudo -u "${APP_USER}" bash -c "
    set -e
    cd '${INSTALL_DIR}'
    DATABASE_URL='${DATABASE_URL}' pnpm --filter @workspace/db run push-force 2>&1
" || die "Database migration (drizzle push) failed."
success "Database schema applied"

# ── Step 11: systemd service ──────────────────────────────────────────────────
step "Creating systemd service"

NODE_BIN="$(command -v node)"

cat > /etc/systemd/system/sip-agent.service <<EOF
[Unit]
Description=SIP Agent API Server
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
SyslogIdentifier=sip-agent

# Allow the sip-agent child processes to bind privileged SIP ports
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sip-agent --quiet
systemctl restart sip-agent || die "Failed to start sip-agent service. Check: journalctl -u sip-agent -n 50"
success "sip-agent systemd service enabled and started"

# ── Step 12: nginx reverse proxy ──────────────────────────────────────────────
step "Configuring nginx"

STATIC_ROOT="${INSTALL_DIR}/artifacts/sip-agent-manager/dist/public"

cat > /etc/nginx/sites-available/sip-agent <<EOF
# sip-agent — generated by install.sh
server {
    listen ${DASHBOARD_PORT};
    server_name _;

    # ── API requests → Node.js ────────────────────────────────────────────
    location /api/ {
        proxy_pass         http://127.0.0.1:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    # ── React SPA — serve static files; fall back to index.html ──────────
    root  ${STATIC_ROOT};
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;

        # Cache static assets aggressively; bust on deploy (hashed filenames)
        location ~* \\.(?:js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp)\$ {
            expires     1y;
            add_header  Cache-Control "public, immutable";
            access_log  off;
        }
    }

    # Security headers
    add_header X-Frame-Options        "SAMEORIGIN"   always;
    add_header X-Content-Type-Options "nosniff"      always;
    add_header Referrer-Policy        "strict-origin" always;

    # Increase body size limit for config uploads
    client_max_body_size 16M;
}
EOF

# Enable the site and disable the nginx default
ln -sf /etc/nginx/sites-available/sip-agent /etc/nginx/sites-enabled/sip-agent
rm -f /etc/nginx/sites-enabled/default

nginx -t || die "nginx configuration test failed. Check /etc/nginx/sites-available/sip-agent"
systemctl enable nginx --quiet
systemctl restart nginx || die "Failed to start nginx. Check: journalctl -u nginx -n 30"
success "nginx configured and restarted"

# ── Step 13: Health verification ──────────────────────────────────────────────
step "Verifying installation"

# Give the Node.js process a moment to fully start
sleep 4

ALL_OK=true

# 1. API server health check
API_HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${API_PORT}/api/healthz" 2>/dev/null || echo "000")"
if [[ "${API_HTTP_CODE}" == "200" ]]; then
    success "API server is healthy (/api/healthz → HTTP 200)"
else
    warn "API server returned HTTP ${API_HTTP_CODE}. Check: journalctl -u sip-agent -n 50"
    ALL_OK=false
fi

# 2. Dashboard via nginx
DASH_HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${DASHBOARD_PORT}/" 2>/dev/null || echo "000")"
if [[ "${DASH_HTTP_CODE}" == "200" ]]; then
    success "Dashboard is reachable via nginx (HTTP ${DASH_HTTP_CODE})"
else
    warn "Dashboard returned HTTP ${DASH_HTTP_CODE}. Check: systemctl status nginx"
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
echo -e "${GREEN}${BOLD}║  Dashboard: http://${SERVER_IP}:${DASHBOARD_PORT}                              ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"

if [[ "${ALL_OK}" == false ]]; then
    echo ""
    echo -e "${YELLOW}One or more health checks did not pass. Useful diagnostic commands:${NC}"
    echo "  journalctl -u sip-agent -n 80 --no-pager   # API server logs"
    echo "  journalctl -u nginx  -n 30 --no-pager   # nginx logs"
    echo "  systemctl status sip-agent                 # service status"
fi

echo ""
echo "Useful commands:"
echo "  journalctl -u sip-agent -f      # stream API server logs"
echo "  systemctl restart sip-agent     # restart the API server"
echo "  systemctl status sip-agent      # service health"
echo "  cat ${INSTALL_DIR}/.env      # view configuration (root only)"
echo ""
