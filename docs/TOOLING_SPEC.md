# Tooling-Umbau: Svelte + geteilter Zustand für austauschbare Widgets & Fernsteuerung

**Status:** Phasen 0–8 erledigt (alle Tests grün). Phase 6 (Politur) offen. Deployment läuft über GitHub Pages (Branch `gh-pages`, lokal gebaut via `scripts/deploy-pages.sh`). Lokale Port-Isolation über mise/direnv (`scripts/init-local-ports.sh`). Ziel dieses Dokuments: genug Kontext, um den Umbau in einer neuen Sitzung effizient zu starten, ohne die Diskussion aus dem Gesprächsverlauf zu wiederholen.

## 1. Warum (Kontext aus dem Gespräch)

Zwei konkrete Wünsche haben denselben architektonischen Bedarf:

1. **Rest-Anzeige als austauschbare Widgets.** Die Bank/Rest-Visualisierung als Zähler soll unabhängig von den übrigen Einstellungen verfügbar sein, mit mehreren Darstellungs-Modi zum Ausprobieren: vertikale Anzeige aller Ziffern-Stellen als Balken (existiert schon als Teil von `updateHUD()`, aber fest verdrahtet), horizontale Anzeige als bis zu 4×4-Grid (abhängig von der Basis, noch nicht gebaut). Weitere Modi werden folgen ("Wir werden unterschiedliche Modi ausprobieren").
2. **Steuerung über ein zweites Fenster / einen separat verbundenen Browser.** Bereits in der README (Abschnitt 11, "Zukünftige Vision") als Wunsch notiert: Ziel/Rest/Steuerung auf getrennten Displays, später auch QR-Code-Fernsteuerung von einem Handy aus.

Beides braucht dieselbe Grundarchitektur: **Zustand von Darstellung trennen**, damit (a) mehrere Widget-Varianten denselben Zustand unterschiedlich rendern können und (b) mehrere Fenster/Geräte denselben Zustand teilen können. Das aktuelle `sqrt2.html` ist eine einzige Datei mit imperativer DOM-Manipulation (`getElementById`, manuelles `innerHTML`, direkt gemutierte `let`-Variablen im Modul-Scope) - das macht (a) und (b) beides mühsam.

**Frage im Gespräch:** Sollen wir dafür auf Svelte umsteigen? **Antwort: ja, empfohlen.** Vite ist schon im Einsatz, `@sveltejs/vite-plugin-svelte` ist eine kleine Ergänzung, kein Tooling-Bruch. Wichtige Grenze: das Canvas-Rendering (die ganze Physik-/Timing-Logik in `renderFrame()`, `updateDynamicLayout()`, `getBankTransform()`, `getSmoothedAutoZoomExp()`, `computeAutoZoomTAB()` etc.) bleibt inhaltlich unverändert vanilla JS/Canvas-2D-Code - Svelte hilft nur bei der UMGEBUNG drumherum (Control-Panel, austauschbare Widgets, Zustands-Sync), nicht beim Kern.

## 2. Aktuelle Architektur (Ist-Zustand, als Referenz)

