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
  `src/lib/urlState.js`. Geteilte Logik: `src/lib/bank-core.js`, `src/lib/smoothing.js`.

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
- **Playwright-E2E muss funktionieren:** Keine Arbeit an Renderer/Canvas/Zoom
  ohne funktionierendes Playwright. Wenn `pnpm test:e2e` hängt oder fehlschlägt,
  ist das das ERSTE Problem das gelöst wird. Root-Cause + Fix in
  `docs/E2E-PLAYWRIGHT-SPEC.md` (gelöst): diese Sandbox (WSL2 mit gespiegeltem
  Networking, z.B. für Tailscale) liefert für Verbindungen zu geschlossenen
  Loopback-Ports kein RST/ECONNREFUSED, sondern hängt auf SYN-SENT.
  Playwrights `config.webServer`-Verfügbarkeitscheck setzt dafür keinen
  Socket-Timeout und hängt ewig, bevor der Server-Prozess überhaupt startet.
  Fix: kein `webServer` in `playwright.config.js`, stattdessen
  `globalSetup: tests/e2e/global-setup.js` startet den Preview-Server selbst
  und pollt mit `fetch()` + `AbortSignal.timeout` (bricht zuverlässig ab statt
  auf den TCP-Fehler zu warten).
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
- **Zahlentafel l/l²/R aus der Simulation, nicht selbst hergeleitet:**
  `l` wird direkt aus den **Stellen der Simulation** abgelesen (Achsen/Ziffern
  der Bank, nicht aus einer eigenen Umrechnung hochgerechnet); `R` ergibt sich
  direkt aus der **Zählung des Rests** (sichtbare Bank-Flächen / noch nicht
  entnommene Stücke). Keine parallele, selbst gebaute Ableitung, wenn die
  Simulation die Werte schon kennt.
- **Canvas/DOM nie nur per Unit-Test verifizieren:** jede Änderung an
  Mount-/Render-Pfaden braucht `pnpm build` + E2E (Test "Canvas zeigt zwei
  weisse Quadrate") - ein JS-Fehler im Mount-Pfad crashat die ganze Seite und
  bleibt in node-Tests unsichtbar.

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
7. **pnpm 11.13 esbuild-Bug:** `onlyBuiltDependencies` wird bei der
   *Ausführung* ignoriert → `pnpm install` exitet 1 (`ERR_PNPM_IGNORED_BUILDS`).
   Fix steht in `pnpm-workspace.yaml`: `allowBuilds: { esbuild: true }`.
   Nicht zurück zu `onlyBuiltDependencies` ändern.
8. **GitHub Pages = Branch-Deploy (`gh-pages`, legacy), KEIN CI.** pnpm-Bug
   (s.o.) ließ den Actions-Workflow dauerhaft fehlschlagen. Neuer Stand via
   `GITHUB_PAGES=true pnpm build` + `./scripts/deploy-pages.sh`. Live:
   `https://thoka.github.io/sqrt2/`.
9. **Fixe Float-Schwellen in `bank-core.js`/`recursive-layout.js` sind
   verdächtig:** zwei reale Bugs (Tiefe 30, siehe `REST-PRECISION-PLAN.md`
   "Stand 2026-07-18") kamen von festen `1e-9`-Konstanten, die auf mit der
   Tiefe schrumpfende Größen (`w`/`h`, Bounding-Box) angewendet wurden - ab
   `k≈9` wird die Schwelle größer als die verglichenen Werte selbst. Vor
   einer neuen Konstante dieser Art: (1) schrumpft der verglichene Wert mit
   `k`/Tiefe? (2) gibt es eine exakte, tiefenunabhängige Alternative
   (Integer-Zähler wie `k_v`/`k_h`, oder ist der Floor durch einen
   vorhandenen Guard ohnehin überflüssig)? Reine Divisionsketten (`w`/`h`
    selbst) sind NICHT betroffen (präzise bis `k≈300` bei Basis 10).
10. **Recompile nur bei compile-relevanten Feldern:** `compileOrchestrator.js`
    hat auf JEDE `configStore`-Änderung einen frischen Compile-Job
    gestartet (`runJob`). Reine Laufzeit-Felder (`playSpeed`,
    `autoZoomMinPx`, `lineWidth`, `pauseDuration`, `modeAB`) dürfen
    KEINEN teuren Recompile auslösen. Fix: `compileOrchestrator`
    vergleicht einen `compileRelevantKey` (base/depth/transformMode/
    bankZoomThresholdPowers/zoomSpeedCoef/compactionEnabled/
    compactionTransitionTicks) und startet den Job nur bei Änderung
    eines dieser Felder. Beim Hinzufügen eines neuen config-Felds, das
    den Compile beeinflusst: es in `compileRelevantKey` eintragen,
    sonst wird es ignoriert (stiller Fehler).

## Stolpersteine (nur diese Sandbox)

- `mise trust mise.toml` einmalig (sonst wird `[env]`-PATH ignoriert).
- **npm blockiert:** `scripts/bin/npm` gibt Fehler aus; `.envrc` blendet
  `scripts/bin` per `PATH_add` ein (Shell-Funktionen reichen nicht).
- **E2E Server:** `playwright.config.js` nutzt `vite preview --port 4173
  --strictPort` + `use.baseURL: http://localhost:4173/`. Vor `pnpm test:e2e`
  IMMER frisch bauen (`pnpm build`), sonst testet Playwright gegen alten
  Stand. (Früher `--port 0` + fehlende baseURL → Timeout/invalid URL.)
- **Zoom/Präzision bei hoher Tiefe:** `p.x`/`p.y` (absolut) sind ab Tiefe ~15
  durch Float-Auslöschung unzuverlässig (z.B. anchor.x = 7.5 statt 0.6). Die
  Bank-Zoom-Bounding-Box baut daher KOMPLETT relativ zum Anker über
  `localOffsetX/Y` (ganzzahlige Rasterindizes) + `relativePosition()` -
  KEINE absoluten `p.x` im Zoom-Pfad verwenden. Siehe
  `docs/REST-PRECISION-PLAN.md`.
- **direnv zsh `emulate sh`:** in `.envrc` `mise hook-env` nutzen (nur
  `export`-Zeilen), nicht `mise activate`.
- **Lokale Ports:** pro Klon einmalig `./scripts/init-local-ports.sh`
  ausführen → `.ports.local.env` (gitignored) mit `RELAY_PORT`/`PORT`/
  `DEV_PORT`. mise/direnv setzt sie automatisch im PATH. Mehrere Klone auf
  einem Host kollidieren sonst (Vite 4173/5200, Relay 8080).
- Vite bindet via `server.host:true` an 0.0.0.0: Windows/WSL unter
  `localhost`; Cross-Device via Tailscale (`<host>.<tailnet>.ts.net`).
- Offene Reste: ungenutzte `GLOBAL_*` in `TargetBankCanvas.svelte` (nur
  ESLint-Warnungen); Phase 6 (Politur) offen.
- **`tests/unit/compiler-split.test.js` hängt (Timeout 124):** die
  Config-Matrix nutzt base 16 / depth 15 → Stückzahl explodiert (16^15),
  schon im Original-Code reproduzierbar, NICHT durch eigene Änderungen
  verursacht. Bei `node --test tests/unit/*.test.js` diese Datei ausschließen
  (oder die Matrix deckeln), sonst blockiert die ganze Suite.

## Migration

`TOOLING_SPEC.md` = lebendiges Doc (Phasen 0-5 erledigt; Phase 6 Politur
offen). Nach jedem Schritt dort Status + "Nächster Schritt" aktualisieren.
