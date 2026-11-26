# Private Single-User Gateway for Official `agy` CLI

A minimal, localhost-only FastAPI gateway that runs Google's official `agy` CLI in headless print mode (`agy -p`) on your own server for your own private use.

## Verified `agy` CLI Flags

Discovered directly via `agy --help`, `agy -p --help`, and `agy models`:

- `-p` / `--print`: run a single prompt non-interactively and print the response
- `--model <id>`: select a model from the live `agy models` allowlist
- `--sandbox`: run with terminal restrictions enabled
- `--disable-slash-commands`: disable slash command and skill expansion in print mode
- `--output-format text|stream-json`: plain text response for `/v1/ask`, NDJSON `text_delta` stream for `/v1/ask/stream`
- `--dangerously-skip-permissions` is **never** used

## Quick Setup (Auto-Installs `agy` If Missing)

Run as your dedicated unprivileged Linux user (not root):

```bash
chmod +x setup.sh
./setup.sh
```

`setup.sh` automatically:
1. Checks for `agy` and installs the official Antigravity CLI (`https://antigravity.google/cli/install.sh`) if missing.
2. Creates `.venv` and installs `fastapi` + `uvicorn`.
3. Creates a fixed empty workspace and a `chmod 600` `.env` with a 40-byte `GATEWAY_TOKEN`.
4. Launches `SSH_CONNECTION=1 agy` if not yet signed in so `agy` prints its official sign-in link on a headless VPS.

## Server Setup (Manual Steps)

1. Create a dedicated unprivileged user (no sudo) and empty workspace:
   ```bash
   sudo useradd -m -s /bin/bash agy-gateway
   sudo mkdir -p /srv/agy-gateway /srv/agy-workspace /etc/agy-gateway
   sudo chown agy-gateway:agy-gateway /srv/agy-gateway /srv/agy-workspace
   ```

2. Install the official `agy` CLI as `agy-gateway` (from `antigravity.google`) and sign in interactively once:
   ```bash
   sudo -iu agy-gateway
   curl -fsSL https://antigravity.google/cli/install.sh | bash
   export PATH="$HOME/.local/bin:$PATH"
   # Force headless URL + code flow on a VPS:
   SSH_CONNECTION=1 agy
   # Verify it works:
   agy -p "say hi"
   exit
   ```

3. Copy this project into `/srv/agy-gateway` and create the Python 3.11+ virtualenv:
   ```bash
   sudo cp gateway.py requirements.txt .env.example /srv/agy-gateway/
   sudo chown -R agy-gateway:agy-gateway /srv/agy-gateway
   sudo -u agy-gateway python3 -m venv /srv/agy-gateway/.venv
   sudo -u agy-gateway /srv/agy-gateway/.venv/bin/pip install -r /srv/agy-gateway/requirements.txt
   ```

4. Create the private environment file (readable only by `agy-gateway`):
   ```bash
   sudo cp .env.example /etc/agy-gateway/env
   # Generate a 32+ char secret and put it in GATEWAY_TOKEN inside /etc/agy-gateway/env:
   python3 -c "import secrets; print(secrets.token_urlsafe(40))"
   sudo chown agy-gateway:agy-gateway /etc/agy-gateway/env
   sudo chmod 600 /etc/agy-gateway/env
   ```

5. Install and enable the systemd service:
   ```bash
   sudo cp agy-gateway.service /etc/systemd/system/agy-gateway.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now agy-gateway
   sudo systemctl status agy-gateway
   ```

6. Verify the service listens **only** on `127.0.0.1`:
   ```bash
   ss -ltnp | grep 8787
   ```

## Emergency Kill Switch

To immediately disable the gateway (returns `503` on every request):
```bash
sudo touch /srv/agy-gateway/DISABLED
```
To re-enable:
```bash
sudo rm /srv/agy-gateway/DISABLED
```

## How Your App Connects (Private Path Only)

The gateway binds strictly to `127.0.0.1:8787` and must **never** be exposed to the public internet or opened in your firewall.

### Option 1: SSH Tunnel
```bash
ssh -N -L 8787:127.0.0.1:8787 user@my-server
```
Your app then calls `http://127.0.0.1:8787`.

### Option 2: Tailscale or WireGuard
Keep the gateway bound to `127.0.0.1:8787` and publish it **privately** inside your tailnet/VPN only (for example, `tailscale serve` limited to your own tailnet, never Funnel/public).

## API Usage

### Health Check
```bash
curl http://127.0.0.1:8787/healthz
# {"ok":true}
```

### Ask (Standard JSON)
Default model is `gemini-3.8-flash-medium` (overridable via `AGY_MODEL` or per-request `"model"`).
```bash
curl -X POST http://127.0.0.1:8787/v1/ask \
  -H "Authorization: Bearer $GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Reply with exactly: OK"}'
# {"text":"OK"}
```

### Ask (Server-Sent Events Streaming)
```bash
curl -N -X POST http://127.0.0.1:8787/v1/ask/stream \
  -H "Authorization: Bearer $GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Count from 1 to 3","model":"gemini-3.8-flash-low"}'
```
