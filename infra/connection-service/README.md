# exhibit-relay — Connection Service

Generischer, exponat-agnostischer Echtzeit-Relay-Dienst für Exponate
(sqrt2 und wiederverwendbar für Spiele, Film-Sync, Steuerung, …).

Ein **Exponat** (trusted Device) meldet sich mit einem **API-Key** an,
erzeugt daraus **Join-Tokens** (opak, per QR an Besucher), die einen
**Raum** mit begrenzten **Seats** und optionalem **PIN** öffnen. Der Dienst
relayed generische JSON-Nachrichten zwischen den Raum-Mitgliedern — keine
Anwendungslogik im Server.

> Vollständige Spezifikation: [`docs/CONNECTION_SERVICE_SPEC.md`](../../docs/CONNECTION_SERVICE_SPEC.md)

---

## Schnellstart

### Lokal (Node, HTTP/ws)

```bash
npm install          # nur die ws-Abhaengigkeit
API_KEYS=mein-key node server.js
# ADMIN_KEY wird beim ersten Start auf die Console gedruckt (persistent in ./data)
```

### Docker Compose

```bash
docker compose up    # relay auf :8080, ADMIN_KEY auf der Console
```

Empfohlen für Test & Intern: **Tailscale** (siehe unten) — kein eigener
Reverse-Proxy/TLS nötig.

---

## Steuerung (lokal)

`relay.sh` startet `node server.js` als Hintergrund-Daemon (PID-Datei,
kein `pkill`):

```bash
./relay.sh start      # starten
./relay.sh stop       # stoppen
./relay.sh restart    # neu starten
./relay.sh status     # Laufstatus + /health
./relay.sh logs       # lokales Log (tail -f)
```

Konfiguration wird aus `relay.env` (sofern vorhanden) eingelesen.

---

## Einrichtungs-Helfer (Tailscale)

`setup-tailscale.sh` führt durch die vier Schritte der Tailscale-Einrichtung
(Spec §7, Variante A):

| Befehl | Zweck |
|--------|-------|
| `./setup-tailscale.sh config` | **Konfiguration einfordern** (interaktiv): Magic-DNS-Name, API-Key, Seats/TTL, CORS, TLS-Wunsch → schreibt `relay.env` |
| `./setup-tailscale.sh check` | **Konfiguration prüfen**: Tailscale-Installation, Login (`BackendState`), Magic-DNS, `relay.env`, lokaler Port |
| `./setup-tailscale.sh reachable` | **Erreichbarkeit testen**: `http://<host>.<tailnet>.ts.net:8080/health` über das Tailnet |
| `./setup-tailscale.sh https` | **https testen**: Zertifikat via `tailscale cert` bereitstellen, Relay mit TLS starten, `https://…/health` + `wss://`-URL prüfen |

Ablauf: zuerst `config` (erzeugt `relay.env`), dann `check`, danach
`relay.sh start` und `reachable`. Für verschlüsselten Transport (ab
öffentlichen Domains oder einfach production-nahe) `https` ausführen — das
schreibt `TLS_CERT`/`TLS_KEY` nach `relay.env`, startet den Relay neu und
testet `https`/`wss`.

Beispiel:

```bash
./setup-tailscale.sh config      # FQDN = exhibit-sqrt2.<tailnet>.ts.net, TLS=Ja
./setup-tailscale.sh check
./relay.sh start
./setup-tailscale.sh reachable
./setup-tailscale.sh https       # erzeugt certs/, startet Relay mit TLS
```

---

## Umgebungsvariablen

| Variable | Default | Bedeutung |
|----------|---------|-----------|
| `PORT` | `8080` | HTTP/HTTPS/WSS-Port |
| `DATA_DIR` | `/data` | Ort für `admin_key` (+ Token-DB später) |
| `API_KEYS` | (zufällig, temporär) | Komma-getrennte Exponat-Keys (Token-Minting) |
| `ADMIN_KEY` | (einmalig generiert, in `DATA_DIR`) | Admin-REST/UI-Schlüssel |
| `TOKEN_TTL_DEFAULT` | `3600` | Token-Gültigkeit in Sekunden |
| `MAX_SEATS_DEFAULT` | `4` | Seats, wenn Token kein `seats` angibt |
| `ALLOWED_ORIGINS` | (leer) | CORS: komma-getrennte Origins |
| `TLS_CERT` / `TLS_KEY` | (leer) | PEM-Pfade → startet **https + wss://** |
| `HEARTBEAT_MS` | `30000` | WS-Heartbeat-Intervall |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `120` / `60000` | Minting-Rate-Limit pro API-Key |
| `PIN_BACKOFF_GRACE` / `PIN_BACKOFF_BASE_MS` / `PIN_BACKOFF_MAX_MS` | `8` / `1000` / `60000` | Exponentielles PIN-Backoff je Token |

---

## Tests

```bash
npm run smoke        # node smoke-test.mjs  (27 Checks: Minting, Seats,
                     #   PIN, PIN-Backoff, Rate-Limit, WS-Relay, CORS,
                     #   Status-Page, Admin-UI, Ops-Skripte)
```

Für TLS-Tests den Relay extern mit `TLS_CERT`/`TLS_KEY` starten und
`TLS=1 npm run smoke` ausführen.

---

## Dateien

```
server.js             Relay-Server (REST + WebSocket), RAM-only
ratelimit.js          Brute-Force-Härtung (Rate-Limit + PIN-Backoff)
smoke-test.mjs        27-Check Smoke-Test
relay.sh              start/stop/restart/status/logs (lokal, node)
setup-tailscale.sh    config / check / reachable / https
docker-compose.yml    Relay (+ optionales Traefik via --profile edge)
Dockerfile            node:22-alpine Image
relay.env             (generiert) Konfiguration des Helfers — nicht committen
certs/                (generiert) tailscale-Zertifikate — nicht committen
```
