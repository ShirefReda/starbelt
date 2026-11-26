#!/usr/bin/env bash
# Private single-user setup script for gemini-api/gateway.py
# - Automatically installs the official Antigravity CLI (`agy`) if missing
# - Sets up the Python 3.11+ virtualenv (fastapi + uvicorn)
# - Creates the fixed empty workspace directory and local .env (chmod 600)
# - Guides you through the official interactive `SSH_CONNECTION=1 agy` sign-in on a headless VPS

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"

if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  echo "ERROR: Do not run setup.sh as root." >&2
  echo "Switch to your dedicated unprivileged user first (e.g. 'sudo -iu agy-gateway')." >&2
  exit 1
fi

echo "==> [1/4] Checking official Antigravity CLI (agy)..."
if command -v agy >/dev/null 2>&1; then
  AGY_PATH="$(command -v agy)"
  echo "    Found agy at: $AGY_PATH"
elif [[ -x "$HOME/.local/bin/agy" ]]; then
  AGY_PATH="$HOME/.local/bin/agy"
  echo "    Found agy at: $AGY_PATH"
else
  echo "    agy not found — installing official Antigravity CLI from https://antigravity.google/cli/install.sh ..."
  if ! command -v curl >/dev/null 2>&1; then
    echo "ERROR: 'curl' is required to install agy. Install curl and re-run." >&2
    exit 1
  fi
  curl -fsSL https://antigravity.google/cli/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"
  AGY_PATH="$(command -v agy || echo "$HOME/.local/bin/agy")"
  if [[ ! -x "$AGY_PATH" ]]; then
    echo "ERROR: agy installer finished, but 'agy' binary was not found in PATH or \$HOME/.local/bin." >&2
    exit 1
  fi
  echo "    Installed agy successfully at: $AGY_PATH"
fi

echo "==> [2/4] Setting up Python virtualenv..."
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 (3.11+) is required." >&2
  exit 1
fi

if [[ ! -x "$SCRIPT_DIR/.venv/bin/python" ]]; then
  python3 -m venv "$SCRIPT_DIR/.venv"
fi
"$SCRIPT_DIR/.venv/bin/pip" install --quiet --upgrade pip
"$SCRIPT_DIR/.venv/bin/pip" install --quiet -r "$SCRIPT_DIR/requirements.txt"
echo "    Virtualenv ready at: $SCRIPT_DIR/.venv"

echo "==> [3/4] Preparing fixed empty workspace & private .env..."
WORKSPACE_DIR="${AGY_WORKSPACE:-$HOME/agy-workspace}"
mkdir -p "$WORKSPACE_DIR"

ENV_FILE="$SCRIPT_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  TOKEN="$("$SCRIPT_DIR/.venv/bin/python" -c 'import secrets; print(secrets.token_urlsafe(40))')"
  umask 077
  cat > "$ENV_FILE" <<EOF
GATEWAY_TOKEN=$TOKEN
AGY_BIN=$AGY_PATH
AGY_WORKSPACE=$WORKSPACE_DIR
AGY_MODEL=gemini-3.8-flash-medium
AGY_MIN_GAP=2
AGY_TIMEOUT=120
PORT=8787
EOF
  chmod 600 "$ENV_FILE"
  echo "    Created $ENV_FILE (chmod 600) with a freshly generated GATEWAY_TOKEN."
else
  echo "    Keeping existing $ENV_FILE."
fi

echo "==> [4/4] Checking agy sign-in status..."
if "$AGY_PATH" models >/dev/null 2>&1; then
  echo "    agy is signed in and ready."
else
  echo "    agy is NOT signed in yet."
  if [[ -t 0 && -t 1 ]]; then
    echo "    Launching official headless SSH sign-in (SSH_CONNECTION=1 agy)..."
    echo "    Open the URL printed by agy in your browser, paste the code back here, then exit (/exit)."
    SSH_CONNECTION=1 "$AGY_PATH" || true
  else
    echo "    Run this interactively in your VPS terminal to sign in once:"
    echo "      SSH_CONNECTION=1 $AGY_PATH"
  fi
fi

echo ""
echo "Setup complete! Start the localhost-only gateway (127.0.0.1:8787) with:"
echo "  set -a && source \"$ENV_FILE\" && set +a && \"$SCRIPT_DIR/.venv/bin/python\" \"$SCRIPT_DIR/gateway.py\""
