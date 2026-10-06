#!/usr/bin/env bash
set -euo pipefail

PUBLIC_IP="${1:-143.248.56.128}"
SYNC_MODE="${2:-missing-only}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
CERTBOT_LIVE_DIR="/etc/letsencrypt/live/$PUBLIC_IP"
CERT_DIR="$PROJECT_DIR/.certs"
CERT_PATH="$CERT_DIR/cert.pem"
KEY_PATH="$CERT_DIR/key.pem"

if [[ "$SYNC_MODE" != "--force" && -s "$CERT_PATH" && -s "$KEY_PATH" ]]; then
  exit 0
fi

echo "Project HTTPS certificate is missing; checking $CERTBOT_LIVE_DIR."
if ! sudo test -r "$CERTBOT_LIVE_DIR/fullchain.pem" ||
  ! sudo test -r "$CERTBOT_LIVE_DIR/privkey.pem"; then
  cat >&2 <<EOF
No issued certificate was found for $PUBLIC_IP.

Run this first and wait until it reports "HTTPS setup is complete":
  npm run setup:https:8003

Then start the server again:
  npm run dev:8003
EOF
  exit 1
fi

mkdir -p "$CERT_DIR"
sudo install -o "$(id -u)" -g "$(id -g)" -m 0644 \
  "$CERTBOT_LIVE_DIR/fullchain.pem" "$CERT_PATH"
sudo install -o "$(id -u)" -g "$(id -g)" -m 0600 \
  "$CERTBOT_LIVE_DIR/privkey.pem" "$KEY_PATH"

echo "Copied the certificate for $PUBLIC_IP into .certs/."
