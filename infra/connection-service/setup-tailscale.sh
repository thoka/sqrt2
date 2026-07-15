#!/usr/bin/env bash
# setup-tailscale.sh - Einrichtungs-Helfer fuer den exhibit-relay ueber Tailscale.
#
# Tailscale ist der empfohlene Pfad fuer Test & Intern (Spec §7, Variante A):
# das Exponat bekommt eine verschluesselte Tailnet-IP und einen Magic-DNS-
# Namen <host>.<tailnet>.ts.net - ohne eigenen Reverse-Proxy/TLS sofort vom
# Besucher-Handy erreichbar. Dieses Skript fuehrt durch die vier Schritte:
#
#   config     Konfiguration einfordern (interaktiv) -> schreibt relay.env
#   check      Konfiguration pruefen (Tailscale-Login, Magic-DNS, relay.env, Port)
#   reachable  Erreichbarkeit ueber die Tailnet-IP / Magic-DNS testen
#   https      TLS-Zertifikat via `tailscale cert` bereitstellen + https/wss testen
#
# Aufruf:  ./setup-tailscale.sh [config|check|reachable|https]
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

ENVFILE="$DIR/relay.env"
CERT_DIR="$DIR/certs"

# ---------- gemeinsame Helfer ----------
need_tailscale() {
  if ! command -v tailscale >/dev/null 2>&1; then
    echo "FEHLER: 'tailscale' ist nicht installiert." >&2
    echo "       Installiere Tailscale: https://tailscale.com/download" >&2
    exit 1
  fi
}

source_env() {
  if [[ -f "$ENVFILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENVFILE"
    set +a
  fi
}
source_env
PORT="${PORT:-8080}"

# Tailscale-Status als JSON parsen (node ist garantiert verfuegbar).
ts_json() { tailscale status --json 2>/dev/null; }

self_dns() {
  ts_json | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const out = (n) => process.stdout.write(String(n).replace(/\.$/, ""));
      try {
        const j = JSON.parse(s || "{}");
        if (j.Self && j.Self.DNSName) return out(j.Self.DNSName);
        const ps = j.Peer || {};
        for (const k in ps) if (ps[k].Self && ps[k].DNSName) return out(ps[k].DNSName);
      } catch (e) { /* ignore */ }
      process.stdout.write("");
    });'
}

backend_state() {
  ts_json | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const j = JSON.parse(s || "{}"); process.stdout.write(j.BackendState || ""); }
      catch (e) { process.stdout.write(""); }
    });'
}

self_online() {
  ts_json | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const j = JSON.parse(s || "{}");
        let p = j.Self;
        if (!p) { const ps = j.Peer || {}; for (const k in ps) if (ps[k].Self) { p = ps[k]; break; } }
        process.stdout.write(p && p.Online ? "1" : "0");
      } catch (e) { process.stdout.write("0"); }
    });'
}

# Eine Key=Value-Zeile in relay.env setzen (andere Zeilen bleiben erhalten).
set_env_key() {
  local k="$1" v="$2"
  [[ -f "$ENVFILE" ]] || touch "$ENVFILE"
  local tmp
  tmp="$(mktemp)"
  grep -v "^${k}=" "$ENVFILE" >"$tmp" || true
  printf '%s=%s\n' "$k" "$v" >>"$tmp"
  mv "$tmp" "$ENVFILE"
}

# ---------- Konfiguration einfordern ----------
cmd_config() {
  need_tailscale
  local default_dns
  default_dns="$(self_dns)"
  echo "== Konfiguration einfordern =="
  echo "   (Enter uebernimmt jeweils den [Vorschlag])"
  echo

  local fqdn api seats ttl origins tls
  read -r -p "Magic-DNS-Name (FQDN) [${default_dns:-exhibit-sqrt2.tailnet.ts.net}]: " fqdn
  fqdn="${fqdn:-$default_dns}"

  read -r -p "API-Key (leer = zufaellig generieren): " api
  if [[ -z "$api" ]]; then
    api="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
    echo "   generierter API-Key: $api"
  fi

  read -r -p "MAX_SEATS_DEFAULT [4]: " seats
  seats="${seats:-4}"
  read -r -p "TOKEN_TTL_DEFAULT (Sekunden) [3600]: " ttl
  ttl="${ttl:-3600}"
  read -r -p "ALLOWED_ORIGINS (komma-getrennt, leer = keine CORS): " origins
  read -r -p "TLS ueber tailscale cert aktivieren? [J/n]: " tls
  tls="${tls:-J}"
  [[ "$tls" == [Jj]* ]] && tls=1 || tls=0

  cat >"$ENVFILE" <<EOF
# Automatisch erzeugt durch setup-tailscale.sh config
PORT=8080
API_KEYS=$api
MAX_SEATS_DEFAULT=$seats
TOKEN_TTL_DEFAULT=$ttl
ALLOWED_ORIGINS=$origins
RELAY_FQDN=$fqdn
RELAY_TLS=$tls
EOF
  echo
  echo "[OK] Konfiguration geschrieben nach $ENVFILE"

  if [[ "$tls" == "1" ]]; then
    echo "TLS gewuenscht -> Zertifikat nun bereitstellen (Schritt 'https')."
    cmd_https
  fi
}

