# AGENTS.md - Kurzübersicht für Agents

Kondensat aus `CLAUDE.md` (detaillierte Agentenregeln) + praktische Gotchas
aus der Svelte-Migration. Bei Unsicherheit `CLAUDE.md` und `TOOLING_SPEC.md`
voll lesen - hier nur das Nötigste zum schnellen Einstieg.

## Architektur (Stand: Phasen 0-4 erledigt)

- `sqrt2.html` ist nur noch eine **dünne Shell**: mountet Svelte-Komponenten,
  hält das `SETTINGS`-Array (URL-Sync), die Zahlentafel (`updateHUD`) und die
  Playback-Brücke für die Zahlentafel. **Kein Canvas-Rendering mehr hier.**
- Canvas + rAF-Loop + Auto-Zoom/Kompaktierung: `src/components/TargetBankCanvas.svelte`
  (Port von `renderFrame()`). Rest-Widgets (austauschbar): `RestCounterBars.svelte`
  / `RestCounterGrid.svelte`. UI: `ControlPanel.svelte` / `PlaybackBar.svelte`.
- Stores in `src/lib/stores.js`: `configStore`/`playbackStore` (writable),
  `compiledStore` (derived, ruft `compileSystem` aus `src/lib/compiler.js`),
  `displayStore` (Lokaler UI-State - **bewusst NICHT** über BroadcastChannel
  synchronisiert; nur config/playback sind der geteilte Zustand, siehe
  `TOOLING_SPEC.md` §3.1).
- URL-Sync: `src/lib/urlState.js`. Gemeinsame Logik: `bank-core.js`,
  `smoothing.js` (von beiden HTML-Tools per ES-Modul importiert).

## Build / Test / Run

```bash
npm install
npm run dev      # Vite-Dev-Server, URL im Browser öffnen (live-reload)
npm run build    # -> dist/sqrt2.html (+ assets), direkt im Browser öffnen
npm test         # node --test *.test.js  (reine Logik)
                  #   +  vitest run       (Svelte-Komponenten, jsdom)
```

- **Visuelle Verifikation in DIESER Sandbox MÖGLICH:** Playwright + Chromium
  laufen (globaler Cache `~/.cache/ms-playwright`). `pnpm test:e2e` (3 Tests)
  grün. `npm run build` + `npm test` (Unit) bleiben Basis-Gate.
- **E2E-Test:** `pnpm test:e2e` deckt Canvas-Rendering + Rest-Widget +
  BroadcastChannel-Sync ab (siehe `e2e/sqrt2.e2e.test.js`).
- Branches: Arbeit auf `main` (Migration `migrate-to-svelte` abgeschlossen).
- **Commit-Regel (Feature-Branch):** befinden wir uns in einem Feature-Branch
  (nicht `main`/`master`), ist nach Abschluss einer abgeschlossenen
  Arbeitsphase **immer zu committen** - auch ohne explizite Einzel-Aufforderung.
  Eine "Arbeitsphase" ist z.B. eine fertige Migration-Phase (TOOLING_SPEC §4),
  ein abgeschlossenes Feature oder eine gefixt-gewesene Test-Suite. Commit
  umfasst nur die zur Phase gehörenden Dateien (kein `git add -A` über
  unzusammenhängende Änderungen); Message kurz und im Repo-Stil (siehe
  `git log`). Nicht pushen, nicht amenden, keine leeren Commits - und keine
  Secrets/Keys committen.

## GOTCHAS (spart einem nächsten Agenten Zeit)

1. **Toter Code in `sqrt2.html`:** der ursprüngliche SYSTEM-C-Renderblock
   (`renderFrame()`, `resizeCanvas()`, `applyPlayback()`, `loop()`) ist seit
   Phase 4a noch als **uncalled/toter Code** vorhanden (sicher, weil nie
   aufgerufen). Beim Editieren von `sqrt2.html` NICHT re-aktivieren; beim
   Aufräumen einfach entfernen. Der lebendige Render-Pfad ist
   `TargetBankCanvas.svelte`.
