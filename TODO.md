# TODO — √2-Exponat

Offene Punkte, nach Relevanz sortiert. Erledigtes wird durchgestrichen
(`~~`). Jede Stufe bekommt eigene Tests (Unit und/oder e2e) — siehe
`AGENTS.md` ("Tests für alle Stufen"). Vor Commit: `pnpm format` + `pnpm check`.

## Einstellungen aufräumen
- [x] Geschwindigkeit: wird im Config-Tab nicht gebraucht. 
- [x] Den Bereich, der die Einstellungen öffnet auf die ganze Höhe des Hauptfenster ausrichten. Breite: 153 px vom rechten Rand
- [x] Pieces drehen: einzeilig und in den Animations-Tab verschieben
- [x] Fliegende Transparenz: in den Animations-Tab verschieben
- [x] "Zoom" unter "Auto-Zoom"
- [x] "Kompaktierung" gibt es nicht mehr

## Remote-Steuerung
 - [x] Zeitregler volle Breite
 - [x] Geschwindigkeitsregeler soll direkt über der Zeit  sichbar sein.
 - [x] Buttons für alle Tastatureingaben (außer "?" vorhehen)
 
## Steuerung
- [x] Solange ein slider bewegt wird, soll das verlassen des parents nicht den Dialog schhließen. Das passiert zuerzeit in den Einstellungen.

# Darstellung
- [x] einen Konfigurationsoption "Beschriftung an/aus" in den Basiseinstellungen und im Remote einbauen
- [x] wenn diese eingeschaltet ist:
   - [x] über dem unteren Rand der einzelnen untersten Quadrate im Ziel  (1/basis)^exponent anzeigen , wenn die breite des Rechtecks dazu ausreicht
   - [x] neben dem linken Rand der einlenen linkesten Quadrate im Ziel auch die Beschriftung anzeigen, jedoch ausgerechnet. D.h. im Fall von Basis = 2  1 (weises Grundquadrat); 1/2;  1/4; 1/8 etc
  Wichtig: nicht mathjax nutzen. ist zu langsam

## Sync-Isolierung via Pin (BroadcastChannel) — optional
- [ ] Pin als Teil des `BroadcastChannel`-Namens (`sqrt2-state-<pin>`): Tabs mit
      gleichem Pin teilen einen Kanal, ungleiche/no-Pin sind isoliert.
- [ ] Pin-Eingabe im ControlPanel/Settings + als URL-Parameter (`?pin=1234`)
      zum Teilen vorkonfigurierter Links (analog zu urlState.js).
- [ ] Pin-Wechsel zur Laufzeit: Channel neu aufmachen, wenn sich der Pin
      ändert (bestehender Listener schließen + neuer öffnen).
- [ ] (Nett, aber NICHT zwingend für Virtual-Canvas — dort identifiziert
      jedes Fenster sich über eine eigene zufällige ID, siehe unten.)

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

## Flug-Animation
- [x] Die Flug-Animation soll ab einer bestimmten Geschwindigkeit ausgeschaltet werden.
- [x] Diese Geschwindigkeit (Vorgabe 3) soll einstellbar sein in den Animations-Optionen.
- [x] Kein Recompile bei Ändeerungen.

## Tastensteuerung

- [x] Space: start / stop
- [x] left: tick zurück
- [x] right: tick vorwärts
- [x] pg-up: schale vorwärts
- [x] pg-down: schale zurück
- [x] Return: Richtungswechsel
- [x] +: schneller (Faktor `SPEED_STEP`, Default 1.3)
- [x] -: langsamer (Faktor 1/SPEED_STEP)
- [x] ?: Hilfe-Overlay

## Intro-Screen
- [x] Anzeige eines Intro-Screens für kurze Zeit beim Start. Ausschalten bei Play.
- [x] Hinweis auf Einstellungen oben rechts

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

- [x] **`selection_strategy_prototype.html`** — in `src/` / `docs/` ordnen,
      da kein Haupt-Tool mehr. (Bereits in einer früheren Aufräum-Runde
      entfernt, siehe Commit "Legacy-Prototypen ... entfernt" - Datei
      existiert nicht mehr im Repo.)

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
