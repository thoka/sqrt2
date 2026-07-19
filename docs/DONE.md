## Tests 
- [x] Weiße Quadrate am Anfang müssen exakt gleich groß sein und vertikal gleich ausgerichtet sein.

## Darstellung: Beschriftung an/aus (2026-07-20)
- Neues `configStore`-Feld `showLabels` (Default `false`), URL-Param `labels`
  (`src/lib/urlState.js`), Checkbox "Beschriftung an/aus" in
  `ControlPanel.svelte` (Tab Grundeinstellungen) - erscheint dadurch
  automatisch auch in `RemoteControl.svelte` (nutzt denselben Tab).
- `TargetBankCanvas.svelte`: `drawTargetLabels()` zeichnet, wenn aktiv, für
  jeden Achsen-Index `i` (= Spalte UND Zeile im (u,v)-Gitter des
  Ziel-Quadrats, siehe `axes[]`/`dyn_prefA`/`dyn_axes_w`):
  - unterste Reihe (v=0): Formel `(1/basis)^exponent` über dem unteren Rand
    der Spalte, nur wenn deren Breite für den Text reicht.
  - linkeste Spalte (u=0): derselbe Wert ausgerechnet als exakter Bruch
    (`1`, `1/2`, `1/4`, `1/8`, ... über BigInt, kein Float) neben dem linken
    Rand der Zeile, analog nur bei ausreichender Zeilenhöhe.
  - Kein MathJax (siehe TODO.md-Hinweis: zu langsam) - reines
    `ctx.fillText`/`strokeText`, lokal um den Ankerpunkt zurückgespiegelt
    (der äußere Kontext ist bereits `scale(1,-1)`), analog zum bestehenden
    HUD-Text-Muster.
  - Reine Formatierung (`formatAxisFormulaLabel`/`formatAxisValueLabel`) in
    `numberRenderer.js` ausgelagert und unit-getestet
    (`tests/unit/numberRenderer.test.js`), da Canvas-Zeichnen selbst laut
    AGENTS.md nur per Build+E2E verifiziert wird.
- Visuell gegen Basis 2 (Tiefe 4) und Basis 10 (Tiefe 4) via Playwright-
  Screenshot verifiziert (siehe Geometrie-Analyse im Gesprächsverlauf: das
  Ziel-Quadrat ist ein volles (u,v)-Gitter aus `axes[]`-Segmenten, NICHT nur
  eine Diagonale - Spalten/Zeilen mit `u`/`v` != Achsen-Exponent sind
  Rechtecke, keine Quadrate, daher der Breiten-/Höhen-Schwellwert).
- Kein Compile-Impact (`showLabels` bewusst NICHT in `compileRelevantKey`).

## Flug-Animation: Geschwindigkeits-Schwellwert (2026-07-20)
- Neues `configStore`-Feld `flightAnimSpeedThreshold` (Default `3.0`), URL-Param
  `flightmaxspeed` (`src/lib/urlState.js`), Zahlen-Eingabe "Flug-Animation aus
  ab Geschwindigkeit" im Animations-Tab von `ControlPanel.svelte` (dadurch
  bewusst NICHT im Remote sichtbar, da Remote nur den Tab Grundeinstellungen
  zeigt - Speed selbst wird aber schon per SpeedSlider ferngesteuert).
- Reine Entscheidungslogik `isFlightAnimationEnabled(playSpeed, threshold)`
  nach `src/lib/timeStep.js` ausgelagert (neben `clampDt`, gleiches Muster)
  und unit-getestet (`tests/unit/time-step.test.js`) - der eigentliche
  Canvas-Effekt (fly_t auf 1 zwingen, sobald die Geschwindigkeit den
  Schwellwert erreicht) bleibt in `TargetBankCanvas.svelte drawPiece()`,
  wirkt NUR auf den eigentlichen Bank->Ziel-Tween (Z_source/Z_ghost-
  Sonderfälle des Z-Modus bleiben unberührt).
- Visuell verifiziert (Playwright-Screenshot-Vergleich bei identischer
  eingefrorener Zeit, `speed=2` vs. `speed=5`): unterhalb des Schwellwerts
  ist ein halbtransparentes, nicht am Raster ausgerichtetes fliegendes Stück
  sichtbar; ab dem Schwellwert erscheint an derselben Zeit sofort das
  vollständig gelandete, deckende Stück - kein Zwischenzustand mehr.
- Kein Compile-Impact (`flightAnimSpeedThreshold` bewusst NICHT in
  `compileRelevantKey`, wie `playSpeed` selbst).
