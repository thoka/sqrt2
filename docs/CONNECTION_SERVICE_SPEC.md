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

> Status: Konzept + lauffähiges Fundament (`infra/connection-service/`).
> Server-Logik ist minimal, aber real (Token-Minting, Seat-Limit, PIN,
> Broadcast). Produktions-Härtung (Persistenz, Redis-Adapter, Rate-Limit)
> ist als Nächstes markiert.

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
{ "type":"error", "code":"bad_token|expired|pin_mismatch|seats_exhausted" }
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

Siehe `infra/connection-service/docker-compose.yml`. Zwei Wege:

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
- **Produktionsnah auf dem Tailnet:** `tailscale serve --https=8080` (oder
  `tailscale cert` + eigener TLS) liefert TLS für `*.ts.net`, damit auch
  `wss://` klappt. Der Transport ist ohnehin E2E-WireGuard-verschlüsselt.
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

## 8. Sicherheit

- `ws://` nur auf localhost **oder innerhalb des Tailnets**; für echte
  öffentliche Domains **zwingend `wss://`**. Grund: Browser erlauben keine
  ungesicherten WS auf HTTPS-Seiten (Mixed-Content). Auf dem Tailnet reicht
  `ws://`, weil (a) die Seite selbst über HTTP serviert werden kann und
  (b) der WireGuard-Transport ohnehin E2E-verschlüsselt ist.
- `API_KEY` und `ADMIN_KEY` sind Secrets → nur via env/Volume, nie im Image.
- Brute-Force-Schutz (später): Token-Rate-Limit, kurze `ttlSec`-Defaults,
  exponentielles Backoff bei falscher PIN.
- Seat-Limit verhindert Ressourcen-Erschöpfung durch einen Code.
- PIN verhindert "Mitfahren" mit abgelaufenen Codes.
- CORS nur für bekannte Exponat-Origins.

---

## 9. Wiederverwendbarkeit

Der Dienst kennt **keine** Exponat-Logik. Wiederverwendung durch:
- generische `app`-Nachrichten (jedes Exponat definiert sein eigenes
  Payload-Schema, z.B. sqrt2: `configStore`/`playbackStore`-Deltas).
- mehrere Exponate = mehrere `API_KEYS`; jedes mintet eigene Tokens.
- dieselbe Instanz kann parallel Filme-Sync, Spiele, Steuerung bedienen —
  getrennt nur durch unterschiedliche Tokens/Räume.

Empfehlung: Service in **eigenes Repo** auslagern (z.B. `exhibit-relay`),
sqrt2 bindet ihn via Compose/URL ein. Hier vorerst unter
`infra/connection-service/` zur Konzept-Phase.

---

## 10. Vergleich mit existierenden Lösungen (Recherche)

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

## 11. Nächste Schritte

1. Server-Logik vervollständigen (Persistenz optional, Rate-Limit, CORS).
2. sqrt2 anbinden: `configStore`/`playbackStore` über WS relayen
   (BroadcastChannel als Same-Browser-Fast-Path beibehalten).
3. QR-Code auf dem Exponat + PIN-Anzeige im ControlPanel.
4. Testen über Tailnet (`<host>.<tailnet>.ts.net:8080` bzw. Vite-Port);
   Traefik-Stack nur bei eigener Domain via `--profile edge`. `ADMIN_KEY`
   beim ersten Start aus der Console erfassen.
5. (Optional) Redis-Adapter für Horizontal-Skalierung.
