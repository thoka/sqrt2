# Exakte Rest-Arithmetik: BigInt-Festkomma statt Float64 (Zoom-Kollaps bei hoher Tiefe)

Eigenständiger Plan, unabhängig von, aber mit Berührungspunkten zu
`docs/ASYNC-COMPILE-PLAN.md` (Threading/Performance) und
`docs/COMPILER-LAYERING-PLAN.md` (Caching/inkrementelle Tiefe). Dieser Plan
behandelt **Korrektheit**, nicht Geschwindigkeit: Basis 10, Tiefe 22 liefert
heute sichtbar falsche/kollabierende Zoom-Zustände, unabhängig davon, wie
schnell oder gecacht kompiliert wird. Da alle drei Pläne dieselben
Kernfunktionen in `bank-core.js` anfassen (von `CLAUDE.md` als fragil
markiert), siehe Abschnitt "Reihenfolge" am Ende - dieser Plan sollte zuerst
umgesetzt werden.

## 1. Befund (Ist-Zustand, mit Stellenangaben)

Float64 wird durchgängig für die Bank-Geometrie verwendet:

- `bank-core.js:61-193` (`createBankSimulation`): `x/y/w/h` jedes
  Bank-Stücks entstehen durch wiederholtes `w / BASE` (Zeile 175-176) und
  Additionen - reine Float64-Arithmetik. Einzige Ausnahme: die
  Ziffernberechnung `n_arr`/`P_int` (Zeile 40-55), bewusst BigInt.
- `bank-core.js:105-110` (`isolationScore`): Nachbarschafts-Erkennung über
  `Math.abs(...) < EPS` (`EPS = 1e-9`) - satt bei Tiefe ≤8, aber ein
  Float-Vergleich, kein exakter.
- `compiler.js:445-451` (`computeLiveL`): `R` = Float64-Summe aller
  sichtbaren `p.w * p.h`.
- `compiler.js:306-343` (`finalizeCompiled`, `bank_zoom_states`-Schleife):
  `minX/maxX/minY/maxY` aus denselben Float64-Positionen, `halfW =
  (maxX-minX)/2`, `z = Math.min(0.5/halfW, 0.5/halfH)`.

**Warum das bei Tiefe 22 kollabiert (nicht nur "ungenau" ist):** Eine
Position im Bereich [0,1] mit Auflösung `BASE⁻²²` braucht ~22 Stellen
*absolute* Präzision. Float64 hat ~15-17 signifikante *Dezimal*stellen
relativ zur eigenen Größenordnung. Wenn `minX` und `maxX` in einem stark
gezoomten Bereich nur in der 20. Nachkommastelle unterscheiden, sind beide
im selben Float64-Wert *bereits ununterscheidbar* - `maxX - minX` wird 0
oder rauscht um 0 (Auslöschung/Catastrophic Cancellation), `halfW` kollabiert,
`z = 0.5/halfW` läuft gegen `Infinity`/`NaN`. Das ist keine Rundung mehr,
sondern ein Informationsverlust, der VOR der Subtraktion bereits
stattgefunden hat - durch bloßes "genauer runden" nicht mehr reparierbar.
Bereits als bekannter, "harmloser" Bug dokumentiert (README 6.4, Tiefe 9+) -
bei Tiefe 22 ist er nicht mehr harmlos, weil das Zoom-Framing direkt darauf
aufbaut.

Nachgelagert bereits korrekt: `App.svelte:70-99` (`updateHUD`) rechnet exakt
in BigInt weiter - aber auf Basis von `N`, das `computeLiveL` bereits
*gerundet aus einem kaputten Float* liefert (`compiler.js:465`). Die
Exaktheit dort ist also Fassade, wenn der Input schon verrauscht ist.

## 2. Architekturentscheidung: das einfache Modell

**Keine generische Bignum-/BigDecimal-Bibliothek, kein Wrapper-Typ mit
Mantisse+Exponent pro Zahl.** Das wäre Overkill: `BASE` und Tiefe `N_MAX`
stehen pro Kompilierlauf fest, also ist der Nenner für **alle** Werte
gleich - die feinste Gitterzelle `BASE⁻ᴺᴹᴬˣ`. Jeder Schnitt teilt exakt durch
`BASE` (Invariante des Algorithmus, nicht neu eingeführt), also ist jedes
`x/y/w/h` ein exaktes ganzzahliges Vielfaches dieser Einheit.

**Das Modell:**

- Ein globaler Skalierungsfaktor `GRID = BigInt(BASE) ** BigInt(N_MAX)`,
  einmal pro Kompilierlauf aus der Config abgeleitet.
