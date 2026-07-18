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
- [x] Paketmanager-Entscheidung: pnpm durchgesetzt, npm-Befehle in Testdateien/README/scripts bereinigt
- [x] TOOLING_SPEC.md: Detaillierte Phase-Protokolle → CHANGELOG.md ausgelagert
- [x] TOOLING_ENV_SPEC.md §3-4: Auf pnpm-konsistenten Stand aktualisiert

## Offen (Code-Hygiene, nicht dokumentiert)

- [x] **CODE: Toter Code in `sqrt2.html` entfernen** — **obsolet:** `sqrt2.html`
  existiert nicht mehr (Phase 7: Einstiegspunkt ist `index.html`, gesamte
  Logik in `src/App.svelte` + Komponenten). Der lebendige Render-Pfad ist
  `TargetBankCanvas.svelte`. Kein `sqrt2.html`-Aufräumen mehr nötig.

- [ ] **CODE: `compiledStore.depth` Pitfall Test-Absicherung**
  - AGENTS.md GOTCHA #2 dokumentiert: `compiledStore` hat KEIN `depth`-Feld, `configStore.depth` (Alias N_MAX) nutzen
  - Prüfen ob `RestCounterBars.test.js` / `RestCounterGrid.test.js` das als Testfall abdecken

## Nächster logischer Schritt (Phase 6 - Politur)

- Widget-Auswahl-UI (bereits als `displayStore`-Select in `<ControlPanel>` vorhanden)
- Admin-konfigurierbare Steuerungs-Komplexität (README Abschnitt 11)
- Phase 6 (Politur) weiter (siehe TOOLING_SPEC.md Phase 6)