- `src/lib/bank-core.js` - reine Algorithmus-Bibliothek (Bank-Auswahl/Schneiden + Schalen-Orchestrierung + Kompaktierung + Tick↔Zeit-Mapping), ES-Modul, framework-agnostisch. Liegt in `src/lib/`.
- `sqrt2.html` - Haupttool, eine Datei: `<style>` + `<script type="module">` mit allem drin:
  - **Compiler** (`compileSystem()`): ruft `buildSystem()` aus `bank-core.js`, baut `axes`/`bank_pieces`/`render_pipeline`/Tick↔Zeit-Mapping/Zoom-Checkpoints/Ziel-Darstellungs-Checkpoints.
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
- **`compiledStore`** (**derived**, NICHT synchronisiert): das Ergebnis von `compileSystem()` (grob: `axes`, `TOTAL_STEPS`, `bank_pieces`, `render_pipeline`, `GLOBAL_*`-Arrays, `MAX_TIME`, `GLOBAL_TTM`, `GLOBAL_TARGET_DISPLAY_CHECKPOINTS`). Wird lokal in JEDEM Fenster aus `configStore` neu berechnet (reiner, deterministischer, schneller Funktionsaufruf - siehe Performance-Test im Gesprächsverlauf: <0.2ms selbst bei tiefer Rekursion für die Ziel-Darstellungs-Suche allein, `compileSystem()` insgesamt ist bei den bisher getesteten Tiefen ebenfalls unkritisch). **Bewusste Entscheidung:** NICHT über `BroadcastChannel` übertragen - das wäre unnötig groß (tausende Bank-Stücke) und fragil (Serialisierung). Stattdessen wird nur der KLEINE `configStore` synchronisiert, jedes Fenster leitet daraus deterministisch denselben `compiledStore` her.

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
| 0 | `svelte` + `@sveltejs/vite-plugin-svelte` als devDependencies, `vite.config.js` erweitern, `src/`-Struktur anlegen, eine triviale Svelte-Komponente rendert erfolgreich via `pnpm dev` | niedrig, ~30 Min | **erledigt** |
| 1 | `compileSystem()`s nicht-DOM-Logik aus dem Inline-`<script>` in ein reines Modul `src/lib/compiler.js` extrahieren (Funktion: Config rein, kompilierter Zustand raus, kein DOM-Zugriff) - **reines Refactoring, kein Verhaltensunterschied**. `sqrt2.html` danach verifizieren (identisches Verhalten) | niedrig-mittel, höchster Hebel für alles Weitere | **erledigt** |
| 2 | `src/lib/stores.js`: `configStore`/`playbackStore` (writable) + `compiledStore` (derived, ruft Phase-1-Funktion). Noch keine UI-Änderung - `sqrt2.html` kann testweise weiter vanilla bleiben und nur `.subscribe()`/`.set()` auf die Stores nutzen, um die Store-Schicht isoliert zu verifizieren | mittel | **erledigt** |
| 3 | Control-Panel in Svelte-Komponenten umbauen, gebunden an die Stores. Verhalten mit dem alten Panel abgleichen | mittel | **erledigt** (3a URL-Sync, 3b ControlPanel, 3c PlaybackBar; `sqrt2.html` auf Stores umverdrahtet) |
| 4 | Canvas + HUD komponentisieren (`<TargetBankCanvas>`, `<RestCounterBars>`, `<RestCounterGrid>`). `updateHUD()` in die zwei Widget-Varianten aufteilen (Balken jetzt, Grid neu) | mittel-hoch (neues Grid-Widget ist Neuentwicklung, nicht nur Port) | **erledigt** (4a `<TargetBankCanvas>` + 4b `<RestCounterBars>` + 4c `<RestCounterGrid>`, siehe Stand) |
| 5 | `BroadcastChannel`-Sync-Adapter + zweiter Vite-Entry (`RemoteControl.svelte`). Verifizieren: zwei Browser-Tabs bleiben synchron | mittel | **erledigt** |
| 6 | Politur: Widget-Auswahl-UI, admin-konfigurierbare Steuerungs-Komplexität (bereits als Wunsch in README Abschnitt 11 notiert) | niedrig, kann warten | offen |
| 7 | **Dateisystem-Reorganisation / "reine Svelte-App im Root":** `sqrt2.html` → `index.html` (App läuft jetzt bei `/`, nicht bei `/sqrt2.html`); gesamte Inline-Logik aus `index.html` nach `src/App.svelte` ausgelagert, Styles nach `src/app.css`; Verzeichnisstruktur an etablierte Vorlage angepasst (`docs/`, `tests/unit/`, `tests/e2e/`); Legacy-Prototypen (`p.html`, `selection_strategy_prototype.html`, `svelte-smoke.html`) entfernt | niedrig-mittel | **erledigt** (committet, Branch `cleanup-by-hy3`) |
| 8 | **Connection-Service an sqrt2 anbinden (Cross-Device):** `syncedStore.js` bekommt einen Transport-abstrahierten Sync (BroadcastChannel **und** WebSocket-Relay über dieselbe Store-Schnittstelle, `initNetworkSync()`); `src/lib/connection.js` kapselt WS-Room + REST-Helfer (Token minten/PIN rotieren/revoken) + QR-Gast-Link-Bau. `ControlPanel.svelte` zeigt QR-Code + PIN einer Exponat-Sitzung; `RemoteControl.svelte` verbindet per WS, wenn der QR-Link `ws`/`token`/`pin` trägt | mittel | **erledigt** (Unit-Tests: `tests/unit/connection.test.js` + `syncedStore.test.js` Netzwerk-Transport; `qrcode` als Dependency) |

