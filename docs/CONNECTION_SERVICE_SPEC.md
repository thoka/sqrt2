# Connection Service — Spec (Entwurf)

Generischer Echtzeit-Relay-Dienst für Exponate: ein Exponat (trusted
Device) meldet sich mit einem **API-Key** an, erzeugt daraus **Verbindungs-
Tokens**, die es (z.B. per QR-Code) an Besucher-Geräte weiter gibt. Ein Token
öffnet einen **Raum** mit einer begrenzten Anzahl **Seats** (gleichzeitige
Besucher) und optional einem **PIN**, den das Exponat anzeigt, damit alte
Codes nicht mehr funktionieren.

Der Dienst ist bewusst **exponat-agnostisch** (kein sqrt2-Wissen): er relayed
generic JSON-Nachrichten zwischen den Mitgliedern eines Raums. Damit ist er
für andere Exponate (Spiele, synchronisierte Filme, gemeinsame Steuerung)
wiederverwendbar.

> Status: Konzept + lauffähiges Fundament (Relay in `server/relay/`, embedded im Exponat-Server `server/index.js`).
> Server-Logik ist real (Token-Minting, Seat-Limit, PIN, Broadcast, TLS) und
> um Status-Page (`/`), CORS (`ALLOWED_ORIGINS` + Preflight), eine
> admin-geschützte Admin-UI (`/admin`, nutzt die REST-API) sowie
> Brute-Force-Härtung (Token-Rate-Limit + exponentielles PIN-Backoff)
> ergänzt. Offen (optional/später): Persistenz, Redis-Adapter, Seat-Freigabe
> in der Admin-UI (§8).

---

## 1. Anforderungen

| # | Anforderung | Bemerkung |
|---|-------------|-----------|
| F1 | Exponat authentifiziert sich mit **API-Key** am Service | Trusted Device, darf Tokens erzeugen |
| F2 | Exponat erzeugt **Join-Tokens** (opak, random) | wird an Besucher weitergegeben (QR) |
| F3 | Token hat **max. Seats** (gleichzeitige Besucher) | Raum wird bei Erreichen des Limits geschlossen |
| F4 | Token kann optional einen **PIN** tragen | Exponat zeigt PIN an; Gäste müssen ihn beim Join liefern |
| F5 | PIN-Rotation / Token-Revoke möglich | verhindert Join mit altem Code |
| F6 | Admin-Key wird beim **ersten Start auf der Console** ausgegeben | für Verwaltung (Tokens auflisten/revoken) |
| F7 | Generisch / mehrfach nutzbar | kein Exponat-spezifisches Wissen im Dienst |
| F8 | Docker Compose + Traefik-Labels | Deployment hinter Reverse-Proxy mit TLS |

Nicht-Ziel (vorerst): dauerhafte Persistenz von Raumzustand, Ende-zu-Ende-
Verschlüsselung, Account-System für Besucher.

---

## 2. Architektur (Überblick)

```
            ┌─────────────── Exponat (Host) ───────────────┐
            │  sqrt2 Haupttool                              │
            │  - POST /api/token (Bearer API_KEY)          │
            │  - WS /ws?token=T&role=host  ──────────┐      │
            │  - zeigt QR + PIN auf dem Bildschirm   │      │
            └────────────────────────────────────────┼──────┘
                                                      │
   Besucher-Handy ── QR ─► WS /ws?token=T&pin=P ──────┤   CONNECTION SERVICE
                                                      │   (relay)
            ┌────────────────────────────────────────┼──────┐
            │  REST (Admin/API)  +  WebSocket-Relay   │      │
            │  - Token-Store (RAM, seats, pin, ttl)   │      │
            │  - Rooms: broadcast JSON an Mitglieder  │      │
            │  - Admin (Bearer ADMIN_KEY)             │      │
            └────────────────────────────────────────┼──────┘
                                                      │
            Traefik (TLS, Routing, Labels) ◄──────────┘
```

Der Relay ist **dumm**: er versteht nur `joined` / `presence` / `app` /
`error` und forwarded `app`-Nachrichten an alle Raum-Mitglieder. Die
Anwendungssemantik (configStore/playbackStore-Sync bei sqrt2) liegt
vollständig bei den Clients — identisch zur heutigen BroadcastChannel-Logik,
nur netzwerkstatt browser-lokal.