2. **`compiledStore` hat KEIN `depth`-Feld.** Für Array-Längen `configStore.depth`
   (Alias N_MAX) nutzen - ein früherer Bug (RestCounterBars) kam daher.
3. **derived-Store-Caching-Pitfall:** `compiledStore` (derived) cached seinen
   Wert NUR bei mindestens einem aktiven Subscriber. Ein `get(compiledStore)`
   OHNE offenes `.subscribe()` löst JEDES MAL neu kompilieren aus. In
   Svelte-Komponenten daher **`$compiledStore` (Auto-Subscription)** nutzen,
   NICHT wiederholtes `get()` in einer Render-Schleife (sonst kompiliert jeder
   Frame neu).
4. **`displayStore` ist lokal, nicht synchronisiert** - bei neuen geteilten
   Zuständen `configStore`/`playbackStore` verwenden, nicht `displayStore`.
5. **Tooling-Version & Paketmanager:**
    - **Vite:** `vite@7` (aktuell `7.3.6` in package.json). Migration auf Svelte
      erledigt; Vite 8/Rolldown-Sprung steht nicht mehr an - bei Bedarf auf
      neuer Instanz neu bewerten (`TOOLING_ENV_SPEC.md`).
    - **Paketmanager:** **pnpm** (bewusste Lern-/Ausrichtungsentscheidung,
      Discourse-Stack). `pnpm-lock.yaml` + `pnpm-workspace.yaml` vorhanden;
      `package-lock.json` ist Legacy-Rest, kann entfernt werden.
    - **Toolchain-Pinning:** `node` (22) + `pnpm` (11) sind deklarativ in
      `mise.toml` gepinnt; `.envrc` aktiviert sie via `mise`/`direnv`
      automatisch beim Betreten des Repos. `scripts/setup-env.sh` installiert
      `mise`+`direnv` und läuft `mise install` - kein manuelles corepack/
      Global-Install mehr.
6. **`SETTINGS`-Array:** neue einstellbare Größe = EIN neuer Eintrag
   `{ key, phase, get(), set(v) }` in `sqrt2.html`; nie wieder vier parallele
   Listen pflegen (`bindEl()` für input/select/checkbox, `phase:'pre'` vor
   bzw. `phase:'post'` nach `compileSystem()`).

## Hart erkämpfte Regeln (Details in CLAUDE.md, hier nur die Faustregel)

- **Stetige Ableitung (C¹)** für ALLE automatisierten Bewegungen →
  `smoothing.js` nutzen, nicht Ad-hoc-Kernel neu erfinden.
  - Wert an jedem Stützpunkt exakt/ohne Verzögerung (Sicherheitsgarantie) →
    `buildMonotoneSpline()`.
  - MEHRERE abhängige Werte mit Ordnungs-Invariante (keine Überlappung) →
    `computeSegmentBlend()` (+ Pinning-Wegpunkt bei Zeit-Verzögerungs-Garantie).
  - Nur träge/asymptotisch folgen (Kamera/Zoom) → `buildDampedFilter()`.
- **Layout-Umordnung mehrerer Objekte:** masse-/trägheitsgewichtet (größte
  Gruppe = Anker, bleibt fix), KEIN Förderband/Prefix-Sum.

## Migrations-Spezifikation

`TOOLING_SPEC.md` ist das lebendige Doc (Phasen 0-5, Stand je Step). Nach
JEDEM erledigten Schritt dort den Status + "Nächster Schritt" aktualisieren.
Phase 5 (BroadcastChannel-Sync-Adapter + zweiter Vite-Entry `RemoteControl`)
ist der nächste Schritt. `TOOLING_ENV_SPEC.md` ergänzt um die Tooling-
Philosophie (Konservativ vs. Lern-Horizont/Discourse) + die Planung der neuen
Coding-Instanz (arch/cachedos, Playwright).