# ---------- Konfiguration pruefen ----------
cmd_check() {
  need_tailscale
  local ok=1
  echo "== Konfiguration pruefen =="
  echo

  if command -v tailscale >/dev/null 2>&1; then
    echo "[OK]   tailscale installiert ($(tailscale version | head -1))"
  else
    echo "[FAIL] tailscale nicht installiert"
    ok=0
  fi

  local st
  st="$(backend_state)"
  if [[ "$st" == "Running" ]]; then
    echo "[OK]   Tailscale eingeloggt (BackendState=$st)"
  else
    echo "[WARN] Tailscale BackendState='$st' (evtl. nicht eingeloggt: 'tailscale up')"
    ok=0
  fi

  local dns
  dns="$(self_dns)"
  if [[ -n "$dns" ]]; then
    echo "[OK]   Magic-DNS: $dns"
  else
    echo "[FAIL] Kein Magic-DNS-Name gefunden (Device online? 'tailscale up')"
    ok=0
  fi

  if [[ -f "$ENVFILE" ]]; then
    echo "[OK]   relay.env vorhanden"
    grep -q '^API_KEYS=' "$ENVFILE" && echo "[OK]   API_KEYS gesetzt" || { echo "[FAIL] API_KEYS fehlt in relay.env"; ok=0; }
    grep -q '^RELAY_FQDN=' "$ENVFILE" && echo "[OK]   RELAY_FQDN gesetzt" || echo "[WARN] RELAY_FQDN fehlt (nur lokal/HTTP)"
  else
    echo "[WARN] relay.env fehlt - zuerst 'config' ausfuehren"
    ok=0
  fi

  if curl -s -m 2 "http://localhost:$PORT/health" >/dev/null 2>&1; then
    echo "[OK]   relay lokal erreichbar (:${PORT}/health)"
  else
    echo "[WARN] relay lokal nicht erreichbar (gestartet? './relay.sh start')"
  fi

  echo
  if [[ $ok -eq 1 ]]; then
    echo "==> Konfiguration OK"
  else
    echo "==> Konfiguration unvollstaendig - siehe oben."
  fi
  return $(( ! ok ))
}

# ---------- Erreichbarkeit testen ----------
cmd_reachable() {
  source_env
  local fqdn="${RELAY_FQDN:-$(self_dns)}"
  [[ -n "$fqdn" ]] || { echo "FEHLER: kein FQDN (zuerst 'config' ausfuehren)." >&2; exit 1; }
  echo "== Erreichbarkeit testen: $fqdn:$PORT =="
  local body
  if body="$(curl -s -m 5 "http://$fqdn:$PORT/health" 2>/dev/null)"; then
    echo "[OK] ueber Tailnet erreichbar: $body"
  else
    echo "[FAIL] $fqdn:$PORT nicht erreichbar (Firewall? relay gestartet? Device im selben Tailnet?)"
    exit 1
  fi
}

# ---------- https testen ----------
cmd_https() {
  need_tailscale
  source_env
  local fqdn="${RELAY_FQDN:-$(self_dns)}"
  [[ -n "$fqdn" ]] || { echo "FEHLER: kein FQDN (zuerst 'config' ausfuehren)." >&2; exit 1; }

  mkdir -p "$CERT_DIR"
  local crt="$CERT_DIR/$fqdn.crt"
  local key="$CERT_DIR/$fqdn.key"

  if [[ -f "$crt" && -f "$key" ]]; then
    echo "[OK] Zertifikat vorhanden: $crt"
  else
    echo "Erzeuge Zertifikat via 'tailscale cert $fqdn' ..."
    ( cd "$CERT_DIR" && tailscale cert "$fqdn" )
  fi

  if [[ ! -f "$crt" || ! -f "$key" ]]; then
    echo "[FAIL] Zertifikat wurde nicht erzeugt (siehe Ausgabe oben)."
    exit 1
  fi

  set_env_key "TLS_CERT" "$crt"
  set_env_key "TLS_KEY" "$key"
  set_env_key "RELAY_TLS" "1"
  echo "[OK] TLS_CERT/TLS_KEY in relay.env gesetzt."

  echo "Relay mit TLS neu starten (./relay.sh restart) und https testen ..."
  if [[ -x "$DIR/relay.sh" ]]; then
    "$DIR/relay.sh" restart >/dev/null 2>&1 || true
    sleep 1
  fi

  if curl -sk -m 5 "https://$fqdn:$PORT/health" 2>/dev/null; then
    echo
    echo "[OK] https erreichbar (https/wss aktiv)."
    echo "     Besucher-URL (WSS): wss://$fqdn:$PORT/ws"
  else
    echo
    echo "[WARN] https nicht erreichbar - relay mit TLS starten:"
    echo "       RELAY_TLS=1 ./relay.sh restart"
  fi
}

case "${1:-}" in
  config) cmd_config ;;
  check) cmd_check ;;
  reachable) cmd_reachable ;;
  https) cmd_https ;;
  "" | -h | --help | help)
    echo "Nutzung: $0 [config|check|reachable|https]"
    echo "  config     Konfiguration interaktiv einfordern -> relay.env"
    echo "  check      Tailscale-Login / Magic-DNS / relay.env / Port pruefen"
    echo "  reachable  Erreichbarkeit ueber Tailnet (Magic-DNS) testen"
    echo "  https      'tailscale cert' + https/wss testen"
    ;;
  *)
    echo "Unbekannter Unterbefehl: $1" >&2
    echo "Nutzung: $0 [config|check|reachable|https]" >&2
    exit 2
    ;;
esac
