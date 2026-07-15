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

## Exponat-Server — Nutzung als Exponat

Der Relay ist exponat-agnostisch: ein **Exponat** (z.B. sqrt2 auf einem
Ausstellungsterminal) agiert als **Host** und nutzt den Dienst, um Besucher
per QR-Code in einen geteilten Raum zu holen. Das Schema:

1. **Token minten** (Exponat → Service, mit `API_KEY`):

   ```http
   POST /api/token
   Authorization: Bearer <API_KEY>
   Content-Type: application/json

   { "seats": 4, "pin": "1234", "label": "sqrt2-Exponat-1" }
   ```

   Antwort: `{ "token": "<opak>", "wsUrl": "wss://…/ws", "seats": 4, "pin": "1234" }`.
   Der `token` wird als QR-Code auf dem Exponat-Bildschirm angezeigt, die
   `wsUrl` ist die WebSocket-URL für Besucher.

2. **Host verbinden** (Exponat öffnet die Relay-Verbindung als `role=host`;
   der Host zählt **nicht** gegen `seats` und muss keine PIN liefern):

   ```
   wss://<host>/ws?token=<token>&role=host
   ```

3. **Besucher joint** (Handy scannt QR → `wsUrl` + `token` + angezeigter PIN):

   ```
   wss://<host>/ws?token=<token>&role=guest&pin=1234
   ```

4. **App-Nachrichten relayen.** Beide Seiten senden generische JSON-Payloads:
   Exponat → Besucher = `configStore`/`playbackStore`-Deltas (bei sqrt2),
   Besucher → Exponat = Steuerbefehle. Der Relay broadcastet `app`-Nachrichten
   an alle Raum-Mitglieder — kein Server-Wissen über die Semantik.

   ```json
   { "type": "app", "payload": { "configStore": { "depth": 12 } } }
   ```

5. **PIN rotieren** (optional, gegen "Mitfahren" mit abgelaufenen Codes):
   `PATCH /api/token/<token>/pin` mit neuem `pin`, alter QR wird wertlos.

Minimales Host-Beispiel (Node, `ws`):

```js
import { WebSocket } from 'ws';
const API_KEY = process.env.API_KEY;
const base = process.env.RELAY_BASE ?? 'http://localhost:8080';

// 1) Token minten
const { token, wsUrl } = await fetch(`${base}/api/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
  body: JSON.stringify({ seats: 4, pin: '1234', label: 'sqrt2' }),
}).then((r) => r.json());

// 2) Als Host verbinden + App-Payloads relayen
const ws = new WebSocket(`${wsUrl}?token=${token}&role=host`);
ws.on('message', (m) => {
  const msg = JSON.parse(m.toString());
  if (msg.type === 'app') applyToExhibit(msg.payload); // z.B. Store-Update
});
function broadcast(payload) {
  ws.send(JSON.stringify({ type: 'app', payload }));
}
```

> Siehe `docs/CONNECTION_SERVICE_SPEC.md` §2/§3/§6 für das vollständige
> Protokoll (Nachrichtentypen `joined` / `presence` / `app` / `error`,
> Heartbeat, Host-Wegfall).

---

## Tests

Zwei fokussierte Testscripts, jeweils mit eigenem, gestartetem Relay-Server
(Plain http/ws, deterministische Secrets):

```bash
npm test                 # test-api.mjs  +  test-connection.mjs
npm run test:api         # REST-API-Zugang (Minting, Verify, PIN-Rotation,
                         #   Revoke, Admin, Health, Status-Page, CORS, Rate-Limit)
npm run test:connection  # WebSocket-Verbindung (Host/Guest-Join, Relay A→B,
                         #   Presence, Seat-Limit, PIN, PIN-Backoff)
npm run smoke            # Kombiniert beide (= npm test)
```

Für TLS-Tests den Relay extern mit `TLS_CERT`/`TLS_KEY` starten; die
focused Scripts testen den Plain-Pfad. `test-helpers.mjs` stellt den
gemeinsamen Server-Start, `req()` und `openWs()` bereit.

---

## Dateien

```
server.js             Relay-Server (REST + WebSocket), RAM-only
ratelimit.js          Brute-Force-Härtung (Rate-Limit + PIN-Backoff)
test-helpers.mjs      Gemeinsame Helfer (Server-Start, req, openWs, checker)
test-api.mjs          REST-API-Zugangstests (25 Checks)
test-connection.mjs   WebSocket-Relay-Tests (19 Checks)
relay.sh              start/stop/restart/status/logs (lokal, node)
setup-tailscale.sh    config / check / reachable / https
docker-compose.yml    Relay (+ optionales Traefik via --profile edge)
Dockerfile            node:22-alpine Image
relay.env             (generiert) Konfiguration des Helfers — nicht committen
certs/                (generiert) tailscale-Zertifikate — nicht committen
```