---

## 3. Zwei-stufige Authentifizierung

### Stufe 1 — Exponat → Service (API-Key)
- Exponat besitzt einen geheimen `API_KEY` (env `API_KEYS`, komma-getrennt,
  damit mehrere Exponate eigene Keys haben).
- `API_KEY` wird **nie** an Besucher weitergegeben.
- Schützt das Token-Minting (`POST /api/token`).

### Stufe 2 — Besucher → Raum (Join-Token + PIN)
- Exponat mintet ein Token `T` (opak, mind. 24 Byte entropy, base64url).
- Token ist an einen Raum gebunden mit Metadaten:
  `{ seats, pin?, createdAt, expiresAt, label? }`.
- Besucher joint mit `WS /ws?token=T[&pin=P]`.
  - `pin` nur nötig, wenn Token `pin` gesetzt hat.
  - Exponat joint als `role=host` (weiß PIN, zählt nicht gegen `seats`).
- **Seat-Limit**: Anzahl gleichzeitiger `guest`-Verbindungen ≤ `seats`.
  Bei Überschreitung → `{type:'error', code:'seats_exhausted'}`, Close.

### PIN (F4/F5)
- Exponat zeigt PIN auf dem Bildschirm (z.B. 4–6 Ziffern).
- Gäste müssen PIN beim Join liefern → kein Join mit abgelaufenem/altem
  Code, wenn Exponat PIN rotiert (z.B. pro Session neu via
  `POST /api/token` mit neuem `pin` oder `PATCH /api/token/:t/pin`).
- Rotation macht alte QR-Codes wertlos, ohne das laufende Exponat
  unterbrechen zu müssen (neues Token, altes revoken).

---

## 4. Datenmodell (Server-RAM)

```
Token  = { id, seats, pin|null, createdAt, expiresAt|null, label?, hostConnId|null }
Room   = { tokenId, members: Map<connId, {role, pinOk}>, createdAt }
Conn   = WebSocket + { tokenId, role, remote }
```

- Token-Store: `Map<tokenId, Token>`. Raum entsteht lazy beim ersten Join.
- Seats = maximale **Guest**-Verbindungen (Host exklusiv).
- Optional (später): Persistenz in SQLite/Redis, damit Tokens über
  Neustart überleben.

---

## 5. REST API

Alle Antworten `application/json`. Fehler: `{ error, code, message }`.

### Exponat-Endpunkte (Bearer `API_KEY`)
```
POST /api/token
  body: { seats?=4, pin?=null, ttlSec?=3600, label?=null }
  -> 201 { token, wsUrl, seats, pin, expiresAt }

POST /api/token/verify
  body: { token }
  -> 200 { valid, seats, occupied, expiresAt }

PATCH /api/token/:token/pin        # PIN rotieren (Host)
  body: { pin }
  -> 200 { ok:true }

DELETE /api/token/:token           # Token widerrufen
  -> 200 { ok:true }
```

### Admin-Endpunkte (Bearer `ADMIN_KEY`)
```
GET  /admin/tokens                 # Liste mit Belegung
DELETE /admin/token/:token         # Revoke
GET  /admin/health                 # Status + Anzahl Räume
```

### Öffentlich
```
GET /health                        # 200 {ok:true, version}
```

---

## 6. WebSocket-Protokoll

Verbindung: `ws(s)://<host>/ws?token=T&role=host|guest&pin=P`

Server → Client (nach erfolgreichem Join):
```
{ "type":"joined", "role":"host|guest", "seats":N, "occupied":M }
{ "type":"presence", "event":"join|leave", "role":..., "occupied":M }
{ "type":"app", "from":"<connId|host>", "payload":<bel. JSON> }
{ "type":"error", "code":"bad_token|expired|pin_mismatch|pin_locked|seats_exhausted" }
```

Client → Server:
```
{ "type":"app", "payload":<bel. JSON> }   # wird an alle Raum-Mitglieder gebroadcastet
```

- Heartbeat: Server pingt periodisch; bei 2 verpassten pongs → disconnect.
- Auf Disconnect: Member entfernen, `presence`-Broadcast.
- Host-Wegfall: Raum bleibt bestehen, Gäste können weiterspielen; neues
  Exponat kann als `host` rejoinen (sofern `hostConnId` frei).

---

