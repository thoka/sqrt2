# AGENTS.md - Kurzübersicht für Agents

Kondensat aus `CLAUDE.md` + `TOOLING_SPEC.md`. Bei Unsicherheit die
vollständig lesen - hier nur das Nötigste.

## Architektur

- `sqrt2.html`: **dünne Shell** - mountet Svelte-Komponenten, hält `SETTINGS`-
  Array (URL-Sync), Zahlentafel (`updateHUD`) + Playback-Brücke. Kein
  Canvas-Rendering mehr hier.
- Canvas + rAF-Loop + Auto-Zoom/Kompaktierung: `TargetBankCanvas.svelte`
  (Port von `renderFrame()`). Rest-Widgets (austauschbar):
  `RestCounterBars.svelte` / `RestCounterGrid.svelte`. UI:
  `ControlPanel.svelte` / `PlaybackBar.svelte`. Zweiter Entry:
  `remote-control.html` + `RemoteControl.svelte` (nur Steuerung, Sync via
  BroadcastChannel).
- Stores (`src/lib/stores.js`): `configStore`/`playbackStore` (writable,
  synchronisiert), `compiledStore` (derived → `compileSystem`),
  `displayStore` (lokaler UI-State, NICHT synchronisiert). URL-Sync:
  `src/lib/urlState.js`. Geteilte Logik: `bank-core.js`, `smoothing.js`.

## Build / Test / Run

```bash
pnpm install      # pnpm (NICHT npm), siehe unten
pnpm dev          # Vite-Dev-Server (live-reload)
pnpm build        # -> dist/sqrt2.html (+ assets)
pnpm test         # node --test *.test.js  +  vitest run
pnpm check        # Qualitäts-Gate: svelte-check && eslint . && knip --dependencies
pnpm test:env     # Umgebungs-Check (Node/pnpm/Chromium headless)
pnpm test:e2e     # Playwright-E2E über dist/ (3 Tests)
```

- **pnpm-only:** `package-lock.json` ist entfernt + gitignored; `pnpm-lock.yaml`
  ist committet. CI (`.github/workflows/deploy-pages.yml`) nutzt pnpm + Node 22.
- **CLI im PATH:** `mise.toml` blendet `node_modules/.bin` per `[env] _.path`
  ein → `vite`/`playwright`/`svelte-check`/`eslint`/`knip` direkt nutzbar
  (nicht nur `pnpm exec`). Einmalig `mise trust mise.toml` nötig.
- **`pnpm check`** ist das Gate (CI läuft es vor `test`/`build`).
- **E2E möglich:** Playwright + Chromium laufen (`~/.cache/ms-playwright`).

## Regeln

- **Commit (Feature-Branch):** auf Feature-Branch nach jeder abgeschlossenen
  Arbeitsphase **immer committen** (auch ohne Einzel-Aufforderung). Nur die
  phasen-zugehörigen Dateien (`git add` einzeln, nicht `-A`), Message kurz im
  Repo-Stil. Nicht pushen/amenden, keine leeren Commits, keine Secrets.
- **Stetige Ableitung (C¹)** für ALLE automatisierten Bewegungen →
  `smoothing.js`. Exakt/ohne Verzögerung: `buildMonotoneSpline()`. Mehrere
  ordnungs-invariante Werte: `computeSegmentBlend()`. Träge Folge (Kamera/Zoom):
  `buildDampedFilter()`.
- **Layout-Umordnung:** masse-/trägheitsgewichtet (größte Gruppe = Anker), KEIN
  Förderband/Prefix-Sum.

## GOTCHAS

1. **Toter SYSTEM-C-Block** in `sqrt2.html` (`renderFrame()`/`resizeCanvas()`/
   `applyPlayback()`/`loop()`) ist uncalled - beim Editieren NICHT reaktivieren,
   beim Aufräumen entfernen. Lebendig: `TargetBankCanvas.svelte`.
2. **`compiledStore` hat KEIN `depth`** - Array-Längen über `configStore.depth`
   (Alias N_MAX) holen.
3. **derived-Caching:** `compiledStore` cached NUR bei aktivem Subscriber. In
   Komponenten **`$compiledStore`** nutzen, nicht wiederholtes `get()` in der
   Render-Schleife (sonst kompiliert jeder Frame neu).
4. **`displayStore` ist lokal** - neue geteilte Zustände über
   `configStore`/`playbackStore`, nicht `displayStore`.
5. **`SETTINGS`-Array:** neue Größe = EIN Eintrag `{ key, phase, get(), set(v) }`
   in `sqrt2.html`; nie wieder vier parallele Listen.
6. **Vite 8:** bewusst auf `vite@7` geblieben (Rolldown-Architekturwechsel).
   Wechsel = eigener Branch + frische Evaluierung (`@sveltejs/vite-plugin-
   svelte` 6→7 nötig), nicht hier mischen.

## Frischer Start - Stolpersteine

- `mise trust mise.toml` einmalig (sonst wird `[env]`-PATH ignoriert).
- **E2E stale dist:** `playwright.config.js` nutzt `reuseExistingServer: true`.
  Ein aus einem früheren Run noch laufender `vite preview` serviert ALTEN Build
  → neue Entries (z.B. `remote-control.html`) als 404. Vor `pnpm test:e2e`
  nach Rebuild: `pkill -f "vite preview"` (oder `reuseExistingServer: false`).
- Offene Reste: toter SYSTEM-C-Block (GOTCHA 1); ungenutzte `GLOBAL_*`-Ports in
  `TargetBankCanvas.svelte` (nur ESLint-Warnungen); Phase 6 (Politur) offen.

## Migration

`TOOLING_SPEC.md` = lebendiges Doc (Phasen 0-5 erledigt; Phase 6 Politur offen).
Nach jedem Schritt dort Status + "Nächster Schritt" aktualisieren.
