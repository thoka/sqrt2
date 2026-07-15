# Dokumentations-Diskrepanzen – Todos für nächsten Run

## Erledigt (Dokumentation angepasst)

- [x] AGENTS.md: "Keine visuelle Verifikation möglich" → korrigiert auf "MÖGLICH" (Playwright läuft via globaler Cache)
- [x] AGENTS.md: Smoke-Test via curl → als obsolet markiert (pnpm test:e2e funktioniert)
- [x] AGENTS.md: Branch `migrate-to-svelte` → auf `main` korrigiert
- [x] AGENTS.md: Vite 7 "halten" → Migration erledigt, 8er-Sprung nicht mehr anstehend
- [x] AGENTS.md: Paketmanager pnpm → Inkonsistenz dokumentiert (beide Lockfiles vorhanden)
- [x] TOOLING_SPEC.md: Status "Spezifikation, noch nicht begonnen" → "Phasen 0-5 erledigt"
- [x] TOOLING_SPEC.md: Phase 5 "offen" → "erledigt" (E2E-Test grün)
- [x] TOOLING_ENV_SPEC.md §3: "Neue Instanz planen" → Playwright läuft hier bereits
- [x] TOOLING_ENV_SPEC.md §4: pnpm/npm Inkonsistenz dokumentiert

## Offen (Code-Hygiene, nicht dokumentiert)

- [ ] **CODE: Toter Code in `sqrt2.html` entfernen** (Zeilen ~493–1000, ~930–976)
  - SYSTEM-C-Renderblock: `renderFrame()`, `resizeCanvas()`, `getBankTransform()`, `getSmoothedAutoZoomExp()`, `computeAutoZoomTAB()`, `updateAutoZoomIndicator()`, `updateOutputs()`, `formatZoomFactor()`, Loop (`loop()`, `applyPlayback()`), Variablen (`isPlaying`, `u_time`, `u_mode_AB`, `AUTO_ZOOM_MIN_PX`, `RENDER_SCALE`, `EDGE_BLUR_PX`, `LINE_WIDTH_PX`, `ANIM_PAUSE_DURATION`, `ANIM_SPEED`, `ctx`, `canvas`, `bankZoomLabel`, `bankAreaLabel`, `autoZoomMarker`, `autoZoomNote`, `bankPanel`, `numberPanel`, `numberPanelInner`, `restGridPanel`)
  - Auskommentierte Regler-Blöcke (renderScale, edgeBlur)
  - Lebendiger Pfad ist `TargetBankCanvas.svelte` (Phase 4a)

- [ ] **CODE: `compiledStore.depth` Pitfall Test-Absicherung**
  - AGENTS.md GOTCHA #2 dokumentiert: `compiledStore` hat KEIN `depth`-Feld, `configStore.depth` (Alias N_MAX) nutzen
  - Prüfen ob `RestCounterBars.test.js` / `RestCounterGrid.test.js` das als Testfall abdecken

- [ ] **Paketmanager-Entscheidung treffen** (npm vs. pnpm)
  - `package.json` Scripts nutzen `npm`/`vite` direkt
  - `pnpm-lock.yaml` + `pnpm-workspace.yaml` + `mise.toml` (pnpm 11) existieren
  - Entweder: Scripts auf `pnpm` umstellen + `package-lock.json` löschen
  - Oder: pnpm-Artefakte löschen + bei `npm` bleiben

## Nächster logischer Schritt (Phase 6 - Politur)

- Widget-Auswahl-UI (bereits als `displayStore`-Select in `<ControlPanel>` vorhanden)
- Admin-konfigurierbare Steuerungs-Komplexität (README Abschnitt 11)
- Toter Code aufräumen (s.o.)