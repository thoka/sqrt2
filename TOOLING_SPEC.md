# Tooling-Umbau: Svelte + geteilter Zustand für austauschbare Widgets & Fernsteuerung

**Status:** Spezifikation, noch nicht begonnen. Ziel dieses Dokuments: genug Kontext, um den Umbau in einer neuen Sitzung effizient zu starten, ohne die Diskussion aus dem Gesprächsverlauf zu wiederholen.

## 1. Warum (Kontext aus dem Gespräch)

Zwei konkrete Wünsche haben denselben architektonischen Bedarf:

1. **Rest-Anzeige als austauschbare Widgets.** Die Bank/Rest-Visualisierung als Zähler soll unabhängig von den übrigen Einstellungen verfügbar sein, mit mehreren Darstellungs-Modi zum Ausprobieren: vertikale Anzeige aller Ziffern-Stellen als Balken (existiert schon als Teil von `updateHUD()`, aber fest verdrahtet), horizontale Anzeige als bis zu 4×4-Grid (abhängig von der Basis, noch nicht gebaut). Weitere Modi werden folgen ("Wir werden unterschiedliche Modi ausprobieren").
2. **Steuerung über ein zweites Fenster / einen separat verbundenen Browser.** Bereits in der README (Abschnitt 10, "Zukünftige Vision") als Wunsch notiert: Ziel/Rest/Steuerung auf getrennten Displays, später auch QR-Code-Fernsteuerung von einem Handy aus.

Beides braucht dieselbe Grundarchitektur: **Zustand von Darstellung trennen**, damit (a) mehrere Widget-Varianten denselben Zustand unterschiedlich rendern können und (b) mehrere Fenster/Geräte denselben Zustand teilen können. Das aktuelle `sqrt2.html` ist eine einzige Datei mit imperativer DOM-Manipulation (`getElementById`, manuelles `innerHTML`, direkt gemutierte `let`-Variablen im Modul-Scope) - das macht (a) und (b) beides mühsam.

**Frage im Gespräch:** Sollen wir dafür auf Svelte umsteigen? **Antwort: ja, empfohlen.** Vite ist schon im Einsatz, `@sveltejs/vite-plugin-svelte` ist eine kleine Ergänzung, kein Tooling-Bruch. Wichtige Grenze: das Canvas-Rendering (die ganze Physik-/Timing-Logik in `renderFrame()`, `updateDynamicLayout()`, `getBankTransform()`, `getSmoothedAutoZoomExp()`, `computeAutoZoomTAB()` etc.) bleibt inhaltlich unverändert vanilla JS/Canvas-2D-Code - Svelte hilft nur bei der UMGEBUNG drumherum (Control-Panel, austauschbare Widgets, Zustands-Sync), nicht beim Kern.

## 2. Aktuelle Architektur (Ist-Zustand, als Referenz)

- `bank-core.js` - reine Algorithmus-Bibliothek (Bank-Auswahl/Schneiden + Schalen-Orchestrierung + Kompaktierung + Tick↔Zeit-Mapping), ES-Modul + CommonJS-Dual-Export, framework-agnostisch. **Bleibt unangetastet.**
- `sqrt2.html` - Haupttool, eine Datei: `<style>` + `<script type="module">` mit allem drin:
  - **Compiler** (`compileSystem()`): ruft `buildSystem()` aus `bank-core.js`, baut `axes`/`bank_pieces`/`render_pipeline`/Tick↔Zeit-Mapping/Zoom-Checkpoints/Auto-Zoom-Checkpoints.
  - **Renderer** (`renderFrame()` + Helfer): Canvas-2D-Zeichnung, gesteuert von `u_time`/`u_mode_AB`/`AUTO_ZOOM_MIN_PX`/`BANK_ZOOM_THRESHOLD_POWERS`.
  - **HUD** (`updateHUD()`): DOM-Text/Balken-Updates für das "Bank (Restfläche)"-Inventar-Panel - **das ist genau das Widget, das austauschbar werden soll.**
  - **Control-Panel**: reine HTML-Inputs (`range`/`number`/`select`) mit manuell verdrahteten `addEventListener`, die direkt Modul-Scope-`let`-Variablen mutieren und `compileSystem()`/`renderFrame()`/`updateOutputs()` imperativ aufrufen.
- `selection_strategy_prototype.html` - Test-Tool, strukturell ähnlich (eigenes Canvas, eigenes Control-Panel, importiert ebenfalls `bank-core.js`). **Vorerst außerhalb des Scopes** dieses Umbaus (siehe Abschnitt 6).
- `vite.config.js` - Multi-Entry-Build (`sqrt2.html`, `selection_strategy_prototype.html`).

## 3. Zielarchitektur

