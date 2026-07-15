#!/usr/bin/env bash
# Relay als Hintergrund-Prozess fuer die Vite-Dev/Preview-Proxy-Variante.
# Vite (server + preview) proxyed /api + /ws auf diesen Relay (Port 8080),
# sqrt2 und Relay laufen damit unter EINEM Origin -> kein CORS.
#
#   scripts/relay-dev.sh start    # startet infra/connection-service/server.js
#   scripts/relay-dev.sh stop     # stoppt es (PID-Datei, kein pkill)
#   scripts/relay-dev.sh restart
#   scripts/relay-dev.sh status
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELAY_DIR="$ROOT/infra/connection-service"
PIDFILE="$ROOT/.relay.pid"
LOG="$ROOT/.relay.log"

stop_old() {
  if [[ -f "$PIDFILE" ]]; then
    local old
    old="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [[ -n "$old" ]] && kill -0 "$old" 2>/dev/null; then
      kill "$old" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$PIDFILE"
  fi
}

start() {
  stop_old
  cd "$RELAY_DIR"
  DATA_DIR="$ROOT/infra/connection-service/data" PORT="${RELAY_PORT:-8080}" \
    node server.js >"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  echo "Relay gestartet (PID $(cat "$PIDFILE")), Log: $LOG"
}

case "${1:-start}" in
  start) start ;;
  stop) stop_old; echo "Relay gestoppt." ;;
  restart) start ;;
  status)
    if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Relay laeuft (PID $(cat "$PIDFILE"))"; else echo "Relay nicht aktiv"; fi ;;
  *) echo "Usage: $0 {start|stop|restart|status}"; exit 1 ;;
esac
