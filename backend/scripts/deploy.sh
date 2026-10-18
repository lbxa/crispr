#!/usr/bin/env bash
# Deploy the backend to the LinuxONE server and serve it over HTTPS.
#
#   backend/scripts/deploy.sh            # code only; keeps the server's database
#   backend/scripts/deploy.sh --with-db  # also upload backend/data/crispr.sqlite (replaces orders)
#
# Uploads backend/.env (if present) for settings such as GEMINI_API_KEY; it never goes
# into the Docker image. Needs the server's SSH key (ask Callum). Override defaults with CRISPR_SERVER,
# CRISPR_SSH_KEY and CRISPR_HOST. Safe to rerun: every step is idempotent.
set -euo pipefail

server="${CRISPR_SERVER:-148.100.79.183}"
key="${CRISPR_SSH_KEY:-$HOME/.ssh/crispr.pem}"
host="${CRISPR_HOST:-${server//./-}.sslip.io}" # sslip.io resolves this name to the IP, so Caddy can get a certificate
with_db=0
[ "${1:-}" = "--with-db" ] && with_db=1
ssh_options=(-o BatchMode=yes -o ConnectTimeout=15)
if [ -n "${CRISPR_SSH_KNOWN_HOSTS:-}" ]; then
  ssh_options+=(-o "UserKnownHostsFile=$CRISPR_SSH_KNOWN_HOSTS" -o StrictHostKeyChecking=yes)
fi

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bundle="$(mktemp -d)/backend.tgz"
tar --exclude=__pycache__ -czf "$bundle" -C "$backend_dir" Dockerfile Dockerfile.tusd Caddyfile requirements.txt crispr_backend scripts
files=("$bundle")
# Settings and secrets (GEMINI_API_KEY): uploaded separately, never baked into the image.
[ -f "$backend_dir/.env" ] && files+=("$backend_dir/.env")
if [ "$with_db" = 1 ]; then
  [ -f "$backend_dir/data/crispr.sqlite" ] || { echo "No backend/data/crispr.sqlite; build it with etl/ first." >&2; exit 1; }
  files+=("$backend_dir/data/crispr.sqlite")
fi

echo "Uploading to $server"
scp -q -i "$key" "${ssh_options[@]}" "${files[@]}" "linux1@$server:~/"

ssh -i "$key" "${ssh_options[@]}" "linux1@$server" WITH_DB="$with_db" HOST="$host" 'bash -s' <<'REMOTE'
set -euo pipefail
mkdir -p ~/backend ~/data ~/caddy
tar -xzf ~/backend.tgz -C ~/backend && rm ~/backend.tgz
if [ -f ~/.env ]; then mv ~/.env ~/backend/.env; fi
touch ~/backend/.env && chmod 600 ~/backend/.env
# The uploaded .env comes from whoever deploys; never let a missing line silently turn
# off CRISPRon scoring (the API treats an unset scorer as "no score", not an error).
grep -q '^CRISPRON_URL=' ~/backend/.env || printf '\nCRISPRON_URL=http://127.0.0.1:8001\n' >> ~/backend/.env
if [ "$WITH_DB" = 1 ]; then
  [ -f ~/data/crispr.sqlite ] && cp ~/data/crispr.sqlite ~/data/crispr.sqlite.previous
  mv ~/crispr.sqlite ~/data/crispr.sqlite
fi
# The containers run as UID 1000 (linux1), the owner, so nothing here needs to be world-writable.
chmod 0700 ~/data && chmod 0600 ~/data/crispr.sqlite
# API, worker and tusd use the same UID, with private upload directories. Runtime
# jobs live here, separate from the replaceable reference database above.
sudo install -d -m 0700 -o 1000 -g 1000 ~/data/uploads ~/data/uploads/files

echo "Building the API and native s390x resumable upload server"
if sudo docker inspect crispr-api >/dev/null 2>&1; then
  previous_image="$(sudo docker inspect -f '{{.Image}}' crispr-api)"
  sudo docker tag "$previous_image" crispr-backend:previous
fi
cd ~/backend && sudo docker build -q -t crispr-backend . >/dev/null
sudo docker build -q -f Dockerfile.tusd -t crispr-tusd . >/dev/null
# Stop the old worker before replacing the API; its lease preserves unfinished
# analysis and uploads stay on the mounted data volume across every restart.
sudo docker stop -t 30 crispr-upload-worker >/dev/null 2>&1 || true
sudo docker rm -f crispr-api >/dev/null 2>&1 || true
sudo docker run -d --name crispr-api --restart unless-stopped --network host \
  --user 1000:1000 --env-file ~/backend/.env \
  -e CRISPR_UPLOAD_DIR=/data/uploads -e "CRISPR_UPLOAD_PUBLIC_URL=https://$HOST/files/" \
  -e CRISPR_TUSD_INTERNAL_URL=http://127.0.0.1:1080/files/ \
  -v ~/data:/data -v ~/shared/models:/models:ro crispr-backend \
  uvicorn crispr_backend.api:app --host 127.0.0.1 --port 8000 --forwarded-allow-ips 127.0.0.1 >/dev/null

