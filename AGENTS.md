# AGENTS.md - Kurzübersicht für Agents

Kondensat aus `CLAUDE.md` + `TOOLING_SPEC.md`. Bei Unsicherheit die
vollständig lesen - hier nur das Nötigste (das *Warum/Wie* lebt in CLAUDE.md).

## Architektur

- `sqrt2.html`: **dünne Shell** - mountet Svelte, hält `SETTINGS`-Array
  (URL-Sync), Zahlentafel (`updateHUD`) + Playback-Brücke. Kein Canvas hier.
- Canvas + rAF-Loop + Auto-Zoom/Kompaktierung: `TargetBankCanvas.svelte`
  (Port von `renderFrame()`). Rest-Widgets austauschbar:
  `RestCounterBars.svelte` / `RestCounterGrid.svelte`. UI:
  `ControlPanel.svelte` / `PlaybackBar.svelte`. Zweiter Entry:
  `remote-control.html` + `RemoteControl.svelte` (Sync via BroadcastChannel).
- Stores (`src/lib/stores.js`): `configStore`/`playbackStore` (writable,
  synchronisiert), `compiledStore` (derived → `compileSystem`),
  `displayStore` (lokal, NICHT synchronisiert). URL-Sync:
  `src/lib/urlState.js`. Geteilte Logik: `bank-core.js`, `src/lib/smoothing.js`.

## Build / Test / Run

```bash
pnpm install      # pnpm (NICHT npm); aktiviert pre-commit-Hook
pnpm dev          # Vite-Dev-Server
pnpm build        # -> dist/sqrt2.html (+ assets)
pnpm test         # node --test *.test.js  +  vitest run
pnpm check        # Gate: svelte-check && eslint . && knip --dependencies && prettier --check .
pnpm format       # Prettier --write .  (vor Commit laufen lassen)
pnpm test:e2e     # Playwright-E2E über dist/ (3 Tests)
```

- **Immer `pnpm`, nie npm** (`package-lock.json` entfernt; `pnpm-lock.yaml`
  committet; CI nutzt pnpm + Node 22).
- **`pnpm check` = Gate** (pre-commit-Hook + CI). Vor Commit `pnpm format`,
  sonst blockt es. Hook umgehen nur via `git commit --no-verify` (vermeiden).
- `mise.toml` blendet `node_modules/.bin` ein → CLI direkt nutzbar; einmalig
  `mise trust mise.toml`.

## Regeln

- **Commit ist Pflicht:** Eine Arbeitsphase ist erst *abgeschlossen*, wenn sie
  committet ist - auch ohne Aufforderung. Nie mit "ist erledigt" enden ohne
  vorherigen Commit. Betrifft JEDE Änderung (Bugfix, Refactor, Docs, Config).
  Nur phasen-zugehörige Dateien (`git add` einzeln, nicht `-A`), Message kurz
  im Repo-Stil. **Nicht** pushen/amenden, keine leeren Commits, keine Secrets.
- **Tests für alle Stufen:** Jede Stufe eines Features braucht eigene Tests
  (Unit und/oder e2e). Stufe ohne Tests = nicht abgeschlossen.
  Logik: `tests/unit/*.test.js` + `tests/e2e/*.test.js`. Connection-Service
  (embedded Relay, `server/relay/`): `tests/relay/test-api.mjs` +
  `test-connection.mjs` (REST- + WebSocket-Tests; neue Stufen → neue).
- **Thread-Ökonomie:** Nach Abschluss einer Arbeit einen kurzen Hinweis
  geben, ob gleicher oder neuer Thread ökonomischer ist (andere Domäne +
  langer Verlauf → neuer; direktes Aufbauen → gleicher). Details in CLAUDE.md.
- **Stetige Ableitung (C¹)** für ALLE automatisierten Bewegungen →
  `smoothing.js`: exakt/`buildMonotoneSpline()`, ordnungs-invariant/
  `computeSegmentBlend()`, träge/`buildDampedFilter()`.
- **Layout-Umordnung:** masse-/trägheitsgewichtet (größte Gruppe = Anker),
  KEIN Förderband/Prefix-Sum.

## GOTCHAS (repo-weit)

1. **`compiledStore` hat KEIN `depth`** - Array-Längen über `configStore.depth`
   (Alias N_MAX).
2. **derived-Caching:** nur bei aktivem Subscriber. In Komponenten
   **`$compiledStore`** nutzen, nicht `get()` in der Render-Schleife.
3. **`displayStore` ist lokal** - neue geteilte Zustände über
   `configStore`/`playbackStore`.
4. **`SETTINGS`-Array:** neue Größe = EIN Eintrag
   `{ key, phase, get(), set(v) }` in `sqrt2.html`; nie vier parallele Listen.
5. **Vite:** bewusst `vite@7` (kein Rolldown-Wechsel). Upgrade = eigener
   Branch + `@sveltejs/vite-plugin-svelte` 6→7.
6. **Connection-Service:** Relay als Bibliothek `createRelay()` in
   `server/relay/server.js`, embedded im Exponat-Server `server/index.js`
   (Statics + `/api`/`/ws`, ein Origin, kein CORS). Start: `pnpm serve` bzw.
   `docker compose -f deploy/docker-compose.yml up`; Admin-Key beim 1. Start auf Console (persistent
   `/data`); TLS via `tailscale cert` → `TLS_CERT`/`TLS_KEY`. Spec:
   `docs/CONNECTION_SERVICE_SPEC.md`.

## Stolpersteine (nur diese Sandbox)

- `mise trust mise.toml` einmalig (sonst wird `[env]`-PATH ignoriert).
- **npm blockiert:** `scripts/bin/npm` gibt Fehler aus; `.envrc` blendet
  `scripts/bin` per `PATH_add` ein (Shell-Funktionen reichen nicht).
- **E2E stale dist:** `playwright.config.js` nutzt `reuseExistingServer:true`;
  laufender `vite preview` serviert alten Build → `remote-control.html` als
  404. Vor `pnpm test:e2e` Rebuild + `scripts/serve.sh stop`.
- **direnv zsh `emulate sh`:** in `.envrc` `mise hook-env` nutzen (nur
  `export`-Zeilen), nicht `mise activate`.
- **`pkill`/Server-Stop:** hier kein `pkill` im PATH → `scripts/serve.sh
  stop` (PID-Datei) statt `pkill -f "vite preview"`.
- Vite bindet via `server.host:true` an 0.0.0.0: Windows/WSL unter
  `localhost`; Cross-Device via Tailscale (`<host>.<tailnet>.ts.net`).
- Offene Reste: ungenutzte `GLOBAL_*` in `TargetBankCanvas.svelte` (nur
  ESLint-Warnungen); Phase 6 (Politur) offen.

## Migration

`TOOLING_SPEC.md` = lebendiges Doc (Phasen 0-5 erledigt; Phase 6 Politur
offen). Nach jedem Schritt dort Status + "Nächster Schritt" aktualisieren.
