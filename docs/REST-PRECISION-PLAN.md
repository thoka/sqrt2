# Exakte Zahlentafel (l/l²/R) durch Ziffern-Zählung + robuster Zoom durch lokale Vorfahren-Rezentrierung

Ersetzt die erste Fassung dieses Plans komplett (siehe Git-Historie). Die
erste Fassung schlug vor, `x/y/w/h` in `bank-core.js` komplett auf BigInt
umzustellen - gemessen ~5-10× langsamer in der heißen `isolationScore`-
Schleife (siehe Benchmark weiter unten in der Historie dieses Dokuments/im
Gesprächsverlauf) und ein Eingriff in den laut `CLAUDE.md` fragilsten Teil
des Projekts. Im Gespräch hat sich herausgestellt, dass **weder für die
Zahlentafel noch für den Zoom eine globale BigInt-Geometrie nötig ist** -
beide Probleme lassen sich kleiner, exakter und ohne Performance-Verlust
lösen. Dieser Plan behandelt sie als zwei unabhängige Teile.

## Ausgangskorrektur

`AGENTS.md` sagt bereits (vor diesem Plan!) explizit, wie `l`/`R` zu
gewinnen sind:

> `l` wird direkt aus den **Stellen der Simulation** abgelesen
> (Achsen/Ziffern der Bank, nicht aus einer eigenen Umrechnung
> hochgerechnet); `R` ergibt sich direkt aus der **Zählung des Rests**.

Die aktuelle `computeLiveL()` (`compiler.js:438-468`) verstößt genau dagegen:
sie summiert Float-Flächen sichtbarer Bank-Stücke zu `R`, rechnet daraus
`l = Math.sqrt(2-R)` **zurück** - eine "eigene Umrechnung", exakt das, was
die Regel verbietet. Das ist auch der eigentliche Grund, warum bei Tiefe 22
nichts mehr stimmt: nicht weil `l`/`R` grundsätzlich unmöglich exakt wären,
sondern weil der falsche (zurückgerechnete statt abgelesene) Weg gewählt
wurde.

## Teil A: `l`/`l²`/`R` exakt, ohne Wurzel

### Befund

- `bank-core.js:41-58` (`n_arr`/`P_int`/`axes`) berechnet die Ziffern von
  `sqrt(2)` bereits **exakt per BigInt**, bevor die eigentliche Simulation
  überhaupt läuft (`c*c <= target`-Vergleich, kein Float).
- Jedes `axes[i]` hat eine exakte Breite `BASE^(-axes[i].exp)`,
  `axes[i].exp` ist streng monoton wachsend in `i` (Konstruktion:
  `for m=1..N_MAX: for c=0..n_arr[m]: axes.push({exp:m})`).
  `compiler.js:52` (`P_FINAL`) summiert das bereits - nur aktuell mit
  `Math.pow` (Float) statt BigInt, obwohl die Quelle (`axes[i].exp`, ein
  Integer) längst exakt ist.
- Jedes Bank-Stück trägt `k` (`bank-core.js:181`, Gesamtzahl der Schnitte,
  Integer). Ein Schnitt teilt immer genau eine Dimension durch `BASE`, egal
  welche Achse - nach `k` Schnitten gilt für die Fläche unabhängig davon,
  wie sich die Schnitte auf beide Achsen verteilen:
  `Fläche = BASE^(-k_v) · BASE^(-k_h) = BASE^(-(k_v+k_h)) = BASE^(-k)`.
  **`R` (Summe sichtbarer Flächen) hängt also nur vom bereits vorhandenen
  Integer-Feld `k` ab - nicht von `x/y/w/h`.**
- `k` kann größer als `N_MAX` werden (Rand-Zellen im `subdivide`-Modus
  fordern `k+1`, die Ecke `k=exp(u)+exp(v)` mit `u,v` bis `N_MAX` - im
  Gespräch an einem konkreten Fall mit `N_MAX=1` verifiziert, wo bereits
  `k=3` auftritt). Der Nenner für `R` als exakter Bruch muss also aus dem
  **tatsächlichen** `max(p.k)` nach dem Bank-Lauf abgeleitet werden, nicht
  aus einer angenommenen Formel wie `2·N_MAX` - das wurde im Gespräch einmal
  fälschlich angenommen und dann anhand des Beispiels widerlegt.
