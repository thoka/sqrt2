# Tooling-Umbau: Svelte + geteilter Zustand für austauschbare Widgets & Fernsteuerung

**Status:** Spezifikation, noch nicht begonnen. Ziel dieses Dokuments: genug Kontext, um den Umbau in einer neuen Sitzung effizient zu starten, ohne die Diskussion aus dem Gesprächsverlauf zu wiederholen.

## 1. Warum (Kontext aus dem Gespräch)

Zwei konkrete Wünsche haben denselben architektonischen Bedarf:

1. **Rest-Anzeige als austauschbare Widgets.** Die Bank/Rest-Visualisierung als Zähler soll unabhängig von den übrigen Einstellungen verfügbar sein, mit mehreren Darstellungs-Modi zum Ausprobieren: vertikale Anzeige aller Ziffern-Stellen als Balken (existiert schon als Teil von `updateHUD()`, aber fest verdrahtet), horizontale Anzeige als bis zu 4×4-Grid (abhängig von der Basis, noch nicht gebaut). Weitere Modi werden folgen ("Wir werden unterschiedliche Modi ausprobieren").
2. **Steuerung über ein zweites Fenster / einen separat verbundenen Browser.** Bereits in der README (Abschnitt 11, "Zukünftige Vision") als Wunsch notiert: Ziel/Rest/Steuerung auf getrennten Displays, später auch QR-Code-Fernsteuerung von einem Handy aus.

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