### 3.1 Zustands-Stores

Drei Schichten, weil sie sich mit sehr unterschiedlicher Frequenz und Reichweite ändern:

- **`configStore`** (writable, klein, wird zwischen Fenstern synchronisiert): `BASE`, `N_MAX`, `transformMode` (`'S'|'Z'`), `u_mode_AB`, `AUTO_ZOOM_MIN_PX`, `BANK_ZOOM_THRESHOLD_POWERS`. Das ist der Zustand, den ein Fernsteuerungs-Fenster liest/schreibt.
- **`playbackStore`** (writable, hochfrequent während der Animation): `u_time`, `isPlaying`, `animDirection`. Ändert sich bei jedem `requestAnimationFrame`.
- **`compiledStore`** (**derived**, NICHT synchronisiert): das Ergebnis von `compileSystem()` (grob: `axes`, `TOTAL_STEPS`, `bank_pieces`, `render_pipeline`, `GLOBAL_*`-Arrays, `MAX_TIME`, `GLOBAL_TTM`, `GLOBAL_AUTO_ZOOM_CHECKPOINTS`). Wird lokal in JEDEM Fenster aus `configStore` neu berechnet (reiner, deterministischer, schneller Funktionsaufruf - siehe Performance-Test im Gesprächsverlauf: <0.2ms selbst bei tiefer Rekursion für die Auto-Zoom-Suche allein, `compileSystem()` insgesamt ist bei den bisher getesteten Tiefen ebenfalls unkritisch). **Bewusste Entscheidung:** NICHT über `BroadcastChannel` übertragen - das wäre unnötig groß (tausende Bank-Stücke) und fragil (Serialisierung). Stattdessen wird nur der KLEINE `configStore` synchronisiert, jedes Fenster leitet daraus deterministisch denselben `compiledStore` her.

### 3.2 Komponenten-Grenzen

- `<TargetBankCanvas>` - Wrapper um das bestehende Canvas-Rendering. Die Zeichen-Funktionen (`renderFrame()` & Helfer) werden weitgehend **1:1 portiert**, nicht neu designt - nur die Datenquelle wechselt von Modul-Scope-Variablen zu Store-Reads.
- `<RestCounterBars>` - vertikale Balken-Variante, Port des bestehenden `updateHUD()`-Balken-Teils.
- `<RestCounterGrid>` - NEU: horizontales bis-zu-4×4-Grid (Design noch offen, siehe Abschnitt 7).
- `<ControlPanel>` - alle Regler/Inputs, schreiben in `configStore`/`playbackStore`.
- `<TickTimeline>` - Zeitstrahl + Tick-Regler (siehe README Abschnitt 5) - eigene Komponente oder Teil von `<ControlPanel>`, offen.
- Pro "Rolle" ein Top-Level-Einstiegspunkt (= eigener Vite-Entry, analog zu den heutigen zwei HTML-Dateien):
  - `MainApp.svelte` (volle Erfahrung: Canvas + Steuerung + Rest-Widget-Auswahl) - Ersatz für das heutige `sqrt2.html`.
  - `RemoteControl.svelte` (nur Steuerung, kein Canvas) - für ein zweites Fenster/Gerät.
  - `RestDisplay.svelte` (nur EIN Rest-Widget, vollflächig) - für einen zweiten Bildschirm.

### 3.3 Fenster-übergreifende Synchronisierung

- `BroadcastChannel('sqrt2-state')`, gekapselt in einem kleinen Adapter (`syncedStore(store, channelName)`), der bei lokaler Änderung `postMessage` sendet und bei `onmessage` den lokalen Store aktualisiert, OHNE erneut zu senden (Standard-Zyklenvermeidung).
- Nur `configStore` und `playbackStore` werden synchronisiert (siehe 3.1) - `compiledStore` bleibt lokal.
- **Wichtig für Später:** dieselbe Store-Schnittstelle soll später auf einen echten Netzwerk-Transport (WebSocket/Firebase, für Geräte außerhalb des einen Rechners) umstellbar sein, ohne dass die Komponenten das merken - der Adapter ist der einzige Ort, der den Transport kennt.

## 4. Migrationsplan (inkrementell, in Etappen abschließbar)

Jede Phase ist einzeln committ- und testbar - wichtig, damit eine künftige Sitzung nicht bei Null anfangen muss, auch wenn nicht alle Phasen in einer Sitzung passen.

