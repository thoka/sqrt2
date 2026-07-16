#!/usr/bin/env bash
# Weist diesem Klon einmalig eindeutige Ports zu, damit mehrere geklonte
# Repos (oder Worker) auf einem Host nicht um Vite/Relay-Ports konkurrieren.
#
# Erzeugt .ports.local.env (gitignored), das von mise.toml via [env] _.file
# eingebunden wird - die Ports stehen damit automatisch im PATH (direnv),
# ohne dass man sie von Hand setzen muss.
#
# Idempotent: erneut aufrufen aendert bestehende Ports nicht, ausser mit --force.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL="$ROOT/.ports.local.env"

if [[ -f "$LOCAL" && "${1:-}" != "--force" ]]; then
  echo "Ports bereits vergeben in $LOCAL (--force zum Neuvergeben):"
  grep -E 'RELAY_PORT|PORT' "$LOCAL" || true
  exit 0
fi

# Zufaellige, voneinander getrennte Ports aus wenig genutzten Bereichen.
# RELAY_PORT: 8100-8199, PORT (Vite preview): 4200-4299, dev: 5200-5299.
relay_port=$(( 8100 + RANDOM % 100 ))
preview_port=$(( 4200 + RANDOM % 100 ))
dev_port=$(( 5200 + RANDOM % 100 ))

cat >"$LOCAL" <<EOF
# Lokal, pro Klon - NICHT committen. Von mise.toml [env] _.file eingebunden.
RELAY_PORT=$relay_port
PORT=$preview_port
DEV_PORT=$dev_port
EOF

echo "Lokale Ports vergeben ($LOCAL):"
grep -E 'RELAY_PORT|PORT' "$LOCAL"
echo "=> beim naechsten Betreten des Repos (direnv/mise) automatisch aktiv."
