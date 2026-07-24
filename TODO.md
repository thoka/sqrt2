# TODO — √2-Exponat

Offene Punkte, nach Relevanz sortiert. Erledigtes wird durchgestrichen
(`~~`). Jede Stufe bekommt eigene Tests (Unit und/oder e2e) — siehe
`AGENTS.md` ("Tests für alle Stufen"). Vor Commit: `pnpm format` + `pnpm check`.

## i18n
- [ ] Sprache über die Sprache des Browsers einstellbar machen

## Parameter
- [ ] Parameter-Übergabe per URL konfigurierbar machen über Checkboxes für unterschiedliche Kategorien.
- [ ] Die Zuordnung der Parameter zu den Checkboxes soll leicht im Code einstellbar sein.
- [ ] Grundzuordnung erfolgt über die Tabs, in denen die entsprechenden Controls sind.
- [ ] Controls im Haupbereich (auch implizite wie Geschwindigkeit und Play) gehören mit zu "Basis-Einstellungen"
- [ ] Eine Checkbox soll bei Aktivierung die Parameter auf "vom Default-Wert abweichend" eingrenzen.

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
- [ ] **`/admin`-Route**: alle Tabs, äquivalent zum Exponat-Overlay (neuer
      Vite-Entry analog `remote.html`, ohne Tab-Filter).

## Einstellungen / UI

- [ ] Hinweise auf die Einstellungen viel größer. Ist momentan sehr dezent.
- [ ] **`compiledStore.depth` Pitfall Test-Absicherung** — GOTCHA #2 in AGENTS.md:
      `compiledStore` hat KEIN `depth`-Feld, `configStore.depth` (Alias N_MAX)
      nutzen. Prüfen ob `RestCounterBars.test.js` / `RestCounterGrid.test.js`
      das als Testfall abdecken.
- [ ] **Neuberechnung asynchron und cancelbar** (bei Wertänderung) — eigener Plan
      mit Testkriterien: `docs/ASYNC-COMPILE-PLAN.md` (komplex, eigene Session).

## NICHT ZWINGEND (später)

- [ ] **Admin-konfigurierbare Steuerungs-Komplexität** (welche Regler sichtbar)
      — baut auf Store-Architektur auf.
- [ ] **Persistente Token-Store** (RAM-only bewusst einfach) — nur bei Bedarf.