- `GLOBAL_SHELL_START` (`compiler.js:73-91`) + der bestehende
  `Step`-Ermittlungscode (`compiler.js:456-461`) liefert bereits exakt "der
  höchste Schalenindex, dessen Startzeit erreicht ist" - Schalen `0..Step-1`
  sind damit garantiert **vollständig** abgeschlossen (jede Schale startet
  erst, wenn die vorige fertig ist), Schale `Step` selbst läuft noch/steht
  an. Genau das ist der Baustein für "l ist immer die Breite der
  abgeschlossenen Schalen" - kein Interpolieren, kein Zählen "wie weit die
  laufende Schale ist" nötig.

### Architektur

**Kein Sqrt, kein `isqrt`, keine Geometrie.** Drei unabhängige, alle exakte
BigInt-Ableitungen:

- `l` = `Σ_{i=0}^{Step-1} BASE^(-axes[i].exp)` - eine Präfixsumme über
  `axes`, ausgewertet bis zum letzten **vollständig abgeschlossenen**
  Schalenindex. Einmal pro Kompilierlauf als Array vorberechnet (billig,
  `O(TOTAL_STEPS)` BigInt-Additionen, **nicht** in der heißen
  `isolationScore`-Schleife), pro HUD-Update dann ein reiner Array-Lookup.
- `R` = `Σ BASE^(-p.k)` über alle zum Zeitpunkt `t` sichtbaren Bank-Stücke
  (gleicher Sichtbarkeits-Filter wie heute:
  `born_time <= t < cut_time && t < taken_time`) - eine unabhängige,
  eigene Zählung, wie von `AGENTS.md` verlangt. `O(sichtbare Stücke)` pro
  HUD-Update, reine `Number`→`BigInt`-freie Integer-Arithmetik auf einem
  bereits vorhandenen Feld (`k`) - kein neuer Zustand in `bank-core.js`
  nötig.
- `l²` = `l · l` (exakte BigInt-Multiplikation, trivial, sobald `l` exakt
  ist - genau das macht `App.svelte:77` mit `P2 = N*N` bereits, nur bisher
  auf einem verfälschten `N`).
- **Kreuzprobe statt Ableitung:** `R` und `l²` werden unabhängig
  voneinander berechnet (verschiedene Quellen: `axes` vs. `p.k`) - die
  Identität `2 - l² == R` (auf einen gemeinsamen Nenner gebracht) ist damit
  ein scharfer Korrektheitstest, **nicht** der Berechnungsweg für `R`.

**Skalen/Nenner** (Detail, der bei der Umsetzung sauber hergeleitet werden
muss statt geraten zu werden):

- `l` hat exakt Nenner `GRID = BASE^N_MAX` (`axes[i].exp` ist per
  Konstruktion `≤ N_MAX`, keine Ausnahme).
- `R` (und zum Vergleich hochskaliertes `l²`) haben Nenner
  `AREA_SCALE = BASE^K_MAX`, wobei `K_MAX = max(p.k)` über alle
  tatsächlich erzeugten Bank-Stücke - **nach dem Bank-Lauf ermittelt, nicht
  vorab angenommen** (siehe Befund oben, `K_MAX > N_MAX` ist der
  Normalfall). `AREA_SCALE` ist ein exaktes Vielfaches von `GRID²`
  (`BASE^K_MAX / BASE^(2·N_MAX) = BASE^(K_MAX-2·N_MAX)`, eine ganzzahlige
  Potenz), die Skalierung für die Kreuzprobe ist also eine reine
  Multiplikation, kein Rundungsverlust.
