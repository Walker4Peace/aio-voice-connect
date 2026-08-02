#!/usr/bin/env bash
# AIO Voice Connect — privileged nginx setup helper
#
# Triggered by the systemd path unit aio-nginx-setup.path whenever the
# Node.js API server writes /opt/aio-voice-connect/nginx-pending.conf.
# Runs as root so it can write to /etc/nginx/ and call certbot.
#
# Result is written back as JSON to /opt/aio-voice-connect/nginx-setup-result.json
# and then trigger files are cleaned up so the path unit can fire again next time.

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/aio-voice-connect}"
PENDING_CONF="/tmp/aio-vc-nginx-pending.conf"
PENDING_DOMAIN="/tmp/aio-vc-nginx-pending-domain.txt"
RESULT_FILE="/tmp/aio-vc-nginx-result.json"

CONF_PATH="/etc/nginx/sites-available/aio-voice-connect.conf"
LINK_PATH="/etc/nginx/sites-enabled/aio-voice-connect.conf"

cleanup_triggers() {
  rm -f "$PENDING_CONF" "$PENDING_DOMAIN"
}

write_result() {
  echo "$1" > "$RESULT_FILE"
  cleanup_triggers
}

# Guard: pending config must exist
if [[ ! -f "$PENDING_CONF" ]]; then
  write_result '{"ok":false,"step":"guard","error":"nginx-pending.conf not found"}'
  exit 1
fi

# Read domain (optional — certbot is skipped if empty)
DOMAIN=""
[[ -f "$PENDING_DOMAIN" ]] && DOMAIN=$(cat "$PENDING_DOMAIN" | tr -d '[:space:]')

# ── Step 1: copy nginx config ─────────────────────────────────────────────────
if ! cp "$PENDING_CONF" "$CONF_PATH" 2>&1; then
  write_result "{\"ok\":false,\"step\":\"copy-config\",\"error\":\"cp to ${CONF_PATH} failed\"}"
  exit 1
fi

# ── Step 2: enable site (symlink) ─────────────────────────────────────────────
ln -sf "$CONF_PATH" "$LINK_PATH"

# ── Step 3: test nginx config ─────────────────────────────────────────────────
NGINX_TEST_OUT=$(nginx -t 2>&1 || true)
if ! nginx -t &>/dev/null; then
  # Undo the bad config so nginx keeps working
  rm -f "$CONF_PATH" "$LINK_PATH"
  nginx -t &>/dev/null && systemctl reload nginx &>/dev/null || true
  ERR=$(echo "$NGINX_TEST_OUT" | tail -3 | tr '"' "'" | tr '\n' ' ')
  write_result "{\"ok\":false,\"step\":\"nginx-test\",\"error\":\"${ERR}\"}"
  exit 1
fi

# ── Step 4: reload nginx ──────────────────────────────────────────────────────
if ! systemctl reload nginx 2>&1; then
  ERR="systemctl reload nginx failed"
  write_result "{\"ok\":false,\"step\":\"nginx-reload\",\"error\":\"${ERR}\"}"
  exit 1
fi

# ── Step 5: certbot SSL (only if domain provided) ─────────────────────────────
SSL_OK=false
SSL_ERROR=""

if [[ -n "$DOMAIN" ]]; then
  # --no-eff-email suppresses the "share email with EFF?" prompt that blocks
  # non-interactive runs on first-time certbot installs.
  CERTBOT_OUT=$(certbot --nginx -d "$DOMAIN" \
    --non-interactive --agree-tos --no-eff-email \
    --email "admin@${DOMAIN}" 2>&1 || true)

  if echo "$CERTBOT_OUT" | grep -qiE "Congratulations|Certificate not yet due|Successfully deployed|Successfully received"; then
    SSL_OK=true
  else
    # Trim the output to a short error message
    SSL_ERROR=$(echo "$CERTBOT_OUT" | grep -i "error\|fail\|problem" | head -2 | tr '"' "'" | tr '\n' ' ')
    [[ -z "$SSL_ERROR" ]] && SSL_ERROR="certbot returned non-zero; check /var/log/letsencrypt/"
  fi
fi

# ── Write result ──────────────────────────────────────────────────────────────
if [[ "$SSL_OK" == "true" ]]; then
  write_result "{\"ok\":true,\"sslOk\":true}"
else
  write_result "{\"ok\":true,\"sslOk\":false,\"sslError\":\"${SSL_ERROR}\"}"
fi