## 7. Deployment

Siehe `docker-compose.yml`. Zwei Wege:

### Variante A — Tailscale (empfohlen für Test & Intern)

Tailscale ist im persönlichen Gebrauch **kostenlos** (bis 100 Devices) und
bei uns bereits im Einsatz. Jedes Device bekommt eine Tailnet-IP (100.x.x.x)
und einen Magic-DNS-Namen `<host>.<tailnet>.ts.net`. Der Relay (und der
Vite-Server) ist damit **ohne öffentliche DNS/TLS** direkt vom Handy
erreichbar:

- **Test (einfachste Variante):** Relay mit `ports: 8080:8080` auf dem Host
  publizieren. Handy lädt `http://<host>.<tailnet>.ts.net:8080/...`.
  Da die Seite selbst über HTTP serviert wird, ist `ws://` erlaubt
  (Mixed-Content blockiert erst bei HTTPS-Seiten). Kein Traefik/Let's Encrypt.
- **TLS im Prototyp (empfohlen):** `tailscale cert <host>.<tailnet>.ts.net`
  schreibt `*.crt`/`.key` (PEM). Diese als `TLS_CERT`/`TLS_KEY` (env) an den
  Relay mounten → der Dienst startet **https + wss://** (siehe Server-Log
  `https/wss`). Damit ist bereits production-nahe Verschlüsselung aktiv,
  ohne eigenen Reverse-Proxy. `tailscale serve --https=8080` macht das
  equivalent auf Proxy-Ebene.
- **Öffentlich (externe Besucher ohne Tailscale):** `tailscale funnel 8080`
  veröffentlicht den Port mit Tailscale-TLS — kein eigener Reverse-Proxy nötig.

Traefik ist damit **optional** (nur bei eigenem Domain-Stack); der
`traefik`-Service im Compose trägt `profiles: ["edge"]` und startet nur mit
`docker compose --profile edge up`.

### Variante B — Traefik / eigene Domain

- **Admin-Key auf Console**: Beim ersten Start generiert der Entrypoint
  `ADMIN_KEY` (32 Byte hex), schreibt ihn nach `/data/admin_key` (Volume)
  und **printet ihn auf stdout**. Danach persistent.
- **API-Key**: via env (`API_KEYS`) — vom Betreiber vorgegeben, NICHT
  automatisch generiert (Geheimnis des Exponats).
- **Traefik-Labels** am `relay`-Service: Host-Routing, TLS (Let's Encrypt
  via `certResolver`), Port-Export `8080`. Admin-Route per
  BasicAuth-Middleware abgesichert.
- **Volumes**: `relay-data:/data` (admin_key + optional Token-DB).
- **Skalierung (später)**: Redis-Adapter für mehrere Relay-Instanzen.

---

## 8. Status-Page & Admin-UI (Svelte)

### Status-Page (http/https)
Bei Browser-Zugriff auf `/` (GET, nicht-API) liefert der Dienst eine
**einfache HTML-Statusseite** — sowohl über `http://` als auch `https://`
(der Relay unterstützt beide Transporte). Inhalt (Kurzform, auto-refresh
optional):
- Dienstname, Version, Uptime, Transport-Modus (`http/ws` bzw. `https/wss`).
- Aktive Räume, belegte/verfügbare Seats gesamt, Verbindungszahl.
- Link zur Admin-UI (nur mit Admin-Berechtigung erreichbar).
Die maschinenlesbare Variante bleibt `/health` (JSON, siehe §5).

### Admin-Web-UI (Svelte)
Eine schlanke Admin-Oberfläche, **mit Svelte gebaut** (Stack-Konsistenz zu
sqrt2, kein weiteres Framework), erreichbar unter `/admin`. Absicherung wie
in §7 (Traefik BasicAuth bzw. `ADMIN_KEY`). Der **Funktionsumfang ist noch
offen** — zur Diskussion stehen:
- **Seat-Freigabe:** Max-Seats eines Tokens über die standarmäßig
  konfigurierten Limits (`MAX_SEATS_DEFAULT`) hinaus freigeben/erhöhen,
  falls ein Exponat kurzfristig mehr Besucher aufnehmen soll.
- **Stats:** aktive Räume, belegte Seats, Verbindungszahlen, Nachrichten-
  Durchsatz, Uptime-Verlauf.