for _ in $(seq 60); do curl -sf localhost:8000/health >/dev/null && break; sleep 2; done
curl -sf localhost:8000/health >/dev/null || { echo "API did not start; see: sudo docker logs crispr-api" >&2; exit 1; }

sudo docker rm -f crispr-tusd >/dev/null 2>&1 || true
sudo docker run -d --name crispr-tusd --restart unless-stopped --network host \
  --memory 256m --cpus 0.5 -v ~/data/uploads/files:/data/uploads/files \
  crispr-tusd -host 127.0.0.1 -port 1080 -base-path /files/ -behind-proxy \
  -upload-dir /data/uploads/files -max-size 10737418240 \
  -disable-download -disable-concatenation \
  -file-perms 0600 -dir-perms 0700 -verbose=false \
  -cors-allow-origin '^http://localhost:3000$|^https://([a-z0-9-]+-)?crispr\.lucas-chu-barbosa\.workers\.dev$|^https://(genome|crispr)\.lbxa\.net$' \
  -cors-allow-headers Authorization \
  -hooks-http http://127.0.0.1:8000/internal/uploads/tus-hook \
  -hooks-http-forward-headers Authorization,Origin,Content-Type,X-Request-Id -hooks-enabled-events pre-create >/dev/null

sudo docker rm -f crispr-upload-worker >/dev/null 2>&1 || true
sudo docker run -d --name crispr-upload-worker --restart unless-stopped --network host \
  --user 1000:1000 --memory 1g --cpus 1 --env-file ~/backend/.env \
  -e CRISPR_UPLOAD_DIR=/data/uploads -e "CRISPR_UPLOAD_PUBLIC_URL=https://$HOST/files/" \
  -e CRISPR_TUSD_INTERNAL_URL=http://127.0.0.1:1080/files/ \
  -v ~/data:/data -v ~/shared/models:/models:ro \
  crispr-backend python -m crispr_backend.uploads.worker >/dev/null

echo "Opening ports 80 and 443"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 2 -p tcp --dport "$port" -j ACCEPT
  # Persist by editing the boot-time rules file next to the SSH rule; iptables-save
  # would also capture Docker's chains, which break restore at boot.
  grep -q -- "--dport $port -j ACCEPT" /etc/iptables/rules.v4 \
    || sudo sed -i "/--dport 22 -j ACCEPT/a -A INPUT -p tcp -m tcp --dport $port -j ACCEPT" /etc/iptables/rules.v4
done

echo "Starting the HTTPS proxy for $HOST"
[ ! -f ~/caddy/Caddyfile ] || cp ~/caddy/Caddyfile ~/caddy/Caddyfile.previous
cp ~/backend/Caddyfile ~/caddy/Caddyfile
sudo docker run --rm --network host -e "CRISPR_HOST=$HOST" \
  -v ~/caddy/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2 caddy validate --config /etc/caddy/Caddyfile >/dev/null
sudo docker rm -f crispr-proxy >/dev/null 2>&1 || true
sudo docker run -d --name crispr-proxy --restart unless-stopped --network host \
  -e "CRISPR_HOST=$HOST" \
  -v ~/caddy/Caddyfile:/etc/caddy/Caddyfile:ro -v caddy_data:/data caddy:2 >/dev/null

for service in crispr-api crispr-tusd crispr-upload-worker crispr-proxy; do
  [ "$(sudo docker inspect -f '{{.State.Running}}' "$service")" = true ] \
    || { echo "$service is not running; inspect its container logs." >&2; exit 1; }
done
curl -fsS -X OPTIONS http://127.0.0.1:1080/files/ >/dev/null \
  || { echo "The resumable upload server is not ready." >&2; exit 1; }
REMOTE

echo "Waiting for https://$host"
for _ in $(seq 45); do
  if curl -sf "https://$host/health" >/dev/null; then
    echo "Live: https://$host/docs"
    # Quick end-to-end check; run without --quick to also test a Granite order (~2 min).
    python3 "$backend_dir/scripts/smoke_test.py" --url "https://$host" --quick
    echo "Checking resumable upload and durable analysis through public HTTPS"
    # LinuxONE's public IP does not support NAT loopback. Exercise the public
    # proxy from this deploying client, using the declared development environment.
    validation_python="${CRISPR_VALIDATION_PYTHON:-$backend_dir/.venv/bin/python}"
    [ -x "$validation_python" ] || validation_python=python3
    (cd "$backend_dir" && "$validation_python" -m scripts.validate_large_genome \
      --url "https://$host" --size-bytes 16777216 --baseline-bytes 1048576 --encoding plain)
    exit 0
  fi
  sleep 4
done
echo "API is up but HTTPS isn't answering yet; check: ssh ... 'sudo docker logs crispr-proxy'" >&2
exit 1