| Phase | Inhalt | Risiko/Aufwand | Status |
|---|---|---|---|
| 0 | `svelte` + `@sveltejs/vite-plugin-svelte` als devDependencies, `vite.config.js` erweitern, `src/`-Struktur anlegen, eine triviale Svelte-Komponente rendert erfolgreich via `npm run dev` | niedrig, ~30 Min | **erledigt** |
| 1 | `compileSystem()`s nicht-DOM-Logik aus dem Inline-`<script>` in ein reines Modul `src/lib/compiler.js` extrahieren (Funktion: Config rein, kompilierter Zustand raus, kein DOM-Zugriff) - **reines Refactoring, kein Verhaltensunterschied**. `sqrt2.html` danach verifizieren (identisches Verhalten) | niedrig-mittel, höchster Hebel für alles Weitere | **erledigt** |
| 2 | `src/lib/stores.js`: `configStore`/`playbackStore` (writable) + `compiledStore` (derived, ruft Phase-1-Funktion). Noch keine UI-Änderung - `sqrt2.html` kann testweise weiter vanilla bleiben und nur `.subscribe()`/`.set()` auf die Stores nutzen, um die Store-Schicht isoliert zu verifizieren | mittel | **erledigt** |
| 3 | Control-Panel in Svelte-Komponenten umbauen, gebunden an die Stores. Verhalten mit dem alten Panel abgleichen | mittel | **erledigt** (3a URL-Sync, 3b ControlPanel, 3c PlaybackBar; `sqrt2.html` auf Stores umverdrahtet) |
| 4 | Canvas + HUD komponentisieren (`<TargetBankCanvas>`, `<RestCounterBars>`, `<RestCounterGrid>`). `updateHUD()` in die zwei Widget-Varianten aufteilen (Balken jetzt, Grid neu) | mittel-hoch (neues Grid-Widget ist Neuentwicklung, nicht nur Port) | **erledigt** (4a `<TargetBankCanvas>` + 4b `<RestCounterBars>` + 4c `<RestCounterGrid>`, siehe Stand) |
| 5 | `BroadcastChannel`-Sync-Adapter + zweiter Vite-Entry (`RemoteControl.svelte`). Verifizieren: zwei Browser-Tabs bleiben synchron | mittel | offen |
| 6 | Politur: Widget-Auswahl-UI, admin-konfigurierbare Steuerungs-Komplexität (bereits als Wunsch in README Abschnitt 11 notiert) | niedrig, kann warten | offen |

 **Stand (2026-07-15, aktualisiert):** Phase 0+1+2+3 umgesetzt. Phase 0: `svelte`, `@sveltejs/vite-plugin-svelte`, `vitest` + `jsdom` installiert; `svelte-smoke.html`/`src/App.svelte`/`src/main.js` als triviale, per `npm run dev` UND per persistentem Vitest-Test (`src/App.test.js`, `svelte`-Kern-APIs `mount`/`unmount`/`flushSync`, siehe [offizielle Svelte-5-Testing-Doku](https://svelte.dev/docs/svelte/testing)) verifizierte Komponente. Phase 1: `src/lib/compiler.js` enthält jetzt die komplette bisherige `compileSystem()`-Logik als reine Funktion (Config-Objekt rein, kompilierter Zustand raus); `sqrt2.html`s `compileSystem()` ist nur noch ein dünner DOM-Adapter davor. Abgesichert durch `compiler.test.js` (Determinismus, Struktur-Invarianten, Tick↔Zeit-Monotonie, Kompaktierungs-Zweige). Phase 2: `src/lib/stores.js` mit `configStore`/`playbackStore` (`writable`, Default-Werte aus den bisherigen Input-`value`-Attributen gespiegelt) und `compiledStore` (`derived` aus `configStore`, ruft `compileSystem()` aus Phase 1). Phase 3: URL-Sync (`src/lib/urlState.js`, `parseConfigFromUrl`/`parsePlaybackFromUrl`/`buildStateParams`, runden via `url-state.test.js` abgesichert), `<ControlPanel>` (gebunden an configStore, Tick-Eingabe + "Zustand teilen"-Buttons, `ControlPanel.test.js`), `<PlaybackBar>` (Play/Pause + Zeitstrahl + Readout, gebunden an playbackStore/compiledStore, `PlaybackBar.test.js`). `sqrt2.html` ist auf die Stores umverdrahtet: `mount(ControlPanel/PlaybackBar)` in die vorbereiteten Mount-Ziele, `configStore.subscribe(applyConfig)`/`playbackStore.subscribe(applyPlayback)` als Ersatz für die früheren `compileSystem()`-/`addEventListener`-Aufrufe; Canvas-Rendering + rAF-Schleife bleiben vanilla (lesen die gesetzten Modul-Scope-Variablen). `npm test` (81 node --test + 11 vitest) und `npm run build` grün. Ein Default-Wert (`lineWidth`) war in `stores.js` mit `1` statt des Original-Regler-Defaults `0.3` hinterlegt (Verhaltensänderung) - korrigiert auf `0.3`.

**Wichtige Erkenntnis für Phase 3+:** `derived`-Stores aus `svelte/store` cachen ihren Wert NUR, solange mindestens ein aktiver Subscriber besteht - ein `get(compiledStore)` ohne offenes `.subscribe()` hängt sich kurz ein und wieder aus und löst dabei JEDES MAL eine Neu-Kompilierung aus (inhaltsgleiches, aber neues Objekt). Für `<TargetBankCanvas>` (Phase 4) heißt das: mit `$compiledStore` (Svelte-Auto-Subscription in einer Komponente) arbeiten, nicht mit wiederholtem `get()` in einer Render-Schleife - sonst kompiliert jeder Frame neu statt nur bei echten configStore-Änderungen.

 **Empfehlung für den Einstieg in die nächste Sitzung:** mit Phase 4 weitermachen (Canvas + HUD komponentisieren: `<TargetBankCanvas>` als Wrapper um das bestehende `renderFrame()`-Rendering, `<RestCounterBars>` als Port von `updateHUD()`; danach `<RestCounterGrid>` neu). Wichtig: `renderFrame()`/`updateHUD()` lesen derzeit Modul-Scope-Variablen (axes/bank_pieces/u_time/...), die `applyConfig()`/`applyPlayback()` aus den Stores füllen - beim Auslagern in eine Komponente auf die Doku-Regel aus Abschnitt 4 achten: mit `$compiledStore` (Auto-Subscription) arbeiten, NICHT mit wiederholtem `get()`, sonst kompiliert jeder Frame neu.

 **Stand (2026-07-15, Phase 4 begonnen):** `<RestCounterBars>` (Phase 4b) umgesetzt und abgesichert (`src/components/RestCounterBars.test.js`): vertikale Balken-Variante des Bank-/Rest-Inventars, 1:1-Port des Balken-Teils aus dem früheren `updateHUD()` in `sqrt2.html`. Liest nur lesend `<compiledStore>` (bank_pieces/depth) + `<playbackStore.time>` und rendert pro Exponent k die sichtbaren Stücke (born_time ≤ t < cut_time UND < taken_time) - KEIN Store-Schreibzugriff, damit es als eines von mehreren austauschbaren Rest-Widgets neben dem Canvas existieren kann. Die Skalierung (`updateBankPanelScale()`) wanderte mit in die Komponente (`onMount` + `resize`-Listener, `Math.min(1, (innerHeight-40)/natural)`). In `sqrt2.html` wurde `updateHUD()` auf NUR die Zahlentafel l/l²/R reduziert (Hash-Gating jetzt nur noch Step+BASE statt Step+counts+BASE - MathJax `typesetPromise()` läuft nicht mehr bei jeder reinen Bestandsänderung); der Balken-Block samt `bankPanelInner`-Referenz/`updateBankPanelScale()`-Aufruf entfiel. `npm test` (81 node --test + 13 vitest) und `npm run build` grün.

 **Phase 4c (`<RestCounterGrid>`) ebenfalls erledigt:** NEUES horizontales 4×4-Grid-Rest-Widget (Design in Spec §7 bewusst offen → hier festgelegt: je Zelle ein Exponent k mit proportionalem Balken + Zähler + Label, Exponenten ab k=16 als "+N"-Badge zusammengefasst; identische Farbgebung via COLORS). Liest ebenfalls nur lesend die Stores (KEIN Schreibzugriff). Damit sind Balken- und Grid-Widget vollständig austauschbar - Umschaltung über einen neuen **`displayStore`** (`src/lib/displayStore.js`, lokaler UI-Zustand, bewusst NICHT synchronisiert: nur configStore/playbackStore sind laut §3.1 der geteilte Zustand) mit einem Select in `<ControlPanel>` ("Rest-Anzeige") und einem `displayStore.subscribe()` in `sqrt2.html`, das `#bankPanel` (Balken) bzw. `#restGridPanel` (Grid, fixiert unten links) gegenseitig ein-/ausblendet. Abgesichert durch `src/components/RestCounterGrid.test.js` (Zellenanzahl gedeckelt auf 4×4, korrekter Bestand/Label je Zelle, reagiert auf playbackStore.time). `npm test` (81 node --test + 15 vitest) und `npm run build` grün. **Hinweis (wie Phase 3):** die visuelle Platzierung/Skalierung des Grid-Panels (fixiert unten links, 300px) ist in dieser Sandbox ohne Browser nicht verifiziert - funktional (Daten/Rendering/Subscribe) grün.

 **Stand (2026-07-15, Phase 4a erledigt):** `<TargetBankCanvas>` umgesetzt (`src/components/TargetBankCanvas.svelte`): voller Port von `renderFrame()`/Hilfsfunktionen/Loop/`applyPlayback()`/`applyConfig()`/HUD-Lesezugriffen aus `sqrt2.html`. Die Komponente hält ihren eigenen Render-State als lokale Variablen (gleiche Namen wie früher Modul-Scope) und füllt ihn in `onMount` + Store-Subscriptions (`$compiledStore`/`$configStore`/`$playbackStore`, Auto-Subscription statt `get()`, s. Erkenntnis unten) - `playbackStore` bleibt die Schnittstelle nach außen (PlaybackBar/ControlPanel schreiben isPlaying/time, die Loop spiegelt time per `_suppressPlaybackRender`-Guard zurück). In `sqrt2.html` wurde das `<canvas id="glCanvas">` durch `<div id="canvasMount">` ersetzt und `<TargetBankCanvas>` per `mount()` eingehängt; die eval-zeit-kritischen Stellen des alten Canvas-Codes wurden entfernt (`const canvas`/`ctx`, `window.addEventListener('resize', resizeCanvas)`, `resizeCanvas()`-Aufruf, `playbackStore.subscribe(applyPlayback)`). `updateOutputs()` ruft jetzt nur noch `updateHUD(u_time)` - die Zahlentafel (l/l²/R) läuft weiter über einen schlanken `playbackStore.subscribe((p) => { u_time = p.time; updateHUD(u_time); })`. Der alte SYSTEM-C-Renderblock (renderFrame()/resizeCanvas()/applyPlayback()/loop()) ist jetzt uncalled/tot (sicher, weil nie aufgerufen) und wird beim Aufräumen entfernt. `npm test` (81 node --test + 15 vitest) und `npm run build` grün. **Hinweis:** wie die vorherigen Steps ist die visuelle Korrektheit (Canvas-Skalierung, Loop-Sync mit playbackStore, Auto-Zoom) in dieser Sandbox ohne Browser nicht verifiziert - funktional (Build + Subscribe + Store-Füllung portiert 1:1) grün.

 **Nächster Schritt:** Phase 5 - `BroadcastChannel`-Sync-Adapter + zweiter Vite-Entry (`RemoteControl.svelte`). Verifizieren: zwei Browser-Tabs bleiben synchron. Vorher optional: toten SYSTEM-C-Renderblock in `sqrt2.html` aufräumen (kein funktionaler Gewinn, nur Code-Hygiene).

## 5. Explizite Nicht-Ziele / Abgrenzung

- `bank-core.js` wird **nicht** angefasst - bleibt die geteilte, framework-agnostische Quelle für beide Tools.
- `selection_strategy_prototype.html` (Test-Tool) ist **out of scope** für diesen Umbau (siehe Abschnitt 6) - bleibt vorerst vanilla.
- Kein neuer Server/Backend in dieser Phase - nur `BroadcastChannel` (ein Rechner, mehrere Fenster/Tabs). Echte Geräte-Fernsteuerung (separates Backend, QR-Code) ist ein SPÄTERER Schritt, schon in README Abschnitt 11 vermerkt, hier nicht mit umzusetzen.
- Visuelle/Animations-Themen (C¹-Stetigkeit für Z/R-Modi, Kompaktierung im Haupttool) sind unabhängig davon und **nicht** Teil dieses Umbaus - nicht vermischen.

## 6. Offene Fragen

- **Svelte 5 (Runes) oder Svelte 4?** Entschieden: **Svelte 5** (`^5.56.5`, aktuell zum Zeitpunkt der Umsetzung, Juli 2026 - `next`-Dist-Tag von npm zeigt keine Svelte-6-Vorabversion, Svelte 5 bleibt die aktuelle Major-Version). Neuanlage, kein Migrationsdruck.
- **TypeScript oder plain JS?** Entschieden: **plain JS**, für Konsistenz mit `bank-core.js`/`smoothing.js`/`sqrt2.html` (keine JSDoc-Typannotationen im restlichen Projekt, siehe Kommentar-Konvention in `src/lib/compiler.js`).
- **Vite-Version:** Bei Umsetzung war `vite@8` (Rolldown-basiert, Bundler-Architekturwechsel von Rollup/esbuild) bereits aktuell auf npm, `vite@7.3.6` "previous". Bewusst **`vite@^7.3.6`** gewählt statt `8`: `@sveltejs/vite-plugin-svelte@7.x` verlangt `vite@^8`, aber Vite 8s Rolldown-Umstellung ist ein Architekturwechsel, der über den eigentlichen Bedarf dieses Umbaus (Svelte-Tooling ergänzen) hinausgeht und unnötiges Risiko fürs bestehende, funktionierende Zwei-Seiten-Build ist. `@sveltejs/vite-plugin-svelte@^6.2.4` unterstützt `vite@^6.3.0 || ^7.0.0` und bleibt auf der klassischen Rollup/esbuild-Pipeline - `build.rollupOptions.input` (Multi-Entry) unverändert kompatibel. Node 22.14 erfüllt beide Anforderungen (`^20.19 || >=22.12`). Bei einer künftigen Aktualisierung auf Vite 8 gesondert prüfen (Rolldown-Migrationsleitfaden: <https://vite.dev/guide/migration>).
- **Testing-Setup für Svelte-Komponenten:** `vitest` + `jsdom`, gemäß offizieller Svelte-5-Empfehlung (kein zusätzliches `@testing-library/svelte` nötig - Svelte exportiert `mount`/`unmount`/`flushSync` direkt für Komponenten-Tests, siehe `src/App.test.js`). Läuft als zweiter Test-Schritt in `npm test`, neben dem bestehenden `node --test` für reine Logik-Module.
- **Soll `selection_strategy_prototype.html` mittelfristig auch migriert werden**, oder bleibt es dauerhaft vanilla (eigenständiges Test-Tool, kein Bedarf an austauschbaren Widgets)? Weiterhin offen, keine Entscheidung nötig, um mit dem Haupttool weiterzumachen.
- **Namensgebung/URLs der neuen Einstiegspunkte** (z.B. `/control.html`, `/display.html`)? `svelte-smoke.html` (Phase 0) ist nur ein Wegwerf-Kandidat für den Smoke-Test - Namensgebung für `MainApp`/`RemoteControl`/`RestDisplay` bleibt für Phase 3/4 offen.
- **Channel-Name für `BroadcastChannel` statisch oder konfigurierbar** (falls später mehrere Exponate im selben Netz laufen)? Für den Erstwurf: statisch, siehe README-Hinweis zur Mehrbildschirm-Vision.

## 7. Noch nicht spezifiziert (bewusst offen gelassen)

- Exaktes visuelles Design des 4×4-Grid-Rest-Widgets (Layout-Details, wie mehr als 16 Stücke pro Ziffern-Stelle dargestellt werden, Farbgebung analog zu `COLORS` in `sqrt2.html`).
- Welche weiteren Rest-Anzeige-Modi über die zwei genannten hinaus geplant sind ("wir werden unterschiedliche Modi ausprobieren" - noch keine Liste).
- Genaue Aufteilung von `<TickTimeline>` (eigene Komponente vs. Teil von `<ControlPanel>`).
