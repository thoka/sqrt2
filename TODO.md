# TODO — √2-Exponat

Offene Punkte, nach Relevanz sortiert. Erledigtes wird durchgestrichen
(`~~`). Jede Stufe bekommt eigene Tests (Unit und/oder e2e) — siehe
`AGENTS.md` ("Tests für alle Stufen"). Vor Commit: `pnpm format` + `pnpm check`.

## Skalierung
- [x] Weiße Quadrate am Anfang müssen exakt gleich groß sein und vertikal gleich ausgerichtet sein.
- [x] Test dafür erstellen (`tests/unit/zoom-start-equal.test.js`)

## Flug-Animation
- [ ] Die Flug-Animation soll ab einer bestimmten Geschwindigkeit ausgeschaltet werden.
- [ ] Diese Geschwindigkeit (Vorgabe 3) soll einstellbar sein in den Animations-Optionen.
- [ ] Kein Recompile bei Ändeerungen.

## Tastensteuerung

- [ ] Space: start / stop
- [ ] left: tick zurück
- [ ] right: tick vorwärts
- [ ] pg-up: schale vorwärts
- [ ] pg-down: schale zurück

## Intro-Screen
- [ ] Anzeige eines Intro-Screens für kurze Zeit beim Start. Ausschalten bei Play.
- [ ] Hinweis auf Einstellungen oben rechts

## Fernsteuerung / Connection (Nachpflege)

- [ ] **`RemoteControl` als Route foldbar** machen (im Exponat ein-/ausklappbar,
      nicht nur separater Tab) — UX für „Gast-Steuerung direkt am Exponat".
- [ ] **Rate-Limit-Test** für Token-Minting (massenhaft `POST /api/token`)
      existiert als Server-Test (`test-api.mjs`); als E2E-Doku in
      `DEPLOYMENT.md` verlinken.
- [ ] **Tailscale/TLS-Setup** für echtes Handy dokumentieren + scripten
      (`infra/connection-service/setup-tailscale.sh`, `tailscale cert` →
      `TLS_CERT`/`TLS_KEY`). Aktuell nur §5 in DEPLOYMENT.md beschrieben.
- [ ] **Exponat-Key-Management**: wie kommt `API_KEYS` sicher aufs Gerät?
      (`.env`-Vorlage, kein Commit) — `infra/connection-service/.env.example`.
- [ ] **Relay-Status im Exponat** sichtbar machen (Gast-Zahl Live, Verbindungs-
      State) — aktuell nur in `RemoteControl` (`#relayStatus`).

## CODE-QUALITÄT / REFACTOR

- [ ] **`selection_strategy_prototype.html`** — in `src/` / `docs/` ordnen,
      da kein Haupt-Tool mehr.

## DOKUMENTATION

- [ ] **`docs/DEPLOYMENT.md`** als zentrale Betriebs-Anleitung — erstellt,
      aber noch mit README/TOOLING-SPEC cross-verlinken.
- [ ] **`docs/TOOLING_SPEC.md`** Phase 8 (embedded Relay) + Phase 6-Status
      konsistent halten.
- [ ] **`docs/CONNECTION_SERVICE_SPEC.md`** §10/§12 mit DEPLOYMENT.md verknüpfen.
- [ ] **README §10 „Zukünftige Vision"** aktualisieren: Mehrbildschirm/QR als
      erledigt markieren, Phase 6 als offen.

## NICHT ZWINGEND (später)

- [ ] **Admin-konfigurierbare Steuerungs-Komplexität** (welche Regler sichtbar)
      — baut auf Store-Architektur auf.
- [ ] **Persistente Token-Store** (RAM-only bewusst einfach) — nur bei Bedarf.