**Status (2026-07-16):** Phasen 0–8 erledigt, Unit-Tests grün, Build grün, E2E grün (inkl. Routing-Test: Vite `appType: 'mpa'` liefert 404 für unbekannte Pfade statt SPA-Fallback). `sqrt2.html` existiert nicht mehr – Einstiegspunkt ist `index.html` (Vite-Root). Nebenstrang **Connection-Service** (Zwei-Stufen-Auth, Cross-Device-Steuerung) an sqrt2 angebunden (Phase 8) **und auf "ein Server" vereinfacht**: der Relay ist jetzt eine Bibliothek (`createRelay()` in `server/relay/server.js`), die embedded in `server/index.js` (Statics + Relay, ein Origin, kein CORS) bzw. als Vite-Proxy-Ziel (`scripts/relay-dev.sh`) läuft. `configStore`/`playbackStore` laufen über BroadcastChannel (Same-Browser-Fast-Path) **und** über das WebSocket-Relay (`src/lib/connection.js` + `initNetworkSync()` in `syncedStore.js`); Exponat zeigt QR+PIN im `ControlPanel`, Gast verbindet per QR-Link via `RemoteControl`. Spec in `docs/CONNECTION_SERVICE_SPEC.md`.
**Zusatz (Branch `better-precision`, 2026-07-16):** Plan `docs/REST-PRECISION-PLAN.md` (Teil A + Teil B) committet – exakte Zahlentafel `l`/`R` über BigInt-Präfixsummen ohne Wurzel (`compiler.js` + `App.svelte`) und robuster Zoom-Bounding-Box via `relativePosition()` (`bank-core.js` + `compiler.js`, localOffset-Ketten ab LCA statt Float-Differenz). 28 neue Unit-Tests grün (21 Teil A + 7 Teil B); volle Unit-Suite + E2E + Build + `pnpm check` grün. Offen: `compiler-split.test.js` hängt bei base 16 / depth 15 (Stückzahl explodiert) – unabhängig von diesem Plan, separat fixen.

**Wichtige Erkenntnis für Phase 3+:** `derived`-Stores aus `svelte/store` cachen ihren Wert NUR, solange mindestens ein aktiver Subscriber besteht – ein `get(compiledStore)` ohne offenes `.subscribe()` hängt sich kurz ein und wieder aus und löst dabei JEDES MAL eine Neu-Kompilierung aus. In Komponenten `$compiledStore` (Svelte-Auto-Subscription) nutzen, nicht wiederholtes `get()` in einer Render-Schleife.

**Neue Erkenntnis (Phase 7):** `window.MathJax` wird im `<head>` VOR dem Laden der MathJax-Bibliothek gesetzt (`{ chtml: { displayAlign: 'left' } }`) – `MathJax.typesetPromise` existiert erst NACH dem async-Laden. In `updateHUD` (jetzt `src/App.svelte`) daher NIEMALS blind `if (window.MathJax) MathJax.typesetPromise(...)` aufrufen: das wirft (`typesetPromise is not a function`) und bricht `App.onMount` ab → die Kind-Mounts (Canvas!) werden wieder abgebaut. Korrekt: `typeof window.MathJax.typesetPromise === 'function'` prüfen, sonst `window.MathJax?.startup?.promise` nutzen, sonst nur skalieren. Siehe `src/App.svelte`.

**Stand 2026-07-20 (Settings aufgeräumt):** SpeedSlider aus Grundeinstellungen-Tab entfernt, "Pieces drehen" + "Fliegende Transparenz" in Animations-Tab verschoben, "Zoom" unter "Ziel-Darstellung" gruppiert, "Kompaktierung" (nicht mehr existent) aus UI entfernt. Remote-Steuerung: SpeedSlider + Zeitregler volle Breite, Tastatur-Buttons (⏮ ← → ⏭ ↩ − +) hinzugefügt. Panel-Öffnungszone auf 153px angepasst. Slider-Drag hält Panel offen.

**Stand 2026-07-20 (TODO.md-Abarbeitung, Vormittag):** Beschriftung der Ziel-Quadrate (Formel unten/ausgerechneter Wert links, `showLabels`), Flug-Animation-Abschaltung ab konfigurierbarer Geschwindigkeit (`flightAnimSpeedThreshold`, kein Compile-Impact), Intro-Screen (nicht-blockierend, Play-Trigger) - alle drei in `docs/DONE.md` dokumentiert.

**Stand 2026-07-20 (Beschriftung, Nachmittag):** die Achsen-Beschriftung nutzt jetzt ECHTES, gecachtes MathJax statt eines Hand-Nachbaus (`docs/Beschriftung.md`, `docs/DONE.md` "Beschriftung: echtes, gecachtes MathJax") - `@mathjax/src` als neue, aber nur dynamisch importierte Laufzeit-Abhängigkeit (`src/lib/mathJaxRenderer.js`), zwei Cache-Ebenen (In-Memory + IndexedDB, `mathJaxLabelCache.js`/`mathJaxImageCache.js`), kein Fallback-Renderer. Zahlentafel (HUD) bleibt beim eigenen Renderer (`mathCanvasRenderer.js`, jetzt nur noch `layoutScript`/`drawScript`). Alle offenen Punkte aus `docs/Beschriftung.md` sind abgehakt.