- Jede Bank-Stück-Geometrie (`x, y, w, h`) wird als **BigInt**, ganzzahliges
  Vielfaches von `1/GRID`, gespeichert (0 bis `GRID`, kein Wrapper-Objekt -
  einfaches `BigInt` reicht, `GRID` wird als Kontext mitgereicht, nicht pro
  Wert gespeichert).
- Flächen (`w*h`) sind BigInt-Vielfache von `1/GRID²` - entstehen exakt beim
  Multiplizieren zweier Gitter-BigInts.
- **Kernprinzip** (das eigentlich Wichtige, nicht "Float64 vermeiden" an
  sich): Jede Operation, bei der zwei nahe beieinanderliegende,
  tief-präzise Werte voneinander abgezogen werden (Bounding-Box-Differenzen,
  `2 - P²`, künftige Zoom-Deltas), **muss exakt in BigInt passieren, bevor
  überhaupt zu `Number` gecastet wird**. Jede Umwandlung zu `Number`
  *danach* verliert nur noch eine gutmütige *relative* Präzision (~10⁻¹⁶,
  einmaliges Runden eines bereits feststehenden Werts) statt einer
  *absoluten* Auslöschung - und diese Restungenauigkeit reicht für
  Pixel-/Anzeige-Zwecke immer aus. Die Reihenfolge "erst subtrahieren, dann
  casten" ist der eigentliche Fix, nicht "BigInt statt Float" allein.
- Wo Werte nur **Heuristik/Sortierreihenfolge** sind (z.B. der
  Schwerpunkt-Abstand in `getPieceFromBank`, der nur bestimmt, WELCHES
  Elternstück als nächstes geschnitten wird, nicht OB die resultierende
  Geometrie exakt ist), bleibt Float64 bewusst erlaubt - Konvertierung
  `Number(x)/Number(GRID)` an der Stelle, Präzisionsverlust dort folgenlos.
  Kein Grund, dort ebenfalls BigInt zu erzwingen ("einfaches Modell" heißt
  auch: nur exakt rechnen, wo Exaktheit tatsächlich gebraucht wird).

Das deckt sich mit dem bereits bestehenden Struktur/Darstellungs-Split aus
`COMPILER-LAYERING-PLAN.md`: Struktur (`bank_pieces`, `R`, Zoom-Bounding-Box)
wird exakt, Darstellung (Kompaktierungs-Glättung, Kamera-Dämpfung) bleibt
Float64 - dort ist es ohnehin nur eine animierte Annäherung, keine
Korrektheitsgarantie.

## 3. Umsetzungsschritte

1. **Neues, isoliertes Primitiv:** `src/lib/bigmath.js` mit
   `isqrtBigInt(n)` (`floor(sqrt(n))` für nicht-negative `BigInt`, Newton-
   Verfahren, Standardrezept). Eigene, gründliche Tests (Testkriterium 1) -
   das ist der einzige neue "clevere" Algorithmus in diesem Plan, alles
   andere ist Ganzzahl-Arithmetik in bereits bekannten Bahnen.
2. **`bank-core.js` (`createBankSimulation`):**
   - `GRID = BigInt(BASE) ** BigInt(N_MAX)` einmal berechnen, Wurzelstück
     `x:0n, y:0n, w:GRID, h:GRID`.
   - Schnitt-Logik (Zeile 175-193): `cw`/`ch` per BigInt-Division durch
     `baseBig` (schon vorhanden, Zeile 40) statt `/ BASE`. Exakt, weil `w`
     laut Invariante immer durch `BASE` teilbar ist, solange `k ≤ N_MAX`.
   - `isolationScore` (Zeile 99-114): `touchX`/`touchY` auf exakte
     BigInt-Gleichheit umstellen, `EPS` entfällt ersatzlos.
   - `filterToStripEnds` (Zeile 79-96): Sortier-Comparator auf BigInt-
     Vergleich umstellen (`Array.sort` braucht `Number`-Rückgabe -
     `a.x < b.x ? -1 : a.x > b.x ? 1 : 0`, nicht `a.x - b.x`, da BigInt-
     Subtraktion kein gültiger Sort-Rückgabewert ist).
   - Schwerpunkt-Heuristik (Zeile 140-160, `ccx/ccy/edgeDist`): am Eintritt
     `Number(p.x) / Number(GRID)` etc. - bewusst Float, siehe Abschnitt 2.
   - `buildSystem()` gibt `GRID` mit zurück (für Konsumenten, die Gitter-
     BigInts in Number umrechnen müssen).