- Für die Anzeige (`App.svelte`) folgt daraus: `l` zeigt natürlich bis zu
  `N_MAX` Nachkommastellen (mit trailing zeros, die die bestehende
  `trimTrailing()` schon wegschneidet), `l²`/`R` können **mehr** echte
  Nachkommastellen zeigen als `l` selbst (bis zu `K_MAX`) - das ist keine
  Ungenauigkeit, sondern eine reale Eigenschaft des Algorithmus (die interne
  Buchführung schneidet feiner als die Ziel-Auflösung, gleicht sich am Ende
  jeder Schale aber exakt wieder aus).

### Umsetzungsschritte

1. `compiler.js` (`compileSystemData`): `GLOBAL_L_PREFIX` (BigInt-Array,
   Länge `TOTAL_STEPS+1`) einmalig aus `axes`/`N_MAX` aufbauen -
   `GLOBAL_L_PREFIX[S] = Σ_{i<S} BASE^(N_MAX - axes[i].exp)`.
2. `compiler.js` (`computeLiveL`): komplett neu -
   - `Step` wie heute ermitteln (`compiler.js:456-461`, unverändert).
   - `N_l = GLOBAL_L_PREFIX[Step]`.
   - `N_R = Σ BASE^(K_MAX - p.k)` über sichtbare `bank_pieces` (gleicher
     Zeit-Filter wie heute).
   - `Math.sqrt`/`Math.round`/die alte Float-`R`-Summe **entfernen**, keine
     Ersatz-Wurzelfunktion nötig.
   - Rückgabe: `{ N_l, N_R, GRID, AREA_SCALE }` (BigInt-Werte + die beiden
     Nenner) statt bisher `{ N, m, l }`.
3. `bank-core.js`: **keine Änderung.** `K_MAX` wird in `compileSystemData()`
   nach dem `buildSystem()`-Aufruf per `Math.max(...bank_pieces.map(p=>p.k))`
   bestimmt (billig, einmalig, kein Eingriff in den fragilen Kernalgorithmus).
4. `App.svelte` (`updateHUD`): `P_str` aus `N_l`/`GRID` (statt `N`/`m`),
   `P2_str` aus `N_l*N_l`/`GRID²`, `rem_str` aus `N_R`/`AREA_SCALE` **direkt**
   (nicht mehr `two_scaled - P2` - das war die "eigene Umrechnung", die
   `AGENTS.md` für `R` explizit ausschließt). Formatierungs-Logik
   (Nachkommastellen aus Nenner-Exponent ableiten, `trimTrailing()`) bleibt
   strukturell gleich, nur die Quelle der drei Zahlen ändert sich.

### Testkriterien

**Unit (`node --test`, `tests/unit/`):**

1. **`l`-Präfixsumme korrekt:** `GLOBAL_L_PREFIX[TOTAL_STEPS]` (voll
   abgeschlossen) ist bitidentisch mit `P_int` aus `bank-core.js:41-55` -
   zwei unabhängig konstruierte exakte Werte müssen exakt übereinstimmen.
2. **`K_MAX > N_MAX` ist real, nicht hypothetisch:** für Tiefe 22/Basis 10
   (und mindestens einen kleinen Kontrollfall wie `N_MAX=1` aus dem
   Gespräch) tatsächlich `K_MAX` aus den erzeugten `bank_pieces` messen und
   im Test dokumentieren/fixieren (Regressionsschutz, falls sich die
   Bank-Strategie je ändert und `K_MAX` plötzlich doch `≤ N_MAX` würde -
   dann wäre `AREA_SCALE` überdimensioniert, aber nie falsch).
3. **Kreuzprobe exakt:** für mehrere Zeitpunkte `t` (u.a. `t=0`,
   `t=MAX_TIME`, mehrere Zwischenwerte) gilt exakt
   `2·AREA_SCALE - (N_l² · AREA_SCALE/GRID²) == N_R · (AREA_SCALE/GRID²)`
   (auf gemeinsamen Nenner gebracht) - `===` auf BigInt, kein
   Toleranzfenster. Bei `t=0`: `N_l=0` (nur Basisquadrat, Schale 0 ist per
   Definition/Konvention abgeschlossen oder nicht - klären und exakt
   `R=GRID`-äquivalent testen), bei `t=MAX_TIME`: `N_l=GRID`
   (`l=1`+alle Schalen, exakt `sqrt(2)` bis `N_MAX` Stellen) und `N_R=0`.