- **Debug-View:** Live-Presence pro Raum, Token-Liste (Pin/Expiry/Belegung),
  optional Roh-Nachrichten-Inspektion einzelner Räume.

Die UI nutzt ausschließlich die bestehende REST-API (§5) — kein neuer
Backend-Code nötig, solange die Admin-Endpunkte die benötigten Daten
liefern (aktuell: `GET /admin/tokens`). Fehlende Stats/Debug-Daten sind
als Erweiterung der Admin-API zu spezifizieren (Stufe: eigenes Ticket).

---

## 9. Sicherheit

- `ws://` nur auf localhost **oder innerhalb des Tailnets**; für echte
  öffentliche Domains **zwingend `wss://`**. Grund: Browser erlauben keine
  ungesicherten WS auf HTTPS-Seiten (Mixed-Content). Auf dem Tailnet reicht
  `ws://`, weil (a) die Seite selbst über HTTP serviert werden kann und
  (b) der WireGuard-Transport ohnehin E2E-verschlüsselt ist.
- `API_KEY` und `ADMIN_KEY` sind Secrets → nur via env/Volume, nie im Image.
- Brute-Force-Schutz: **Token-Rate-Limit** pro API-Key beim Minting
  (`RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS`, → `429` + `Retry-After`) sowie
  **exponentielles Backoff bei falscher PIN** je Token (`PIN_BACKOFF_GRACE`/
  `PIN_BACKOFF_BASE_MS`/`PIN_BACKOFF_MAX_MS`): nach `grace` Fehlversuchen
  wächst die Join-Sperre als `base·2^(n-grace)`, gedeckelt auf `maxMs`;
  erfolgreicher Join setzt den Zähler zurück. Fehlercode `pin_locked`.
- Seat-Limit verhindert Ressourcen-Erschöpfung durch einen Code.
- PIN verhindert "Mitfahren" mit abgelaufenen Codes.
- CORS nur für bekannte Exponat-Origins.

---

## 10. Betriebsmodell: EIN Server pro Exponat (embedded Relay)

Ursprünglich war der Relay als **eigener, zentraler Dienst** für mehrere
Exponate/Apps geplant (Multi-Tenant). Für den realen Einsatz — ein Exponat
(oder wenige), deren Oberfläche vom **selben** Server kommt — ist das
überflüssig: zwei Prozesse/Origins bringen nur CORS- und Config-Aufwand,
keinen Nutzen (Traffic ist minimal).

**Entscheidung:** der Relay ist eine **Bibliothek** (`createRelay()` in
`server.js`), die **embedded** im Exponat-Server läuft:

- `server/index.js` (Produktion): ein Node-Prozess serviert `dist/`
  (Statics) **und** den Relay unter `/api` + `/ws` — **ein Origin, kein
  CORS, kein zweiter Prozess**.
- Vite-Dev/Preview (Entwicklung): Vite proxyed `/api` + `/ws` auf einen
  Relay-Hintergrundprozess (`scripts/relay-dev.sh`) → ebenfalls ein Origin.

`server.js` bleibt als **standalone-Entry** erhaltbar (eigener Port), falls
jemand den Relay doch separat betreiben will — das ist aber nicht der
Empfehlungspfad.

Wiederverwendbarkeit entsteht trotzdem: `createRelay()` ist exponat-agnostisch
(generische `app`-Nachrichten, mehrere `API_KEYS`); es wird nur **nicht**
mehr als separater Multi-Tenant-Dienst betrieben, sondern pro Exponat
eingebettet.

---

## 11. Vergleich mit existierenden Lösungen (Recherche)

