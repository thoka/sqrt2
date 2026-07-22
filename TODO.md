# TODO — √2-Exponat

Offene Punkte, nach Relevanz sortiert. Erledigtes wird durchgestrichen
(`~~`). Jede Stufe bekommt eigene Tests (Unit und/oder e2e) — siehe
`AGENTS.md` ("Tests für alle Stufen"). Vor Commit: `pnpm format` + `pnpm check`.



## Steuerung
- [x] neue Umschaltung über Zustände zum Default machen (`configStore.edgeZoomControlMode` jetzt `true` als Default - klassische Regler bleiben über die Admin-Checkbox erreichbar, siehe docs/Alternative Zoom-Steuerung,md)
- [x] Beschleunigung wesentlich erhöhen. Geschwindigkeit kann gerne gefühlt instantan erreicht werden. Dann ist ersichtlicher, wenn der neue Modus erreicht wurde. (Default von "Zustands-Übergang: Dauer" von 1,0s auf 0,2s reduziert - Übergänge bleiben dank des geschwindigkeitsstetigen Feder-Treibers weiterhin ohne "Blitze", auch bei schnellem Umschalten)

## Intro-Screen
- [x] Anzeige eines Intro-Screens für kurze Zeit beim Start. Ausschalten bei Play.
- [x] Hinweis auf Einstellungen oben rechts
- [ ] Hinweise auf die Einstellungen viel größer. Ist momentan sehr dezent.

## Virtual Canvas / Multi-Viewport (Mehrbildschirm-Exponat)
Konzept: ein gemeinsamer VIRTUELLER Canvas-Koordinatenraum, zusammengesetzt
aus vielen Fenstern/Beamern/Laptops. Jedes Fenster zeichnet nur SEINEN
Ausschnitt (inkl. Lücken dazwischen). Fliegende Teile bewegen sich
physikalisch über Fenstergrenzen hinweg (nahtlos, weil alle Fenster denselben
compiledStore + dieselbe playbackStore-Zeit haben und daher dieselbe
Welt-Position eines Stücks berechnen).

- [ ] **Fenster-ID**: jedes Tab bekommt eine eindeutige ZUFÄLLIGE ID (nicht
      vom User vergeben). Identifiziert das Fenster eindeutig im Verbund.
- [ ] **Layout-Map (geteilter Zustand)**: pro Fenster-ID seine Lage auf dem
      virtuellen Canvas: Position (x,y), Größe (w,h), optional Lücken.
      Liegt in einem geteilten Store (Sync / Connection-Service), damit jedes
      Fenster das Gesamt-Layout kennt.
- [ ] **Viewport-Transformation im Render-Pfad** (`renderFrame` /
      `TargetBankCanvas.svelte`): Welt-Koordinate -> Bildschirm =
      (Welt - FensterOffset) * Scale; Fenster zeichnet nur den Teil des
      virtuellen Canvas, der in seinen Ausschnitt fällt. KEINE zweite
      Kompilierung nötig (configStore/compiledStore sind durch Sync identisch).
- [ ] **Lücken**: Fenster dürfen Lücken im virtuellen Canvas lassen (nicht
      lückenlos aneinandergereiht) — die Transformation muss Offset + Scale
      pro Fenster unabhängig handhaben.
- [ ] **Konfiguration je Fenster**: in den Einstellungen auf dem virtuellen
      Canvas sagen, welches Fenster (ID) wo sitzt — nicht jeder Nutzer tippt
      Koordinaten, sondern verschiebt/platziert sein Fenster im Layout-Editor.
- [ ] **Cross-Device (später)**: derselbe Mechanismus über den Connection-
      Service (Relay/WebSocket) statt nur BroadcastChannel — jeder Laptop/
      Beamer ist ein Fenster mit ID + Layout-Position. Der Relay-Transport
      (schon gebaut) ist der einzige Unterschied zum Same-Browser-Fast-Path.
- [ ] **Voraussetzung**: Sync-Isolierung (Pin oder anderer Kanal-Filter),
      sonst steuern fremde Tabs im selben Browser den Verbund mit.
- [ ] Unit/E2E: zwei Fenster mit unterschiedlicher Viewport-Transformation
      rendern denselben Welt-Punkt an der korrekten, sich ergänzenden Stelle;
      ein fliegendes Stück überquert die Grenze ohne Sprung.

## Sync-Isolierung via Pin (BroadcastChannel) — optional
- [ ] Pin als Teil des `BroadcastChannel`-Namens (`sqrt2-state-<pin>`): Tabs mit
      gleichem Pin teilen einen Kanal, ungleiche/no-Pin sind isoliert.