3. **`compiler.js` (`computeLiveL`, Zeile 438-468):**
   - `R` als BigInt-Summe (`R_num`) statt Float-Summe.
   - `l`/`N` NICHT mehr über `Math.sqrt`/`Math.round`, sondern exakt:
     `A = (2n*GRID*GRID - R_num) * BASE^(2m)`, `D = isqrtBigInt(A)`,
     `N = round(D / GRID)` als exakte BigInt-Ganzzahldivision mit Rundung
     (`(2n*D + GRID) / (2n*GRID)`, Ganzzahldivision). Kein `Number`
     irgendwo in diesem Pfad - `N` ist danach exakt dieselbe Zahl, die
     `App.svelte` heute schon (scheinbar) exakt weiterverarbeitet.
   - `l` (Float, nur für Debug/Anzeige/Rückgabewert) weiterhin per
     `Number(N) / Math.pow(BASE, m)` am Ende ableiten - unkritisch, weil `N`
     bereits das exakte, gerundete Ergebnis ist.
4. **`compiler.js` (`finalizeCompiled`, `bank_zoom_states`, Zeile 306-343):**
   - `minX/maxX/minY/maxY` als BigInt-Vergleiche/-Min/Max.
   - `area` als BigInt-Summe.
   - `halfW/halfH` als BigInt-Differenz, **danach** `Number(halfW_grid) /
     Number(GRID)` - erst hier der einzige Cast zu Float in diesem
     Berechnungspfad (Kernprinzip aus Abschnitt 2).
   - `cx/cy`/`offsetX/offsetY`/`z` unverändert als Float-Formeln, aber auf
     Basis der jetzt sauber (nicht-ausgelöscht) berechneten `halfW/halfH`.
5. **`TargetBankCanvas.svelte` (`project()`, Zeile 264ff.):** Cast
   `Number(p.x)/Number(GRID)` (analog `y/w/h`) an der Stelle, wo aktuell
   `p.x` direkt als Number erwartet wird - GRID über `compiled.GRID`
   verfügbar machen. Einzelner, unkritischer Cast pro Stück/Frame (siehe
   Abschnitt 2, "gutmütige" relative Rundung).
6. **Kompaktierung (`bank-core.js` TEIL 2, `buildCompactionMap` u.a.):**
   bewusst NICHT auf BigInt umgestellt - reine Darstellungsschicht (siehe
   Abschnitt 2), konsumiert bereits `Number`-gecastete Rechtecke aus Schritt
   5. Kein Korrektheitsanspruch jenseits von Float64-Präzision nötig, weil
   nur animierte Annäherung, keine Zoom-Bounding-Box-Garantie.
7. **`App.svelte` (`updateHUD`):** keine Änderung nötig - `N`/`m` kommen
   jetzt bereits exakt aus `computeLiveL`, die bestehende BigInt-Weiter-
   verarbeitung (Zeile 70-99) profitiert automatisch.

**Kein Dual-Path** (nicht "BigInt nur ab Tiefe X"): eine einzige
Code-Schiene ist einfacher zu warten und zu testen, passt zum Projekt-
Grundsatz "keine parallele, selbst gebaute Ableitung" (`AGENTS.md`).
Voraussetzung dafür ist Testkriterium 8 (Performance-Benchmark) - sollte der
BigInt-Pfad bei alltäglichen Tiefen (3-16) spürbar langsamer sein, wird das
dort entschieden, nicht vorab angenommen.

## 4. Testkriterien

**Unit (`node --test`, `tests/unit/`):**

1. **`isqrtBigInt`-Korrektheit:** für eine Matrix aus Testwerten (`0n`,
   `1n`, exakte Quadratzahlen, `k²-1`/`k²+1`-Randfälle, Zufallswerte bis
   ~10⁹⁰) gilt algebraisch `isqrtBigInt(n)² ≤ n < (isqrtBigInt(n)+1)²` -
   Beweis statt Float-Vergleich, da hier kein Referenzwert in Float64
   überhaupt existiert.
2. **Geometrie-Exaktheit:** für Tiefe 22/Basis 10 (plus Kontrollen bei
   Tiefe 3, 8, 16) ist jedes `bank_piece.w`/`.h` ein exaktes ganzzahliges
   Vielfaches von `GRID / BASE^k` (`k = piece.k`) - Prüfung per
   BigInt-Modulo, kein Toleranzfenster.
3. **Flächen-Erhaltung exakt (nur mit BigInt überhaupt prüfbar):** Summe
   ALLER Blatt-Flächen (aktuell sichtbar + bereits entnommen + noch
   ungeschnitten) ist zu jedem Tick exakt `GRID²` - keine Approximation,
   `===` auf BigInt.
4. **R-Monotonie exakt:** `R_num` (BigInt) ist über die Zeit streng
   monoton fallend, exakt `GRID²` bei `t=0`, exakt `0n` bei `t=MAX_TIME` -
   bei Tiefe 22 buchstäblich `0n`, nicht "nahe 0".