| Phase | Inhalt | Risiko/Aufwand |
|---|---|---|
| 0 | `svelte` + `@sveltejs/vite-plugin-svelte` als devDependencies, `vite.config.js` erweitern, `src/`-Struktur anlegen, eine triviale Svelte-Komponente rendert erfolgreich via `npm run dev` | niedrig, ~30 Min |
| 1 | `compileSystem()`s nicht-DOM-Logik aus dem Inline-`<script>` in ein reines Modul `src/lib/compiler.js` extrahieren (Funktion: Config rein, kompilierter Zustand raus, kein DOM-Zugriff) - **reines Refactoring, kein Verhaltensunterschied**. `sqrt2.html` danach verifizieren (identisches Verhalten) | niedrig-mittel, höchster Hebel für alles Weitere |
| 2 | `src/lib/stores.js`: `configStore`/`playbackStore` (writable) + `compiledStore` (derived, ruft Phase-1-Funktion). Noch keine UI-Änderung - `sqrt2.html` kann testweise weiter vanilla bleiben und nur `.subscribe()`/`.set()` auf die Stores nutzen, um die Store-Schicht isoliert zu verifizieren | mittel |
| 3 | Control-Panel in Svelte-Komponenten umbauen, gebunden an die Stores. Verhalten mit dem alten Panel abgleichen | mittel |
| 4 | Canvas + HUD komponentisieren (`<TargetBankCanvas>`, `<RestCounterBars>`). `updateHUD()` in die zwei Widget-Varianten aufteilen (Balken jetzt, Grid neu) | mittel-hoch (neues Grid-Widget ist Neuentwicklung, nicht nur Port) |
| 5 | `BroadcastChannel`-Sync-Adapter + zweiter Vite-Entry (`RemoteControl.svelte`). Verifizieren: zwei Browser-Tabs bleiben synchron | mittel |
| 6 | Politur: Widget-Auswahl-UI, admin-konfigurierbare Steuerungs-Komplexität (bereits als Wunsch in README Abschnitt 10 notiert) | niedrig, kann warten |

**Empfehlung für den Einstieg in die nächste Sitzung:** mit Phase 0+1 anfangen. Phase 1 ist der höchste Hebel (macht den Kern testbar/wiederverwendbar, ohne dass irgendetwas an der sichtbaren App sich ändert) und lässt sich unabhängig von der Svelte-Entscheidung selbst schon committen.

## 5. Explizite Nicht-Ziele / Abgrenzung

- `bank-core.js` wird **nicht** angefasst - bleibt die geteilte, framework-agnostische Quelle für beide Tools.
- `selection_strategy_prototype.html` (Test-Tool) ist **out of scope** für diesen Umbau (siehe Abschnitt 6) - bleibt vorerst vanilla.
- Kein neuer Server/Backend in dieser Phase - nur `BroadcastChannel` (ein Rechner, mehrere Fenster/Tabs). Echte Geräte-Fernsteuerung (separates Backend, QR-Code) ist ein SPÄTERER Schritt, schon in README Abschnitt 10 vermerkt, hier nicht mit umzusetzen.
- Visuelle/Animations-Themen (C¹-Stetigkeit für Z/R-Modi, Kompaktierung im Haupttool) sind unabhängig davon und **nicht** Teil dieses Umbaus - nicht vermischen.

## 6. Offene Fragen (vor oder zu Beginn der nächsten Sitzung klären)

- **Svelte 5 (Runes) oder Svelte 4 (klassische Reaktivität)?** Empfehlung: Svelte 5, da Neuanlage (kein Migrationsdruck von bestehendem Svelte-Code) und aktueller Stand.
- **TypeScript für den neuen Svelte-Code, oder plain JS** (wie der Rest des Projekts)? Tendenz: plain JS für Konsistenz, aber offen.
- **Soll `selection_strategy_prototype.html` mittelfristig auch migriert werden**, oder bleibt es dauerhaft vanilla (eigenständiges Test-Tool, kein Bedarf an austauschbaren Widgets)? Keine Entscheidung nötig, um mit dem Haupttool zu starten.
- **Namensgebung/URLs der neuen Einstiegspunkte** (z.B. `/control.html`, `/display.html`)?
- **Channel-Name für `BroadcastChannel` statisch oder konfigurierbar** (falls später mehrere Exponate im selben Netz laufen)? Für den Erstwurf: statisch, siehe README-Hinweis zur Mehrbildschirm-Vision.

## 7. Noch nicht spezifiziert (bewusst offen gelassen)

- Exaktes visuelles Design des 4×4-Grid-Rest-Widgets (Layout-Details, wie mehr als 16 Stücke pro Ziffern-Stelle dargestellt werden, Farbgebung analog zu `COLORS` in `sqrt2.html`).
- Welche weiteren Rest-Anzeige-Modi über die zwei genannten hinaus geplant sind ("wir werden unterschiedliche Modi ausprobieren" - noch keine Liste).
- Genaue Aufteilung von `<TickTimeline>` (eigene Komponente vs. Teil von `<ControlPanel>`).
