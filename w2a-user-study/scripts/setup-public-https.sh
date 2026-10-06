#!/usr/bin/env bash
set -euo pipefail

PUBLIC_IP="${1:-143.248.56.128}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

certbot_is_compatible() {
  local candidate="$1"
  local version major minor

  [[ -x "$candidate" ]] || return 1
  version="$($candidate --version 2>&1 | sed -E 's/[^0-9]*([0-9]+\.[0-9]+).*/\1/')"
  major="${version%%.*}"
  minor="${version#*.}"

  [[ "$major" =~ ^[0-9]+$ ]] &&
    [[ "$minor" =~ ^[0-9]+$ ]] &&
    ((major > 5 || (major == 5 && minor >= 4)))
}

CERTBOT_BIN=""
if command -v certbot >/dev/null 2>&1; then
  SYSTEM_CERTBOT="$(command -v certbot)"
  if certbot_is_compatible "$SYSTEM_CERTBOT"; then
    CERTBOT_BIN="$SYSTEM_CERTBOT"
  fi
fi

if [[ -z "$CERTBOT_BIN" ]] && certbot_is_compatible /opt/certbot/bin/certbot; then
  CERTBOT_BIN=/opt/certbot/bin/certbot
fi

if [[ -z "$CERTBOT_BIN" ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 with the venv module is required to install Certbot." >&2
    exit 1
  fi

  echo "Installing Certbot 5.4 or newer in /opt/certbot."
  if ! sudo python3 -m venv /opt/certbot; then
    cat >&2 <<'EOF'
Could not create the Certbot virtual environment.
On Ubuntu/Debian, install the missing dependency with:
  sudo apt update && sudo apt install -y python3-venv
Then run this setup command again.
EOF
    exit 1
  fi
  sudo /opt/certbot/bin/python -m pip install --upgrade pip
  sudo /opt/certbot/bin/python -m pip install --upgrade 'certbot>=5.4'
  CERTBOT_BIN=/opt/certbot/bin/certbot
fi

if ! certbot_is_compatible "$CERTBOT_BIN"; then
  echo "Failed to install a compatible Certbot version." >&2
  exit 1
fi

echo "Requesting a trusted short-lived certificate for $PUBLIC_IP."
echo "Using $($CERTBOT_BIN --version)."
echo "Inbound TCP port 80 must reach this server during validation."

CERTBOT_REGISTRATION_ARGS=(--non-interactive --agree-tos)
if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
  CERTBOT_REGISTRATION_ARGS+=(--email "$CERTBOT_EMAIL")
else
  CERTBOT_REGISTRATION_ARGS+=(--register-unsafely-without-email)
fi

CERTBOT_LOG="$(mktemp "${TMPDIR:-/tmp}/w2a-certbot.XXXXXX")"
trap 'rm -f "$CERTBOT_LOG"' EXIT

for attempt in 1 2 3 4 5 6; do
  : >"$CERTBOT_LOG"
  if sudo "$CERTBOT_BIN" certonly \
    "${CERTBOT_REGISTRATION_ARGS[@]}" \
    --preferred-profile shortlived \
    --standalone \
    --ip-address "$PUBLIC_IP" 2>&1 | tee "$CERTBOT_LOG"; then
    break
  fi

  if ! grep -q 'Another instance of Certbot is already running' "$CERTBOT_LOG"; then
    exit 1
  fi

  if ((attempt == 6)); then
    cat >&2 <<'EOF'
Certbot remained locked for one minute. Check the existing process with:
  ps -ef | grep '[c]ertbot'
Wait for a legitimate renewal to finish, then run this setup command again.
Do not delete Certbot lock files while a process is active.
EOF
    exit 1
  fi

  echo "Another Certbot process is active; retrying in 10 seconds ($attempt/5)."
  sleep 10
done

CERTBOT_LIVE_DIR="/etc/letsencrypt/live/$PUBLIC_IP"
if ! sudo test -r "$CERTBOT_LIVE_DIR/fullchain.pem" ||
  ! sudo test -r "$CERTBOT_LIVE_DIR/privkey.pem"; then
  echo "Certificate files were not found in $CERTBOT_LIVE_DIR." >&2
  exit 1
fi

bash "$SCRIPT_DIR/sync-public-cert.sh" "$PUBLIC_IP" --force

cd "$PROJECT_DIR"
node scripts/configure-https-env.mjs

cat <<EOF

HTTPS setup is complete.

Start the demo with:
  npm run dev:8003

Then open:
  https://$PUBLIC_IP:8003

The IP certificate is valid for about six days. Run this setup command again
after renewal, then restart the npm process so it loads the renewed certificate.
EOF
