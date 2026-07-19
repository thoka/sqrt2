# Deployment & Betrieb — √2-Exponat (inkl. QR-Fernsteuerung)

Zentrale Betriebsanleitung. Ergänzt `README.md` (Projektziel),
`docs/TOOLING_SPEC.md` (Architektur-/Migrations-Historie, §8 "Deployment:
GitHub Pages" für die statische Demo ohne Relay) und
`docs/CONNECTION_SERVICE_SPEC.md` (Protokoll-Detail, §10 "Betriebsmodell"
für die Entscheidung "ein Server"). Hier steht der **durchgängige
Betriebsfluss**: wie man das Exponat startet, wie das Besucher-Handy
joint, warum **ein Server / ein Origin** genutzt wird.

---

## 1. Grundmodell: ein Server, ein Origin

Das Exponat (sqrt2-Haupttool) und der Connection-Relay laufen **im selben
Node-Prozess unter derselben URL** (ein Origin). Dadurch:

- **Kein CORS** (kein `ALLOWED_ORIGINS` nötig).
- **Kein zweiter Prozess**, kein Proxy-Gefrickel im Produktivbetrieb.
- Besucher laden die Oberfläche und joinen den Relay über **dieselbe URL**.

Der Relay ist dafür eine **Bibliothek** (`createRelay()` in
`server/relay/server.js`), die embedded mitläuft — nicht mehr
ein eigenständiger Dienst.

Zwei Betriebswege (beide = ein Origin):

| Weg | Nutzung | Was läuft |
|-----|---------|-----------|
| **A. Exponat-Server** | Produktion | `server/index.js`: ein Prozess serviert `dist/` (Statics) **+** Relay (`/api`,`/ws`) |
| **B. Vite + Relay-Hintergrund** | Entwicklung | Vite proxyed `/api`+`/ws` auf `scripts/relay-dev.sh` (Relay auf `:8080`) |

---

## 2. Weg A — Exponat-Server (Produktion)

```bash
pnpm install
pnpm build                                   # erzeugt dist/

DATA_DIR=./data API_KEYS=<dein-key> PORT=5173 node server/index.js
# -> http://localhost:5173  (Oberflaeche + /api/token + /ws, ein Origin)
```

- `PORT` = der Port, unter dem das Exponat erreichbar ist (für Gäste = die
  URL, die das Handy erreichen muss, z.B. Tailnet-Hostname).
- `API_KEYS` = komma-getrennte Exponat-Keys (Token-Minting). **Secret**, nur
  via env/`.env`, nie ins Repo.
- `DATA_DIR` = Ort für `admin_key` (beim ersten Start generiert, persistent).

**Alternative: Docker Compose** (`deploy/docker-compose.yml`, optional mit
Traefik für eine eigene Domain, `--profile edge`) - Secrets kommen dort aus
einer `.env`-Datei, NIE aus der committeten Compose-Datei:

```bash
cp deploy/.env.example deploy/.env   # einmalig, danach API_KEYS/ADMIN_KEY ausfuellen
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up
```
- Statics: erwartet ein zuvor gebautes `dist/`. Fehlt es, wird nur die
  Relay-Status-Page unter `/` ausgeliefert (Hinweis im Log).

---

## 3. Weg B — Vite-Dev/Preview + Relay im Hintergrund

```bash
scripts/relay-dev.sh start                  # Relay auf :8080 (Hintergrund, PID-Datei)
pnpm dev                                     # Vite auf :5173, proxyed /api+/ws -> :8080
```

- Im `ControlPanel` ist die Relay-URL per Default `location.origin` (die
  Vite-URL) → kein `:8080` eintragen, kein CORS.
- `scripts/relay-dev.sh {start|stop|restart|status}` — nutzt **kein `pkill`
  **(in dieser Sandbox nicht im PATH), sondern eine PID-Datei `.relay.pid`.
- Für `pnpm preview` (statt `dev`) genauso: Vite preview proxyed ebenfalls.

---

## 4. Fernsteuerung: Gast joint per Handy

1. Im Haupttool das `ControlPanel` öffnen (Einstellungen oben rechts bei
   Mausnähe) → ganz unten **„Fernsteuerung (Handy via QR)"**.
2. Relay-URL = die Exponat-Origin (Default bei Weg B = Vite-URL; bei Weg A =
   die `PORT`-URL). API-Key = wie oben gestartet. Optional PIN + Seats.
3. **„Sitzung starten"** → es mintet ein Token und zeigt **QR-Code + PIN**
   auf dem Exponat-Bildschirm.
4. Gast scannt den QR (oder öffnet den kopierbaren Gast-Link) → öffnet
   `remote-control.html?ws=…&token=…&pin=…` auf dem Handy → verbindet sich
   als Gast. Steuerung wirkt live auf das Exponat (Bidirektional: Gast →
   Exponat und umgekehrt).
5. **PIN rotieren** / **Beenden** im Panel (Beenden widerruft das Token).

Technik: `configStore`/`playbackStore` werden über den WebSocket-Relay
gesynct (BroadcastChannel bleibt als Same-Browser-Fast-Path erhalten).
Siehe `src/lib/connection.js` + `src/lib/syncedStore.js`.

---

## 5. Echtes Handy / Extern (Tailscale)

Für Besucher **außerhalb** des Exponat-PCs (echtes Handy) muss die Exponat-
URL vom Handy erreichbar sein. Empfohlen: **Tailscale** (kostenlos, bis 100
Devices):

- Exponat in Tailscale einhängen → Magic-DNS-Name `<host>.<tailnet>.ts.net`.
- Weg A oder B auf diesem Hostnamen betreiben (Vite `server.host:true` /
  `server/index.js` bindet ohnehin an alle Interfaces).
- Das Handy (in dasselbe Tailnet oder via `tailscale funnel`) erreicht
  `http://<host>.<tailnet>.ts.net:<port>` → lädt Oberfläche + joint Relay.
- **Verschlüsselung (production-nahe):** `tailscale cert <host>` schreibt
  `.crt`/`.key`; Relay via `TLS_CERT`/`TLS_KEY` starten → `https`+`wss://`.
   Siehe `scripts/setup-tailscale.sh`.

> CORS ist auch hier kein Thema, solange Oberfläche und Relay **denselben**
> Tailnet-Hostnamen/Port teilen (ein Origin).

---

## 6. Admin-UI / Status

- Status-Page: `GET /` (HTML) bzw. `GET /health` (JSON).
- Admin-UI: `GET /admin` (Admin-Key nötig, wird beim ersten Start auf die
  Console gedruckt und in `DATA_DIR/admin_key` persistent gespeichert). Per
  `?k=<ADMIN_KEY>` oder Prompt.

---

## 7. Tests / Verifikation

```bash
pnpm test                          # Unit (node --test) + vitest (Svelte) - lokal
pnpm check                         # Gate: svelte-check && eslint && knip && prettier

node tests/relay/test-api.mjs         # REST: Minting, PIN, Verify, Revoke, Admin, CORS, Rate-Limit
node tests/relay/test-connection.mjs  # WS: Host/Guest-Join, Relay, Presence, Seats, PIN-Backoff
node tests/relay/test-sqrt2-sync.mjs  # E2E: sqrt2-Store-Sync durch den echten Relay
```

Protokoll-Detail (welche Felder/Fehlercodes/Backoff-Regeln getestet werden):
siehe `docs/CONNECTION_SERVICE_SPEC.md` §5 (REST API) + §6 (WebSocket).

---

## 8. Bekannte Einschränkungen / Nicht-Ziel

- Kein Persistenter Token-Store (RAM-only, wie KoalaSync) — bei Neustart
  sind alle Tokens weg (Gäste müssen neu joinen). Bewusst einfach.
- Kein Redis-Adapter / keine Horizontal-Skalierung (vorerst nicht benötigt).
- Playwright-E2E über ein echtes Handy ist in der Sandbox nicht lauffähig
  (kein Browser/visuelle Verifikation); der Relay ist über die obigen
  Node-Tests abgedeckt.
