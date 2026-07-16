#!/usr/bin/env bash
# Server-Steuerung ohne pkill (in dieser Sandbox nicht im PATH).
# Haelt die PID des Langlaeufers in .server.pid, damit er sauber
# beendet werden kann. Fuer die Agenten-Shell (Bash-Tool) NICHT
# direkt nutzbar - der Tool wartet auf den Langlaeufer. Dieses
# Script ist fuer die interaktive Shell des Users gedacht.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/.server.pid"
LOG="$ROOT/.server.log"
BIN="$ROOT/node_modules/.bin/vite"

PORT="${PORT:-4173}"
MODE="${1:-preview}"

# Alten Langlaeufer beenden, falls die PID-Datei noch einen
# lebenden Prozess zeigt.
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

case "$MODE" in
  dev)
    PORT=5200
    ARGS=(--port "$PORT")
    ;;
  preview)
    ARGS=(preview --port "$PORT")
    ;;
  stop)
    stop_old
    echo "Server gestoppt."
    exit 0
    ;;
  restart)
    stop_old
    ;;
  *)
    echo "Nutzung: $0 [dev|preview|restart|stop]" >&2
    exit 2
    ;;
esac

stop_old

# setsid: eigene Session, damit der Prozess nicht am Terminal haengt.
# $! ist die PID des gestarteten vite (setsid exec't es).
setsid "$BIN" "${ARGS[@]}" >"$LOG" 2>&1 </dev/null &
echo $! >"$PIDFILE"

echo "Server (PID $(cat "$PIDFILE")) auf http://localhost:$PORT  (Log: $LOG)"
