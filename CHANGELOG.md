# Changelog

Detaillierte Implementierungsprotokolle, die aus `TOOLING_SPEC.md` ausgelagert
wurden. Die Specs selbst enthalten jetzt nur noch den aktuellen Stand + Regeln.

## Phase 0 – Svelte-Grundgerüst (2026-07-15)

`svelte` + `@sveltejs/vite-plugin-svelte` + `vitest` + `jsdom` installiert.
`svelte-smoke.html`/`src/App.svelte`/`src/main.js` als triviale, per
`pnpm run dev` UND per persistentem Vitest-Test (`src/App.test.js`, svelte
Kern-APIs `mount`/`unmount`/`flushSync`, siehe [offizielle
Svelte-5-Testing-Doku](https://svelte.dev/docs/svelte/testing)) verifizierte
Komponente.

## Phase 1 – Compiler-Extraktion (2026-07-15)

`src/lib/compiler.js` enthält die komplette bisherige `compileSystem()`-Logik
als reine Funktion (Config-Objekt rein, kompilierter Zustand raus);
`sqrt2.html`s `compileSystem()` ist nur noch ein dünner DOM-Adapter davor.
Abgesichert durch `compiler.test.js` (Determinismus, Struktur-Invarianten,
Tick↔Zeit-Monotonie, Kompaktierungs-Zweige).

## Phase 2 – Stores (2026-07-15)

`src/lib/stores.js` mit `configStore`/`playbackStore` (`writable`,
Default-Werte aus den bisherigen Input-`value`-Attributen gespiegelt) und
`compiledStore` (`derived` aus `configStore`, ruft `compileSystem()` aus
Phase 1).

## Phase 3 – Control-Panel + URL-Sync (2026-07-15)

URL-Sync (`src/lib/urlState.js`, `parseConfigFromUrl`/`parsePlaybackFromUrl`/
`buildStateParams`, abgesichert via `url-state.test.js`), `<ControlPanel>`
(gebunden an configStore, Tick-Eingabe + "Zustand teilen"-Buttons,
`ControlPanel.test.js`), `<PlaybackBar>` (Play/Pause + Zeitstrahl + Readout,
gebunden an playbackStore/compiledStore, `PlaybackBar.test.js`).

`sqrt2.html` ist auf die Stores umverdrahtet: `mount(ControlPanel/PlaybackBar)`
in die vorbereiteten Mount-Ziele,
`configStore.subscribe(applyConfig)`/`playbackStore.subscribe(applyPlayback)`
als Ersatz für die früheren `compileSystem()`-/`addEventListener`-Aufrufe;
Canvas-Rendering + rAF-Schleife bleiben vanilla (lesen die gesetzten
Modul-Scope-Variablen).

**Erkenntnis:** `derived`-Stores aus `svelte/store` cachen ihren Wert NUR,
solange mindestens ein aktiver Subscriber besteht – ein `get(compiledStore)`
ohne offenes `.subscribe()` löst JEDES MAL eine Neu-Kompilierung aus. In
Komponenten `$compiledStore` (Auto-Subscription) nutzen, nicht wiederholtes
`get()` in Render-Schleifen.

Ein Default-Wert (`lineWidth`) war in `stores.js` mit `1` statt des Original-
Regler-Defaults `0.3` hinterlegt (Verhaltensänderung) – korrigiert auf `0.3`.

## Phase 4 – Canvas + Rest-Widgets (2026-07-15)

### 4a – TargetBankCanvas

Voller Port von `renderFrame()`/Hilfsfunktionen/Loop/`applyPlayback()`/
`applyConfig()`/HUD-Lesezugriffen aus `sqrt2.html`. Die Komponente hält ihren
eigenen Render-State als lokale Variablen und füllt ihn in `onMount` +
Store-Subscriptions (`$compiledStore`/`$configStore`/`$playbackStore`).
`playbackStore` bleibt die Schnittstelle nach außen (PlaybackBar/ControlPanel
schreiben isPlaying/time, die Loop spiegelt time per
`_suppressPlaybackRender`-Guard zurück).

In `sqrt2.html`: `<canvas id="glCanvas">` → `<div id="canvasMount">`,
`<TargetBankCanvas>` per `mount()` eingehängt. `updateOutputs()` ruft nur noch
`updateHUD(u_time)`. Der alte SYSTEM-C-Renderblock ist jetzt uncalled/tot.

### 4b – RestCounterBars

Vertikale Balken-Variante des Bank-/Rest-Inventars, 1:1-Port des Balken-Teils
aus dem früheren `updateHUD()`. Liest nur lesend `<compiledStore>`
(bank_pieces/depth) + `<playbackStore.time>`. Skalierung (`updateBankPanelScale`)
wanderte mit in die Komponente (`onMount` + `resize`-Listener).

`updateHUD()` in `sqrt2.html` auf NUR die Zahlentafel l/l²/R reduziert
(Hash-Gating jetzt nur noch Step+BASE statt Step+counts+BASE).

### 4c – RestCounterGrid

NEUES horizontales 4×4-Grid-Rest-Widget (je Zelle ein Exponent k mit
proportionalem Balken + Zähler + Label, Exponenten ab k=16 als "+N"-Badge
zusammengefasst; identische Farbgebung via COLORS). Liest ebenfalls nur
lesend die Stores.

Umschaltung über `displayStore` (`src/lib/displayStore.js`, lokaler UI-State,
NICHT synchronisiert) mit einem Select in `<ControlPanel>` ("Rest-Anzeige").

## Phase 5 – BroadcastChannel-Sync (2026-07-15)

Fensterübergreifender Sync über `BroadcastChannel('sqrt2-state')`
(`src/lib/syncedStore.js`): `initSync()` bindet `configStore` + `playbackStore`
einmalig an den Kanal; `syncedStore()` umhüllt einen writable-Store so, dass
lokale `set`/`update` gepostet werden und eingehende Nachrichten per Guard-Flag
(Echo-Unterdrückung) übernommen werden.

**Handshake:** ein neu geöffneter Tab fragt per `{type:'request'}` den
aktuellen Zustand an, Peers antworten mit `{type:'state'}`; eine monoton
steigende Seq-Nummer (Lamport-artig) verhindert, dass eine frische lokale
Änderung durch den verzögerten Initial-State eines neuen Tabs überschrieben
wird.

Zweiter Vite-Entry `remote-control.html` + `src/components/RemoteControl.svelte`
(nur `<ControlPanel>` + `<PlaybackBar>`, kein Canvas/Rest-Widget) –
synchronisiert via denselben `initSync()`.

Abgesichert durch `syncedStore.test.js` (realer BroadcastChannel-Transport
zwischen zwei Stores im Node-Prozess) und E2E-Test (`e2e/sqrt2.e2e.test.js`,
zwei Tabs: sqrt2.html ↔ remote-control.html).

**Hinweis:** `playbackStore` wird frame-genau synchronisiert (jeder rAF-Schritt
postet) – für die Demo unkritisch, bei vielen/ferngesteuerten Tabs ggf. noch zu
drosseln (IRT-Entkopplung), hier bewusst nicht gemacht.

## Tooling-Entscheidungen (stand 2026-07-15)

- **Svelte 5** (`^5.56.5`), kein Svelte 4 – Neuanlage, kein Migrationsdruck.
- **Plain JS**, kein TypeScript – Konsistenz mit `bank-core.js`/`smoothing.js`.
- **Vite 7** (`^7.3.6`), bewusst nicht 8 – `@sveltejs/vite-plugin-svelte@^6.2.4`
  unterstützt `vite@^6.3.0 || ^7.0.0`; Vite 8s Rolldown-Umstellung ist ein
  unverbundener Architekturwechsel.
- **vitest + jsdom** für Svelte-Komponenten-Tests, keine Testing-Library –
  offizielle Svelte-5-Empfehlung.
- **pnpm** als Paketmanager (statt npm) – bewusste Lern-/Ausrichtungs-Entscheidung
  (Discourse-Stack), pnpm bringt bessere Reproduzierbarkeit.