5. **Zoom-Bounding-Box kollabiert nicht:** für Tiefe 22, über ALLE
   `eventTimes`-Checkpoints: `halfW_grid > 0n` und `halfH_grid > 0n`
   (kein Auslöschungs-Kollaps mehr) UND das daraus abgeleitete `z` ist
   endlich und positiv (`isFinite(z) && z > 0`). Regressionstest für genau
   das gemeldete Symptom.
6. **Determinismus:** zwei aufeinanderfolgende `compileSystemData()`-Aufrufe
   mit identischer Config liefern bitidentische BigInt-Werte (Ausschluss von
   Nichtdeterminismus durch versehentlich verbliebene instabile
   Float-Sortierungen).
7. **Regressions-Parität bei Normal-Tiefen (3-8):** die neuen,
   BigInt-abgeleiteten Float-Ausgaben (`z`, `offsetX`, `cx`, `l`, `N`)
   weichen von den alten (rein Float64) Werten um weniger als eine enge
   Toleranz ab (z.B. 1e-9 relativ) - Beweis, dass sich sichtbares Verhalten
   bei normalen Tiefen NICHT ändert, sondern erst bei extremen Tiefen
   überhaupt erst korrekt wird.
8. **Performance-Benchmark, nicht Annahme:** Kompilierzeit bei Tiefe 8/12/16
   mit BigInt-Pfad vs. dem alten Float64-Pfad (Git-Historie) - empirisch
   messen, dokumentierte Schwelle festlegen, ob ein Dual-Path doch nötig
   wird (siehe Abschnitt 3, Empfehlung: keiner, aber hier verifizieren).
9. **`isolationScore` ohne EPS:** exakte BigInt-Gleichheit liefert für alle
   bestehenden Nachbarschafts-Testfälle (aus `bank-core-compaction.test.js`
   u.a.) identische Ergebnisse wie die alte EPS-Variante bei Tiefe ≤8.
10. **Worker-Tauglichkeit:** `structuredClone(compileSystemData(config22))`
    (Node) wirft nicht, und alle BigInt-Felder bleiben nach dem Klonen exakt
    (`===`-Vergleich je Feld) - Beleg, dass BigInt sauber durch
    `postMessage` an `compile.worker.js` geht. Falls `structuredClone` in
    der Zielumgebung BigInt NICHT unterstützen sollte: vorher verifizieren
    (nicht annehmen), sonst Fallback-Serialisierung (BigInt→String)
    dokumentieren.
11. **`App.svelte`/Zahlentafel unverändert:** bestehende Tests rund um
    `computeLiveL`/HUD-Format laufen bei Tiefe ≤16 ohne Anpassung durch -
    Beweis, dass sich die Schnittstelle nach außen nicht ändert.

**E2E (`tests/e2e/`, Playwright, gegen `dist/`):**

12. **Zoom bei Tiefe 22/Basis 10 bleibt visuell stabil:**
    Canvas-Screenshot-Stichproben über die komplette Wiedergabe (z.B. alle
    10% der Laufzeit) zeigen nie ein leeres/weißes Canvas oder ein
    Rechteck, das sichtbar außerhalb des Zielbereichs liegt - direkter
    Regressionstest für das gemeldete Symptom.
13. **Kompilierzeit bei Tiefe 22 bleibt innerhalb einer vorab gemessenen,
    dokumentierten Schwelle** (Benchmark vor/nach der Umstellung). Über den
    Async-Compile-Worker (`ASYNC-COMPILE-PLAN.md`) bleibt der Main-Thread in
    jedem Fall frei, unabhängig vom absoluten Zeitwert.

## 5. Reihenfolge / Abgrenzung zu den anderen Plänen

- **Zuerst dieser Plan.** `bank-core.js` wird von allen drei Plänen
  angefasst; dieser hier ändert den zugrundeliegenden Datentyp der
  Geometrie (Float64 → BigInt) - eine Grundlagenänderung, auf der die
  anderen beiden aufbauen sollten, nicht umgekehrt.
- **`COMPILER-LAYERING-PLAN.md` Abschnitt C ("Inkrementelle Tiefe")**
  fasst `getPieceFromBank()`/`buildSystem()` an denselben Stellen an wie
  dieser Plan (Schritt 2 oben) - erst nach diesem Plan umsetzen, sonst
  Gefahr, eine heikle Inkrementalitäts-Änderung auf einem Datentyp
  aufzubauen, der sich unter ihr noch ändert.
- **`ASYNC-COMPILE-PLAN.md`** ist unabhängig (reine Threading-Frage) und
  kann parallel oder in beliebiger Reihenfolge umgesetzt werden -
  `compileSystemData()`/`finalizeCompiled()`-Split bleibt unverändert
  bestehen, nur der Inhalt der Felder wird exakter (Testkriterium 10 prüft
  explizit, dass der Worker-Transport dadurch nicht bricht).
