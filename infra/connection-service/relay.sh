#!/usr/bin/env bash
# relay.sh - Steuerung des exhibit-relay (lokal via `node server.js`).
#
# Haelt die PID in .relay.pid, damit der Prozess OHNE pkill sauber
# beendet werden kann (in manchen Umgebungen ist pkill nicht im PATH).
# Konfiguration wird aus relay.env (sofern vorhanden) eingelesen.
#
# Unterbefehle:
#   start     relay im Hintergrund starten
#   stop      relay stoppen
#   restart   stop + start
#   status    Laufstatus + /health
#   logs      lokales Log verfolgen (tail -f)
#
# Aufruf:  ./relay.sh [start|stop|restart|status|logs]
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PIDFILE="$DIR/.relay.pid"
LOGFILE="$DIR/.relay.log"
ENVFILE="$DIR/relay.env"

# Konfiguration aus relay.env einlesen (sofern vorhanden).
if [[ -f "$ENVFILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENVFILE"
  set +a
fi

PORT="${PORT:-8080}"
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "FEHLER: 'node' nicht im PATH (mise/direnv aktiv?)" >&2
  exit 1
fi

is_running() {
  [[ -f "$PIDFILE" ]] || return 1
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

start() {
  if is_running; then
    echo "relay laeuft bereits (PID $(cat "$PIDFILE"))."
    return 0
  fi
  echo "Starte relay auf Port $PORT ..."
  PORT="$PORT" setsid "$NODE_BIN" server.js >"$LOGFILE" 2>&1 </dev/null &
  echo $! >"$PIDFILE"
  sleep 0.6
  if is_running; then
    echo "relay gestartet (PID $(cat "$PIDFILE")). Log: $LOGFILE"
  else
    echo "Start fehlgeschlagen - siehe $LOGFILE:" >&2
    tail -n 20 "$LOGFILE" >&2 || true
    return 1
  fi
}

stop() {
  if ! is_running; then
    echo "relay laeuft nicht."
    rm -f "$PIDFILE"
    return 0
  fi
  local pid
  pid="$(cat "$PIDFILE")"
  kill "$pid" 2>/dev/null || true
  local i=0
  while kill -0 "$pid" 2>/dev/null && [[ $i -lt 10 ]]; do
    sleep 0.5
    i=$((i + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
  echo "relay gestoppt."
}

status() {
  if is_running; then
    local pid
    pid="$(cat "$PIDFILE")"
    echo "relay: RUNNING (PID $pid, Port $PORT)"
    if command -v curl >/dev/null 2>&1; then
      local h
      h="$(curl -s -m 2 "http://localhost:$PORT/health" 2>/dev/null || true)"
      [[ -n "$h" ]] && echo "  /health: $h"
    fi
  else
    echo "relay: STOPPED"
  fi
}

logs() {
  if [[ -f "$LOGFILE" ]]; then
    tail -n 50 -f "$LOGFILE"
  else
    echo "Kein Log vorhanden (.relay.log)."
  fi
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  logs) logs ;;
  *)
    echo "Nutzung: $0 [start|stop|restart|status|logs]" >&2
    exit 2
    ;;
esac