4. **`l` springt nur an Schalengrenzen:** `N_l` als Funktion von `t` ändert
   sich ausschließlich bei `t = GLOBAL_SHELL_START[S]` für irgendein `S` -
   an keiner anderen Stelle (Beleg für "l ist Treppenfunktion über
   abgeschlossene Schalen", keine versteckte Interpolation).
5. **`R` ändert sich pro Tick, nicht nur pro Schale:** im Gegensatz zu `l`
   ändert sich `N_R` bei jeder einzelnen Stück-Entnahme (feinere
   Granularität) - Regressionsschutz gegen eine versehentliche Angleichung
   beider Granularitäten.
6. **Performance-Check `computeLiveL`:** Kosten pro Aufruf bei Tiefe 22
   bleiben klar unterhalb eines Frame-Budgets (~16ms bei 60fps) - `R`-Summe
   läuft über sichtbare Stücke (`O(sichtbare Stücke)`), nicht über alle
   jemals erzeugten - das vorab messen, nicht nur behaupten.
7. **Bestehende Tests angepasst:** `computeLiveL`-Testfälle in
   `compiler.test.js` (u.a. Zeile ~124, "Anfang hat 0 Nachkommastellen") auf
   die neue Rückgabeform (`N_l`/`N_R`/`GRID`/`AREA_SCALE` statt `N`/`m`/`l`)
   umstellen, Verhalten bei Tiefe ≤16 muss sichtbar unverändert bleiben.
8. **Worker-Tauglichkeit:** `GLOBAL_L_PREFIX` (BigInt-Array) übersteht
   `structuredClone()` verlustfrei (Feld-für-Feld `===`-Vergleich) - gleiche
   Prüfung wie im Async-Compile-Plan, hier für das neue Array.

**Komponente (`vitest`, `src/**/*.test.js`):**

9. **`App.svelte`-Zahlentafel:** für eine feste Config/Zeit-Kombination bei
   Tiefe 22 zeigt das Panel `l`/`l²`/`R` mit **allen** ihren jeweils
   korrekten Nachkommastellen (Referenzwert aus einer unabhängigen
   Berechnung, z.B. Python/`decimal`/`mpmath` mit hoher Präzision, manuell
   einmalig erzeugt und im Test fest hinterlegt) - der eigentliche Beweis,
   dass Tiefe 22 jetzt tatsächlich korrekt angezeigt wird.

## Teil B: Zoom-Bounding-Box robust (unabhängig von Teil A)

### Befund

Bleibt wie in der Diskussion erarbeitet: `finalizeCompiled`s
`bank_zoom_states`-Schleife (`compiler.js:306-343`) bildet `maxX-minX` aus
Float64-Positionen, die selbst schon beim Bau (`bank-core.js:175-193`,
`child.x = parent.x + i*cw`) auf ~15-17 signifikante Stellen begrenzt sind.
Bei Tiefe 22 liegen zwei benachbarte, tief geschachtelte Stücke oft
innerhalb dieser Grenze - ihre Differenz kollabiert auf 0 oder rauscht
(Auslöschung), `halfW`→0, `z`→`Infinity`/`NaN`. **Wichtige Erkenntnis aus
der Diskussion:** ein nachträgliches Abziehen eines Zentrums von den
bereits gerundeten `x`-Werten hilft NICHT - die verlorenen Stellen sind zu
diesem Zeitpunkt schon weg. Die Rettung muss die Information nutzen, die
VOR dem Runden noch vorhanden war.

### Architektur

`bank-core.js` trackt bereits `parent_id`/`children` (`bank-core.js:62-74`)
- der Schnittbaum existiert. Zwei Stücke, die räumlich nah beieinander
liegen (genau der Fall, in dem Auslöschung droht), haben aus der Natur der
rekursiven Schneide-Logik heraus fast immer einen kürzlichen, tiefen
gemeinsamen Vorfahren - sie wurden erst spät auseinandergeschnitten. Stücke
mit einem flachen/fernen gemeinsamen Vorfahren wiederum liegen (fast immer)
auch räumlich weit auseinander - dort reicht normale Float64-Präzision
locker, Auslöschung ist dort strukturell kein Thema. Das Verfahren ist damit
selbstregulierend: teuer/tief nur dort, wo tatsächlich Präzision gebraucht
wird.

- **Additiv, ohne Bestehendes zu ändern:** jedes Stück bekommt zusätzlich
  `localOffsetX`/`localOffsetY` = Versatz relativ zum eigenen direkten
  Elternstück (`i*cw` bzw. `0`) - schon heute implizit vorhanden (fließt
  sofort in `x` ein), wird nur zusätzlich separat gespeichert. `x`/`y`,
  `isolationScore`, `filterToStripEnds` bleiben **unverändert** - kein
  Eingriff in den heißen, bereits getesteten Simulationspfad.
- **Nur in `finalizeCompiled`, nur für die Zoom-Bounding-Box:** für die
  (durch `kThresholdDiff`, `compiler.js:305/321`, ohnehin schon auf
  ähnliche Skala gefilterte, kleine) Gruppe der pro Checkpoint gerahmten
  Stücke: gemeinsamen Vorfahren über `parent_id` suchen, dann NUR die
  `localOffset`-Werte ab diesem Vorfahren aufsummieren (kurze Kette, kleine
  Zahlen, gutmütig konditioniert - kein Abzug zweier bereits gerundeter
  O(1)-Werte mehr).

### Umsetzungsschritte

1. `bank-core.js` (`getPieceFromBank`, Zeile ~177-193): beim Erzeugen jedes
   Kindes zusätzlich `localOffsetX`/`localOffsetY` setzen (reine Ergänzung
   des Objekt-Literals, keine bestehende Zeile ändert sich).
2. `compiler.js` (`finalizeCompiled`, `bank_zoom_states`-Schleife): neue
   Hilfsfunktion `relativePosition(p, q)` - Vorfahren-Ketten von `p` und `q`
   über `parent_id` bis zum gemeinsamen Vorfahren laufen, `localOffsetX/Y`
   entlang beider Pfade aufsummieren, Differenz zurückgeben. Ersetzt die
   direkte `p.x - q.x`-artige Verwendung nur dort, wo `kThresholdDiff`
   bereits eine ähnliche-Skala-Gruppe gebildet hat.
3. `minX/maxX/minY/maxY`/`halfW/halfH` aus diesen robusten Differenzen statt
   aus rohen `p.x`/`p.y` ableiten.

### Testkriterien

**Unit:**

10. **Bounding-Box kollabiert nicht:** für Tiefe 22/Basis 10, über alle
    `eventTimes`-Checkpoints: `halfW > 0` und `halfH > 0`, `z` endlich und
    positiv - direkter Regressionstest für das ursprünglich gemeldete
    Symptom.
11. **Vorfahren-Suche terminiert/korrekt:** für ein synthetisches
    Stück-Paar mit bekanntem gemeinsamem Vorfahren liefert
    `relativePosition()` die exakt erwartete Differenz (Konstruktion des
    Testfalls von Hand, kleine Tiefe, nachrechenbar).
12. **Selbstregulierung nachgewiesen:** für Tiefe 22 die durchschnittliche
    Länge der Vorfahren-Ketten bei tatsächlich gerahmten (also
    `kThresholdDiff`-gefilterten) Stück-Paaren messen und zeigen, dass sie
    klein bleibt (nicht bis zur Wurzel zurücklaufen) - Beleg für die
    behauptete Kosten-Eigenschaft, nicht nur Annahme.
13. **Regressions-Parität bei Normal-Tiefen (3-8):** `z`/`offsetX`/`cx`
    weichen von den alten (rohen Float64-Differenz-)Werten um weniger als
    eine enge Toleranz ab.
14. **`isolationScore`/Determinismus unverändert:** bestehende
    `bank-core-compaction.test.js`/`compiler.test.js`-Fälle laufen
    unangetastet durch - Beleg, dass Teil B den Simulationskern nicht
    berührt.

**E2E (Playwright, gegen `dist/`):**

15. Zoom bei Tiefe 22/Basis 10 bleibt über die komplette Wiedergabe visuell
    stabil (Canvas-Screenshot-Stichproben, kein leeres/kollabiertes Bild).

## Reihenfolge / Abgrenzung

- **Teil A und Teil B sind unabhängig** - verschiedene Dateien
  (`compiler.js`+`App.svelte` vs. `bank-core.js`+`compiler.js`,
  überschneidungsfrei in den konkreten Funktionen), können in beliebiger
  Reihenfolge oder parallel umgesetzt werden.
- Teil A hat kein Performance-Risiko (läuft nur pro HUD-Update, nicht in
  der heißen Simulationsschleife) und keinen Eingriff in `bank-core.js` -
  geringstes Risiko, empfohlen zuerst.
- Teil B fasst `bank-core.js` nur additiv an (neue Felder, keine
  geänderten Zeilen) - deutlich risikoärmer als die verworfene erste
  Fassung, aber trotzdem der Teil mit Berührung des laut `CLAUDE.md`
  fragilen Kerns, daher mit besonderer Sorgfalt (Testkriterien 11-14) und
  nach Teil A.
- **Bezug zu `COMPILER-LAYERING-PLAN.md`/`ASYNC-COMPILE-PLAN.md`:** beide
  bleiben komplett unberührt von diesem Plan - keiner der beiden Teile
  ändert die Struktur von `compileSystemData()`/`finalizeCompiled()`, nur
  deren Inhalte werden exakter/robuster.

## Stand (2026-07-16) - Teil A + Teil B committet

- **Teil A erledigt** (`src/lib/compiler.js` + `src/App.svelte`):
  `l` kommt aus `GLOBAL_L_PREFIX`, einer BigInt-Präfixsumme
  `Σ BASE^(N_MAX - axes[i].exp)` über die Stellen der Simulation - KEIN
  `sqrt`. `R` ist eine unabhängige Zählung `Σ BASE^(-p.k)` über sichtbare
  Bank-Stücke. `computeLiveL` nutzt `MAX_TIME`, sodass `t ≥ MAX_TIME ⇒
  Step = TOTAL_STEPS` (volle √2-Präzision bis N_MAX Stellen); bei `t=0`
  plan-konform `N_l=0`. Nenner `GRID = BASE^N_MAX`, `AREA_SCALE =
  BASE^K_MAX` (K_MAX > N_MAX, weil subdivide k > N_MAX erzeugt).
- **Teil B erledigt** (`src/lib/bank-core.js` + `src/lib/compiler.js`):
  neue Felder `localOffsetX/Y` an Basis- und Kind-Stücken; exportierte
  `relativePosition(p, q, parentMap)` summiert die `localOffset`-Ketten ab
  dem LCA (Pfad ist blatt→wurzel, Indizes `0..i`) statt `p.x - q.x` →
  vermeidet Float-Auslöschung bei Tiefe 22. Die Zoom-Bounding-Box in
  `finalizeCompiled` nutzt `relativePosition` mit dem ersten Framing-Stück
  als Anker; nur EIN absoluter x/y-Wert fließt ein.
- **Tests:** `tests/unit/compiler.test.js` (21 Teil-A-Tests, alle grün) +
  `tests/unit/zoom-robust.test.js` (7 Teil-B-Tests, alle grün). Vollständige
  Unit-Suite 115/115 (ein VORHANDENER Hang in `compiler-split.test.js`
  bei base 16 / depth 15 ist unabhängig von diesem Plan - schon im
  Original-Code reproduzierbar, Stückzahl explodiert). `pnpm check`,
  `pnpm build` und alle 14 E2E-Tests grün (inkl. "Canvas zeigt zwei weisse
  Quadrate").
- **Nächster Schritt:** nichts Offenes an diesem Plan. Offen im Projekt:
  Phase 6 (Politur) sowie der `compiler-split.test.js`-Hang (separat
  fixen: base 16 / depth 15 auf ein vertretbares Maß deckeln).