- [ ] Pin-Eingabe im ControlPanel/Settings + als URL-Parameter (`?pin=1234`)
      zum Teilen vorkonfigurierter Links (analog zu urlState.js).
- [ ] Pin-Wechsel zur Laufzeit: Channel neu aufmachen, wenn sich der Pin
      ändert (bestehender Listener schließen + neuer öffnen).
- [ ] (Nett, aber NICHT zwingend für Virtual-Canvas — dort identifiziert
      jedes Fenster sich über eine eigene zufällige ID, siehe unten.)



## Fernsteuerung / Connection (Nachpflege)

- [ ] **`RemoteControl` als Route foldbar** machen (im Exponat ein-/ausklappbar,
      nicht nur separater Tab) — UX für „Gast-Steuerung direkt am Exponat".
- [x] **Rate-Limit-Test** für Token-Minting (massenhaft `POST /api/token`)
      existiert als Server-Test (`test-api.mjs`); als E2E-Doku in
      `DEPLOYMENT.md` verlinken. (§7 verlinkt jetzt `tests/relay/test-api.mjs`
      inkl. Rate-Limit-Hinweis - Pfad war zuvor veraltet/root-level.)
- [x] **Tailscale/TLS-Setup** für echtes Handy dokumentieren + scripten
      (`infra/connection-service/setup-tailscale.sh`, `tailscale cert` →
      `TLS_CERT`/`TLS_KEY`). Aktuell nur §5 in DEPLOYMENT.md beschrieben.
      (War bereits vollständig umgesetzt unter `scripts/setup-tailscale.sh`
      (config/check/reachable/https) + DEPLOYMENT.md §5 - nur der
      `infra/connection-service/`-Pfad im TODO-Text war veraltet/nie so
      angelegt. CONNECTION_SERVICE_SPEC.md §12 Punkt 6 jetzt als erledigt
      markiert + verlinkt.)
- [x] **Exponat-Key-Management**: wie kommt `API_KEYS` sicher aufs Gerät?
      (`.env`-Vorlage, kein Commit) — `infra/connection-service/.env.example`.
      (Vorlage liegt unter `deploy/.env.example` (passend zur tatsächlichen
      `deploy/docker-compose.yml`-Struktur, kein `infra/`-Verzeichnis im
      Repo); Compose liest `API_KEYS`/`ADMIN_KEY` jetzt per
      `--env-file deploy/.env` statt hartkodiert; `.gitignore` blockt
      `.env`/`deploy/.env`.)
- [x] **Relay-Status im Exponat** sichtbar machen (Gast-Zahl Live, Verbindungs-
      State) — aktuell nur in `RemoteControl` (`#relayStatus`). (War bereits
      erledigt: `ControlPanel.svelte` zeigt im Tab "Remote-Connect" - auch im
      Exponat selbst gemountet, nicht nur in `RemoteControl` - sowohl
      `Status: {connStatus}` als auch `Gäste verbunden: {guestCount}` live an,
      sobald eine Host-Sitzung läuft. Die TODO-Prämisse "aktuell nur in
      RemoteControl" war veraltet.)

## CODE-QUALITÄT / REFACTOR

- [x] **`selection_strategy_prototype.html`** — in `src/` / `docs/` ordnen,
      da kein Haupt-Tool mehr. (Bereits in einer früheren Aufräum-Runde
      entfernt, siehe Commit "Legacy-Prototypen ... entfernt" - Datei
      existiert nicht mehr im Repo.)

## DOKUMENTATION

- [x] **`docs/DEPLOYMENT.md`** als zentrale Betriebs-Anleitung — erstellt,
      aber noch mit README/TOOLING-SPEC cross-verlinken.
- [x] **`docs/TOOLING_SPEC.md`** Phase 8 (embedded Relay) + Phase 6-Status
      konsistent halten.
- [x] **`docs/CONNECTION_SERVICE_SPEC.md`** §10/§12 mit DEPLOYMENT.md verknüpfen.
- [x] **README §10 „Zukünftige Vision"** aktualisieren: Mehrbildschirm/QR als
      erledigt markieren, Phase 6 als offen. (War bereits erledigt markiert -
      nur Phase-6-Querverweis präzisiert.)

## NICHT ZWINGEND (später)

- [ ] **Admin-konfigurierbare Steuerungs-Komplexität** (welche Regler sichtbar)
      — baut auf Store-Architektur auf.
- [ ] **Persistente Token-Store** (RAM-only bewusst einfach) — nur bei Bedarf.
