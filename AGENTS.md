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
pnpm install      # pnpm (NICHT npm), siehe unten; aktiviert auch pre-commit-Hook
pnpm dev          # Vite-Dev-Server (live-reload)
pnpm build        # -> dist/sqrt2.html (+ assets)
pnpm test         # node --test *.test.js  +  vitest run
pnpm check        # Qualitäts-Gate: svelte-check && eslint . && knip --dependencies && prettier --check .
pnpm format       # Prettier --write .  (Formatierung, nutzt prettier-plugin-svelte)
pnpm format:check # Prettier --check .  (nur Prüfung, Teil von pnpm check)
pnpm test:env     # Umgebungs-Check (Node/pnpm/Chromium headless)
pnpm test:e2e     # Playwright-E2E über dist/ (3 Tests)
```

- **pnpm-only:** `package-lock.json` ist entfernt + gitignored; `pnpm-lock.yaml`
  ist committet. CI (`.github/workflows/deploy-pages.yml`) nutzt pnpm + Node 22.
- **CLI im PATH:** `mise.toml` blendet `node_modules/.bin` per `[env] _.path`
  ein → `vite`/`playwright`/`svelte-check`/`eslint`/`knip` direkt nutzbar
  (nicht nur `pnpm exec`). Einmalig `mise trust mise.toml` nötig.
- **`pnpm check`** ist das Gate (CI läuft es vor `test`/`build`); enthält jetzt
  auch `prettier --check .`. Vor Commit `pnpm format` laufen lassen, sonst
  blockt das Gate (bzw. der pre-commit-Hook).
- **Pre-commit-Hook:** `pnpm install` (bzw. `pnpm prepare`) setzt
  `core.hooksPath=scripts/git-hooks`; `scripts/git-hooks/pre-commit` führt
  `pnpm check` aus und blockt den Commit bei Fehlern. Nur mit
  `git commit --no-verify` umgehen (vermeiden).
- **E2E möglich:** Playwright + Chromium laufen (`~/.cache/ms-playwright`).

## Regeln

- **Commit ist Pflicht, kein Optional:** Ein Task / eine Arbeitsphase ist
  erst dann **abgeschlossen**, wenn er committet ist – **auch und gerade
  ohne ausdrückliche Aufforderung**. Nie die Antwort mit "ist erledigt"
  beenden, ohne vorher zu committen. Gilt für JEDE abgeschlossene
  Änderung (Bugfix, Refactor, Docs, Config). Nur die phasen-zugehörigen
  Dateien (`git add` einzeln, nicht `-A`), Message kurz im Repo-Stil.
  **Nicht** pushen/amenden, keine leeren Commits, keine Secrets.
  Qualitäts-Gate (`pnpm check`) vorzugsweise grün. Ein laufendes Feature
  muss nicht erst auf *vollständige/polierte* Tests warten – aber je Stufe
  muss mindestens ein Test existieren (siehe Regel "Tests für alle Stufen").
- **Tests für alle Stufen (Pflicht):** Jede Stufe / jeder Schritt eines
  Features bekommt eigene Tests (Unit und/oder e2e/Integration, wo
  sinnvoll). Eine Funktionsstufe ohne Tests gilt als **nicht abgeschlossen**.
  Bestehende Logik: `tests/unit/*.test.js` + `tests/e2e/*.test.js`.
  Der Connection-Service deckt seine Stufen via
  `infra/connection-service/smoke-test.mjs` ab (Plain + TLS, je 20 Checks:
  Token/Seats/PIN/Relay/Host + Status-Page/CORS/Admin-UI);
  neue Stufen erfordern neue Checks.
- **Thread-Ökonomie:** Nach Abschluss einer Arbeit (committet, Tests grün)
  einen kurzen Hinweis geben, ob es ökonomischer ist, im selben Thread
  weiterzumachen oder einen NEUEN zu beginnen (Faustregel: andere
  Dateien/Domäne + langer Verlauf → neuer Thread; direktes Aufbauen auf dem
  eben Erarbeiteten → gleicher Thread). Details in `docs/CLAUDE.md`.
- **Stetige Ableitung (C¹)** für ALLE automatisierten Bewegungen →
  `smoothing.js`. Exakt/ohne Verzögerung: `buildMonotoneSpline()`. Mehrere
  ordnungs-invariante Werte: `computeSegmentBlend()`. Träge Folge (Kamera/Zoom):
  `buildDampedFilter()`.
- **Layout-Umordnung:** masse-/trägheitsgewichtet (größte Gruppe = Anker), KEIN
  Förderband/Prefix-Sum.

## GOTCHAS

1. **`compiledStore` hat KEIN `depth`** - Array-Längen über `configStore.depth`
   (Alias N_MAX) holen.
2. **derived-Caching:** `compiledStore` cached NUR bei aktivem Subscriber. In
   Komponenten **`$compiledStore`** nutzen, nicht wiederholtes `get()` in der
   Render-Schleife (sonst kompiliert jeder Frame neu).
3. **`displayStore` ist lokal** - neue geteilte Zustände über
   `configStore`/`playbackStore`, nicht `displayStore`.
4. **`SETTINGS`-Array:** neue Größe = EIN Eintrag `{ key, phase, get(), set(v) }`
   in `sqrt2.html`; nie wieder vier parallele Listen.
5. **Vite 8:** bewusst auf `vite@7` geblieben (Rolldown-Architekturwechsel).
   Wechsel = eigener Branch + frische Evaluierung (`@sveltejs/vite-plugin-
   svelte` 6→7 nötig), nicht hier mischen.

## Frischer Start - Stolpersteine

- `mise trust mise.toml` einmalig (sonst wird `[env]`-PATH ignoriert).
- **npm blockiert:** `scripts/bin/npm` gibt Fehlermeldung aus, `.envrc` blendet
  `scripts/bin` via `PATH_add` ein. Shell-Funktionen in `.envrc` reichen NICHT
  (mise-Activation überschattet sie) - nur ein echtes Skript im PATH zuverlässig.
- **E2E stale dist:** `playwright.config.js` nutzt `reuseExistingServer: true`.
  Ein aus einem früheren Run noch laufender `vite preview` serviert ALTEN Build
  → neue Entries (z.B. `remote-control.html`) als 404. Vor `pnpm test:e2e`
  nach Rebuild: `pkill -f "vite preview"` (oder `reuseExistingServer: false`).
- **direnv evaluiert `.envrc` unter zsh `emulate sh`:** `mise activate`
  emittiert zsh/bash-Hook-Code (`autoload`/`add-zsh-hook`/`$+functions`) und
  bricht mit "command not found" / "arithmetic syntax error". In `.envrc`
  `mise hook-env` nutzen (nur `export`-Zeilen, shell-agnostisch).
- **`pkill` fehlt im PATH dieser Sandbox:** Server nicht mit
  `pkill -f "vite preview"` stoppen, sondern `scripts/serve.sh stop`
  (PID-Datei `.server.pid` + `kill`). `serve.sh` startet dev/preview/restart.
- **Vite bindet via `server.host: true` an 0.0.0.0:** Windows (WSL) erreicht
  Dev/Preview unter `localhost`; Cross-Device-Test über Tailscale
  (`<host>.<tailnet>.ts.net`) oder `scripts/serve.sh`.
- **Connection-Service:** `infra/connection-service/` — `node server.js` bzw.
  `docker compose up`; Admin-Key beim 1. Start auf der Console (persistent in
  `/data`); TLS via `tailscale cert` → `TLS_CERT`/`TLS_KEY`. Tests:
  `node smoke-test.mjs` (Plain + TLS). Spec: `docs/CONNECTION_SERVICE_SPEC.md`.
- Offene Reste: ungenutzte `GLOBAL_*`-Ports in `TargetBankCanvas.svelte`
  (nur ESLint-Warnungen); Phase 6 (Politur) offen.

## Migration

`TOOLING_SPEC.md` = lebendiges Doc (Phasen 0-5 erledigt; Phase 6 Politur offen).
Nach jedem Schritt dort Status + "Nächster Schritt" aktualisieren.