**Nächster Schritt:** Offen: Phase 6 (Politur), Virtual-Canvas/Multi-Viewport-Konzept (TODO.md, noch nicht begonnen), `RemoteControl` als foldbare Route (TODO.md "Fernsteuerung/Connection"). Rename "Auto-Zoom → Ziel-Darstellung" abgeschlossen (Commits `2c25bd7`, `7173ee7`, `91ad785`), live auf `gh-pages`.

**Stand 2026-07-23 (Bugfix Basiswechsel):** `updateDynamicLayout()`-Cache in `TargetBankCanvas.svelte` invalidierte sich nur bei geändertem `t_AB` - ein Basiswechsel im Zustand "Flächentreu" (`t_AB` bleibt konstant 0) ließ die Ziel-Schalen in den Breiten der alten Basis stehen. Fix: `_lastLayoutT_AB` wird jetzt zusätzlich bei jeder `compileRelevantKey`-Änderung zurückgesetzt (siehe AGENTS.md GOTCHA #12). Per Playwright-Screenshot gegen einen frischen Dev-Server verifiziert (Basis 10→2 in Flächentreu: Ziel-Quadrat schrumpft jetzt sichtbar). Commits `eb5a060` (Fix), `4cad2e5` (Handover).

## 8. Deployment: GitHub Pages (committeter Build, kein CI)

Nur die **statische Demo ohne Relay/Fernsteuerung** (kein Server, kein
`API_KEYS`). Für den Exponat-Betrieb (embedded Relay, QR-Fernsteuerung,
Docker/Tailscale) siehe stattdessen `docs/DEPLOYMENT.md`.

**Stand 2026-07-16:** GitHub Pages läuft über **Branch-Deploy** (`gh-pages`, `legacy`), nicht über GitHub Actions. Grund: pnpm 11.13 blockiert `pnpm install` bei esbuild-Build-Scripts (`ERR_PNPM_IGNORED_BUILDS`) — der ursprüngliche `build_type: workflow` (`.github/workflows/deploy-pages.yml`) schlug in CI daher dauerhaft fehl. Gelöst durch lokalen Build + committetes `dist/`.

- **Live-URL:** `https://thoka.github.io/sqrt2/` (Vite `base: '/sqrt2/'` via `GITHUB_PAGES=true`).
- **Workflow:** `scripts/deploy-pages.sh` baut lokal (`GITHUB_PAGES=true pnpm build`), kopiert `dist/`-Inhalt als Repo-Root in einen frischen `gh-pages`-Branch (orphan) und pusht `--force`. Danach zurück zu `master`. Pages liefert den Branch-Root aus.
- **Wichtig:** `gh-pages` enthält NUR die Build-Artefakte (kein Source). Nie per Hand dort arbeiten.
- **pnpm-Bug-Fix (relevant für ALLE lokalen Befehle):** statt `onlyBuiltDependencies` (wird von pnpm 11.13 bei der *Ausführung* ignoriert) steht in `pnpm-workspace.yaml` jetzt `allowBuilds: { esbuild: true }`. Damit laufen `pnpm install`/`pnpm check`/Pre-Commit-Hook wieder sauber durch.

## 9. Lokale Port-Isolation (mehrere Klone/Worker auf einem Host)

**Stand 2026-07-16:** Auf einem Host laufen oft mehrere geklonte Repos (oder versehentlich zwei Worker im selben Repo) parallel — feste Ports (Vite 4173/5200, Relay 8080) kollidieren. Gelöst über mise/direnv:

- `scripts/init-local-ports.sh` vergibt **einmalig** (idempotent) pro Klon zufällige, getrennte Ports: `RELAY_PORT` (8100–8199), `PORT` (4200–4299, Vite preview), `DEV_PORT` (5200–5299, Vite dev) → schreibt `.ports.local.env` (gitignored).
- `mise.toml` `[env]` lädt `.ports.local.env` (`_.file`, dotenv-Typ) und setzt Fallbacks (`8080`/`4173`). Beim `cd` (direnv → `mise hook-env`) stehen die Ports automatisch im PATH.
- `vite.config.js` proxiet `/api`+`/ws` auf `RELAY_PORT`; `scripts/relay-dev.sh` nutzt `RELAY_PORT`; `scripts/serve.sh` nutzt `DEV_PORT` (dev) / `PORT` (preview); Playwright (`playwright.config.js`) nutzt `port: 0` (echt zufällig) + `reuseExistingServer: false`, damit zwei parallele E2E-Runs nicht denselben fremden Server nehmen.
- **Workflow für neuen Klon:** `git clone … && cd sqrt2-gh && ./scripts/init-local-ports.sh && direnv allow`. Danach laufen Relay/Vite automatisch auf klon-eindeutigen Ports.
- **Empfehlung:** Zwei Worker im *selben* Repo bleiben vermeiden (teilen Relay-State) — lieber ein zweites Klon.

## 5. Explizite Nicht-Ziele / Abgrenzung

- `bank-core.js` wird **nicht** angefasst - bleibt die geteilte, framework-agnostische Quelle für beide Tools.
- `selection_strategy_prototype.html` (Test-Tool) ist **out of scope** für diesen Umbau (siehe Abschnitt 6) - bleibt vorerst vanilla.
- Kein neuer Server/Backend in dieser Phase - nur `BroadcastChannel` (ein Rechner, mehrere Fenster/Tabs). Echte Geräte-Fernsteuerung (separates Backend, QR-Code) ist ein SPÄTERER Schritt, schon in README Abschnitt 11 vermerkt, hier nicht mit umzusetzen.
- Visuelle/Animations-Themen (C¹-Stetigkeit für Z/R-Modi, Kompaktierung im Haupttool) sind unabhängig davon und **nicht** Teil dieses Umbaus - nicht vermischen.

## 6. Offene Fragen

- **Svelte 5 (Runes) oder Svelte 4?** Entschieden: **Svelte 5** (`^5.56.5`, aktuell zum Zeitpunkt der Umsetzung, Juli 2026 - `next`-Dist-Tag von npm zeigt keine Svelte-6-Vorabversion, Svelte 5 bleibt die aktuelle Major-Version). Neuanlage, kein Migrationsdruck.
- **TypeScript oder plain JS?** Entschieden: **plain JS**, für Konsistenz mit `bank-core.js`/`smoothing.js`/`sqrt2.html` (keine JSDoc-Typannotationen im restlichen Projekt, siehe Kommentar-Konvention in `src/lib/compiler.js`).
- **Vite-Version:** Bewusst **`vite@^7.3.6`** gewählt statt `8`: `@sveltejs/vite-plugin-svelte@^6.2.4` unterstützt `vite@^6.3.0 || ^7.0.0` und bleibt auf der klassischen Rollup/esbuild-Pipeline. Vite 8s Rolldown-Umstellung ist ein Architekturwechsel, der über den eigentlichen Bedarf hinausgeht. Bei künftiger Aktualisierung gesondert prüfen (Rolldown-Migrationsleitfaden: <https://vite.dev/guide/migration>).
- **Testing-Setup für Svelte-Komponenten:** `vitest` + `jsdom`, gemäß offizieller Svelte-5-Empfehlung (kein zusätzliches `@testing-library/svelte` nötig - Svelte exportiert `mount`/`unmount`/`flushSync` direkt für Komponenten-Tests, siehe `src/App.test.js`). Läuft als zweiter Test-Schritt in `pnpm test`, neben dem bestehenden `node --test` für reine Logik-Module.
- **Soll `selection_strategy_prototype.html` mittelfristig auch migriert werden**, oder bleibt es dauerhaft vanilla (eigenständiges Test-Tool, kein Bedarf an austauschbaren Widgets)? Weiterhin offen, keine Entscheidung nötig, um mit dem Haupttool weiterzumachen.
- **Namensgebung/URLs der neuen Einstiegspunkte** (z.B. `/control.html`, `/display.html`)? `svelte-smoke.html` (Phase 0) ist nur ein Wegwerf-Kandidat für den Smoke-Test - Namensgebung für `MainApp`/`RemoteControl`/`RestDisplay` bleibt für Phase 3/4 offen.
- **Channel-Name für `BroadcastChannel` statisch oder konfigurierbar** (falls später mehrere Exponate im selben Netz laufen)? Für den Erstwurf: statisch, siehe README-Hinweis zur Mehrbildschirm-Vision.

## 7. Noch nicht spezifiziert (bewusst offen gelassen)

- Exaktes visuelles Design des 4×4-Grid-Rest-Widgets (Layout-Details, wie mehr als 16 Stücke pro Ziffern-Stelle dargestellt werden, Farbgebung analog zu `COLORS` in `sqrt2.html`).
- Welche weiteren Rest-Anzeige-Modi über die zwei genannten hinaus geplant sind ("wir werden unterschiedliche Modi ausprobieren" - noch keine Liste).
- Genaue Aufteilung von `<TickTimeline>` (eigene Komponente vs. Teil von `<ControlPanel>`).
