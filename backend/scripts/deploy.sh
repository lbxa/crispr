#!/usr/bin/env bash
# Deploy the backend to the LinuxONE server and serve it over HTTPS.
#
#   backend/scripts/deploy.sh            # code only; keeps the server's database
#   backend/scripts/deploy.sh --with-db  # also upload backend/data/crispr.sqlite (replaces orders)
#
# Needs the server's SSH key (ask Callum). Override defaults with CRISPR_SERVER,
# CRISPR_SSH_KEY and CRISPR_HOST. Safe to rerun: every step is idempotent.
set -euo pipefail

server="${CRISPR_SERVER:-148.100.79.183}"
key="${CRISPR_SSH_KEY:-$HOME/.ssh/crispr.pem}"
host="${CRISPR_HOST:-${server//./-}.sslip.io}" # sslip.io resolves this name to the IP, so Caddy can get a certificate
with_db=0
[ "${1:-}" = "--with-db" ] && with_db=1

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bundle="$(mktemp -d)/backend.tgz"
tar --exclude=__pycache__ -czf "$bundle" -C "$backend_dir" Dockerfile requirements.txt crispr_backend scripts
files=("$bundle")
if [ "$with_db" = 1 ]; then
  [ -f "$backend_dir/data/crispr.sqlite" ] || { echo "No backend/data/crispr.sqlite; build it with etl/ first." >&2; exit 1; }
  files+=("$backend_dir/data/crispr.sqlite")
fi

echo "Uploading to $server"
scp -q -i "$key" "${files[@]}" "linux1@$server:~/"

ssh -i "$key" "linux1@$server" WITH_DB="$with_db" HOST="$host" 'bash -s' <<'REMOTE'
set -euo pipefail
mkdir -p ~/backend ~/data ~/caddy
tar -xzf ~/backend.tgz -C ~/backend && rm ~/backend.tgz
if [ "$WITH_DB" = 1 ]; then
  [ -f ~/data/crispr.sqlite ] && cp ~/data/crispr.sqlite ~/data/crispr.sqlite.previous
  mv ~/crispr.sqlite ~/data/crispr.sqlite
fi
chmod a+rwx ~/data && chmod a+rw ~/data/crispr.sqlite

echo "Building and starting the API"
cd ~/backend && sudo docker build -q -t crispr-backend . >/dev/null
sudo docker rm -f crispr-api >/dev/null 2>&1 || true
sudo docker run -d --name crispr-api --restart unless-stopped -p 127.0.0.1:8000:8000 \
  -v ~/data:/data -v ~/shared/models:/models:ro crispr-backend >/dev/null

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
printf '%s {\n\treverse_proxy 127.0.0.1:8000\n}\n' "$HOST" > ~/caddy/Caddyfile
if sudo docker ps --format '{{.Names}}' | grep -qx crispr-proxy; then
  sudo docker exec crispr-proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null
else
  sudo docker rm -f crispr-proxy >/dev/null 2>&1 || true
  sudo docker run -d --name crispr-proxy --restart unless-stopped --network host \
    -v ~/caddy/Caddyfile:/etc/caddy/Caddyfile:ro -v caddy_data:/data caddy:2 >/dev/null
fi

for _ in $(seq 60); do curl -sf localhost:8000/health >/dev/null && break; sleep 2; done
curl -sf localhost:8000/health >/dev/null || { echo "API did not start; see: sudo docker logs crispr-api" >&2; exit 1; }
REMOTE

echo "Waiting for https://$host"
for _ in $(seq 45); do
  curl -sf "https://$host/health" >/dev/null && { echo "Live: https://$host/docs"; exit 0; }
  sleep 4
done
echo "API is up but HTTPS isn't answering yet; check: ssh ... 'sudo docker logs crispr-proxy'" >&2
exit 1
