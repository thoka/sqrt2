# Spec: Umbenennung "Zoom" → "Ziel-Darstellung"

**Stand:** 2026-07-22
**Status:** OFFEN

## Ausgangslage

"Zoom" wird im Projekt für zwei verschiedene Konzepte verwendet:

1. **Auto-Zoom / Ziel-Darstellung:** Steuert, wie das Ziel-Quadrat dargestellt
   wird (Basisverzerrung, um tiefe Ziffernstellen lesbar zu halten). Regler:
   "Aktivierung" (linear 0..1), "Stärke" (log-skaliert), "Abstraktion"
   (manueller Basis-b→1-Override). Drei diskrete Presets ("Flächentreu",
   "Rand sichtbar", "Gleichmäßig") über Radio-Buttons steuerbar.

2. **Bank-Zoom:** Kamera/Zoom über der Bank-Seite (rechte Seite). Regelt,
   wie der verbleibende Rest der Bank dargestellt wird. Steuerung über
   "Zoom-Schwellwert" (Admin) und "Zoom-Trägheit" (Animation-Tab).

Die Überlappung der Begriffe ist verwirrend. Die Umbenennung trennt die
beiden Konzepte sauber.

## Ziel

Benenne "Zoom" im Sinne von Konzept 1 (Ziel-Darstellung) in
"Ziel-Darstellung" um. Konzept 2 (Bank-Zoom) bleibt unverändert.

- **Interface:** UI-Labels, CSS-Klassen
- **Code:** Store-Felder, Variablen, Funktionsnamen, Dateinamen
- **Doku:** AGENTS.md, CLAUDE.md, TOOLING_SPEC.md, etc.

## Abgrenzung

### Wird umbenannt (Ziel-Darstellung)

- `configStore.zoomEngagement` → `targetDisplayEngagement`
- `configStore.zoomLevel` → `targetDisplayLevel`
- `configStore.edgeZoomControlMode` → `edgeTargetDisplayControlMode`
- `configStore.zoomState` → `targetDisplayState`
- `configStore.zoomStateTransitionDuration` → `targetDisplayStateTransitionDuration`
- Datei `src/lib/autoZoomLevel.js` → `src/lib/targetDisplayLevel.js`
- Datei `src/lib/zoomStateTween.js` → `src/lib/targetDisplayStateTween.js`
- Export `autoZoomMaxPxStore` → `targetDisplayMaxPxStore`
- Export `AUTO_ZOOM_LEVEL_MIN_PX` → `TARGET_DISPLAY_LEVEL_MIN_PX`
- Export `initZoomStateTween` → `initTargetDisplayStateTween`
- Funktionen in TargetBankCanvas.svelte: `getSmoothedAutoZoomExp`,
  `computeAutoZoomTAB`, `maxAutoZoomWidthPx`
- Lokale Variablen in TargetBankCanvas.svelte: `autoZoomTargetExp`,
  `autoZoomTAB`, `autoZoomComponent`
- Compiler-Variablen: `auto_zoom_checkpoints`, `GLOBAL_AUTO_ZOOM_CHECKPOINTS`,
  `GLOBAL_AUTO_ZOOM_SPLINE`
- URL-Parameter: `zoomengage`→`tdengage`, `zoomlevel`→`tdlevel`,
  `altzoom`→`alttd`, `zoomstate`→`tdstate`, `zoomstatedur`→`tdstatedur`
- CSS-Klassen: `.zoom-readout`→`.target-display-readout`,
  `.zoom-state-group`→`.target-display-state-group`
- UI-Labels: "Auto-Zoom: Aktivierung"→"Ziel-Darstellung: Aktivierung",
  "Auto-Zoom: Stärke"→"Ziel-Darstellung: Stärke",
  `<legend>Zoom</legend>`→`<legend>Ziel-Darstellung</legend>`,
  "Alternative Rand-Zoom-Steuerung"→"Alternative Rand-Ziel-Darstellung-Steuerung"
- Test-Dateien: `autoZoomLevel.test.js`→`targetDisplayLevel.test.js`,
  `zoomStateTween.test.js`→`targetDisplayStateTween.test.js`,
  `zoomStateTween-trap.test.js`→`targetDisplayStateTween-trap.test.js`,
  `auto-zoom-visibility.test.js`→`target-display-visibility.test.js`
- Doku-Datei: `docs/Alternative Zoom-Steuerung,md`→`docs/Alternative Ziel-Darstellung-Steuerung.md`

### Bleibt unverändert (Bank-Zoom)

- `configStore.bankZoomThresholdPowers`
- `configStore.zoomSpeedCoef`
- `BANK_ZOOM_THRESHOLD_POWERS`, `BANK_ZOOM_TAU`
- `GLOBAL_BANK_ZOOM`, `GLOBAL_BANK_ZOOM_TIMES`, `GLOBAL_BANK_ZOOM_SPLINE`
- `bank_zoom_states`, `bank_zoom_states`
- `computeZoomFrame()` in `recursive-layout.js`
- `formatZoomFactor()` in TargetBankCanvas.svelte
- `bankZoomLabel`, `bankAreaLabel` (DOM-Elemente)
- UI-Labels: "Bank-Zoom (automatisch, reale Basis)",
  "Zoom-Schwellwert" (Admin), "Zoom-Trägheit" (Animation)
- URL-Parameter: `zoomthresh`, `zoomspeed`
- Test-Dateien: `zoom-robust.test.js`, `zoom-start-equal.test.js`
  (beide testen Bank-Zoom)
- Kommentare in `morphRect.js` ("zoom-unabhängig" = Bank-Zoom)

## Namenskonvention

- **UI-Labels:** Deutsch (wie bisher): "Ziel-Darstellung"
- **Variablen/Funktionen:** Englisch mit `targetDisplay`-Präfix
- **URL-Parameter:** kurz, `td`-Präfix
- **Dateinamen:** `targetDisplay*` (camelCase für JS-Module)

## Durchführung

### Reihenfolge

1. Dateien umbenennen (git mv)
2. configStore-Felder + Defaults (configStore.js)
3. URL-Parameter (urlState.js)
4. Exportierte Namen (targetDisplayLevel.js, targetDisplayStateTween.js)
5. TargetBankCanvas.svelte (Imports + lokale Variablen + Funktionen)
6. compiler.js (Variablen + Kommentare)
7. ControlPanel.svelte (Imports + UI-Labels + CSS-Klassen)
8. Sonstige Svelte-Komponenten (falls Refs)
9. Tests (Imports + Store-Felder + Test-Dateinamen)
10. Dokumentation (AGENTS.md, CLAUDE.md, TOOLING_SPEC.md, etc.)
11. `pnpm check` + `pnpm test` als Verifikation

### Risiken

- **URL-Break:** Bestehende geteilte Links mit alten Parametern
  funktionieren nicht mehr. Da das Exponat neu deployed wird und keine
  produktiven Shares bestehen, unkritisch.
- **Kommentare:** Manche Kommentare erwähnen "Zoom" im Sinne von
  Bank-Zoom (z.B. `morphRect.js` "zoom-unabhängig") — diese NICHT
  ändern. Bei Unsicherheit: prüft der Kontext, ob Auto-Zoom oder
  Bank-Zoom gemeint ist.

## Verifikation

- `pnpm check` (svelte-check + eslint + knip + prettier)
- `pnpm test` (unit + vitest)
- Manuelle Prüfung: UI-Labels "Ziel-Darstellung" statt "Auto-Zoom",
  Bank-Zoom-Labels unverändert