| Lösung | Typ | Passend? | Anmerkung |
|--------|-----|----------|-----------|
| **Syncplay** | Watch-Party (mpv/VLC) | Teilweise | Server-Passwort + Raum-Isolation + `salt` für managed Room-Passwords → beweist "1 Secret → viele Room-Keys". Medien-spezifisch, kein generisches JSON-Relay. |
| **KoalaSync** | Watch-Party Relay | Nah | MIT, Node+Socket.IO, **RAM-based**, `SERVER_SALT`, Room-Credentials via Link, Brute-Force-Schutz, **zero persistence**. Sehr nah, aber Video-Sync-opinionated. |
| **room-kit** | Socket.IO Room-Primitive | Nah (Pattern) | `joinRequest.roomKey` + `admit`-Gate + `serverState` = exakt unser Token-Admission-Modell, typed. Bibliothek, kein fertiger Dienst. |
| **Socket.IO Rooms / Colyseus / Rivalis** | Room+Seats+Presence | Ja (Baustein) | Erweist "Room + Seats + Presence + Broadcast" als Standardprimitive. |
| **Matrix** | Generic Realtime + E2E | Overkill | Hat **Registration-Tokens mit max. Nutzungen** (= unsere Seats) + Admin + E2E. Zu schwer für LAN-Exponat, aber das Seat/Token-Konzept ist dort erprobt. |
| **PartyKit / partyserver** | Edge Realtime (Cloudflare) | Hosted/PAAS | 1M Downloads, aber Cloudflare-gebunden (kein eigener Docker-Compose-Selfhost im Sinne der Spec). |
| **ntfy** | Pub/Sub | Nein | Tokens + Selfhost + Traefik, aber fire-and-forget Pub/Sub, kein State-Sync/Presence. |

**Entscheidung:** Eigenbau eines schlanken Relays (Node + `ws`), angelehnt an
KoalaSync (RAM, Salt, zero persistence) und room-kit (Token-Admission),
aber exponat-agnostisch und mit der geforderten Zwei-Stufen-Auth
(API-Key → Token+Seats+PIN).

---

## 12. Nächste Schritte

1. Server-Logik vervollständigen (Persistenz optional, Rate-Limit, CORS) — **erledigt**.
2. **Entwicklungs-Sandbox bekommt eine eigene Tailscale-IP** (eigenes
   Tailnet-Device / eigener Hostname), damit Prototyp-Tests vom Handy aus
   ohne lokale Netzwerk-Sonderkonfiguration laufen.
3. sqrt2 anbinden: `configStore`/`playbackStore` über WS relayen
   (BroadcastChannel als Same-Browser-Fast-Path beibehalten) — **erledigt**
   (`src/lib/connection.js` + `initNetworkSync()` in `src/lib/syncedStore.js`,
   beide Transporte über dieselbe Store-Schnittstelle, TOOLING_SPEC Phase 8).
4. QR-Code auf dem Exponat + PIN-Anzeige im ControlPanel — **erledigt**
   (`ControlPanel.svelte`: Sitzung starten → Token minten → QR (`qrcode`) +
   PIN; `RemoteControl.svelte` joint per WS, wenn der QR-Link `ws`/`token`/
   `pin` trägt).
5. **Betriebsmodell vereinfacht (ein Server):** Relay als Bibliothek
   `createRelay()` (kein eigenes `listen()` mehr), embedded in
   `server/index.js` (Statics + Relay, ein Origin, kein CORS) sowie als
   Vite-Proxy-Ziel (`scripts/relay-dev.sh`) für Dev/Preview. `server.js`
   bleibt optional als standalone-Entry. — **erledigt**.
6. Testen über Tailnet (`<host>.<tailnet>.ts.net` bzw. Vite-Port, mit
   `tailscale cert`→TLS); Traefik-Stack nur bei eigener Domain via
   `--profile edge`. `ADMIN_KEY` beim ersten Start aus der Console erfassen.
7. (Optional, vorerst nicht benötigt) Redis-Adapter für Horizontal-Skalierung.
7. **Status-Page** (`/` als HTML über http/https) + **Admin-UI** unter
   `/admin` — **erledigt** (§8): Status-Page liefert Dienstname, Version,
   Uptime, Transport-Modus, Räume/Seats/Verbindungen; Admin-UI (dependency-
   freies HTML, nutzt ausschließlich die Admin-REST-API §5) mit Token-Liste,
   Belegung, PIN-Kennzeichnung und Revoke-Aktion. Svelte-Variante optional
   möglich; Funktionsumfang Seat-Freigabe/Stats/Debug-View (§8) bei Bedarf
   über die Admin-API erweiterbar.

> **Tests:** Jede Stufe (Token-Minting, Seat-Limit, PIN/Rotation, Host/Guest,
> CORS, Rate-Limit) ist durch `tests/relay/test-api.mjs`
> (REST) und `tests/relay/test-connection.mjs` (WebSocket) abgedeckt. Neue Stufen
> erfordern neue Checks.
