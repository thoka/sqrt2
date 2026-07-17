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

## Stand (2026-07-17) - Teil A + Teil B committet, Teil C in Arbeit

- **Teil A erledigt** (`src/lib/compiler.js` + `src/App.svelte`):
  `l` kommt aus `GLOBAL_L_PREFIX`, einer BigInt-Präfixsumme
  `Σ BASE^(N_MAX - axes[i].exp)` über die Stellen der Simulation - KEIN
  `sqrt`. `R` ist eine unabhängige Zählung `Σ BASE^(-p.k)` über sichtbare
  Bank-Stücke. `computeLiveL` nutzt `MAX_TIME`, sodass `t ≥ MAX_TIME ⇒
  Step = TOTAL_STEPS` (volle √2-Präzision bis N_MAX Stellen); bei `t=0`
  plan-konform `N_l=0`. Nenner `GRID = BASE^N_MAX`, `AREA_SCALE =
  BASE^K_MAX` (K_MAX > N_MAX, weil subdivide k > N_MAX erzeugt).
- **Teil B erledigt** (`src/lib/bank-core.js` + `src/lib/compiler.js`):
  `localOffsetX/Y` sind ganzzahlige Rasterindizes `i` (0..BASE-1) des Child
  im Parent - O(1) bei jeder Tiefe. `relativePosition(p, q, parentMap, BASE)`
  faltet `(fx + localOffset) / BASE` von Blatt nach Wurzel → exakte relative
  Position in [0,1], ohne Float-Auslöschung. Zoom-Bounding-Box komplett
  relativ zum Anker, keine absoluten `p.x`.
- **Teil C in Arbeit** (`src/lib/compiler.js`, `tests/unit/zoom-robust.test.js`):
  Zoom nutzt kompaktierte Geometrie (`zoom_rect_lookup` via
  `computeCompactionWaypoints`). Anker = schwerste Gruppe (max `w*h`) für
  ruhige Kamera. Alle sichtbaren Stücke im Rahmen (kein kThresholdDiff-Filter
  — mit Kompaktierung irrelevant). `ZOOM_MARGIN = 0.05`. Gemessen: Rest-
  Fläche/Fenster = 35–70% bei base 2/10, Tiefe 20–50. Tests umgeschrieben
  auf neue Invarianten (Rest-Fläche ≥10%, Sichtbarkeit im kompaktierten Raum).
  Noch nicht committet.
- **Sichtbarkeit verifiziert bis Tiefe 50:** Rest-Fläche (nach Kompaktierung)
  macht 35–70% der Frame-Fläche aus (base 2/10, Tiefe 20–50). `compileSystem`
  skaliert problemlos bis Tiefe 50+ (Stückzahl ~67k, <10s).
- **Tests:** `tests/unit/compiler.test.js` (21 Teil-A-Tests) +
  `tests/unit/zoom-robust.test.js` (Teil-B + Teil-C-Tests). Noch nicht alle
  grün (Teil-C-Tests in Arbeit).
- **Nächster Schritt:** Teil-C-Tests zum Laufen bringen, `pnpm check` +
  `pnpm build` + E2E, dann committen. Offen: Verhalten bei Tiefe 60+
  (Stückzahl ~67k) prüfen.

## Teil C: Rest auch bei extremem Zoom groß genug sichtbar (Zoom nutzt kompaktierte Geometrie)

### Befund

Teil B löst die **Float-Auslöschung** (robuste [0,1]-Box bei Tiefe 50+).
Das eigentliche Sichtbarkeitsproblem des Users ("ab einem bestimmten
Zoom-Level sieht man keinen Rest mehr") hat eine zweite Ursache: das
**externe Kompaktieren** (bisheriger Render-Modus via `computeCompactionAt`
/ `getSmoothedCompactedLogicalRect`) ist bei hoher Tiefe wegen Float-
Genauigkeit zusammengebrochen — die kompaktierten Koordinaten wurden
NaN/Infinity, der Rest verschwand vollständig.

Teil C behebt das, indem die **kompaktierte Geometrie direkt in den Zoom-
Pfad eingebaut** wird (statt als separater Render-Modus). Der Zoom framt
die kompaktierten Rects (Lücken entnommener Stücke geschlossen), Float-sicher
via `relativePosition()` (Teil B). Die Fläche des Rests (nach Kompaktierung)
bleibt dadurch bei jeder Tiefe als nennenswerter Bruchteil des Fensters
sichtbar — gemessen: **35–70% der Fensterfläche** bei base 2/10, Tiefe
20–50.

### Warum die Rest-Fläche und nicht die Kleinste-Stück-Größe?

Der User präzisierte: "rest genug sichtbar heißt: die den Rest
umschließende Fläche (nach Kompaktierung) soll einen gewissen Bruchteil des
Fensters ausmachen." Es geht also nicht darum, ob das kleinste einzelne
Stück (z.B. Tiefe 60) auf ≥1px skaliert wird — sondern ob die Gesamtfläche
aller sichtbaren Reste nach Kompaktierung einen wahrnehmben Teil des
Fensters ausfüllt. Das ist die relevante Metrik, weil:

- Die Kompaktierung schließt Lücken (Positionen), nicht Größen. Ein Stück
  auf Tiefe 60 ist 10^47-mal kleiner als eines auf Tiefe 13 — das bleibt
  so, egal wie kompakt die Position ist.
- Aber die Gesamtfläche aller Reste ist gross genug (35–70%), weil die
  vielen kleinen Stücke zusammen addieren.
- Das alte externe Kompaktieren ist bei hoher Tiefe zusammengebrochen
  (Float), wodurch die Fläche auf 0% fiel. Teil C fixt das.

### Architektur

Die Kompaktierung (`buildCompactionMap` / `computeCompactionAt` /
`getSmoothedCompactedLogicalRect` in `bank-core.js`) schließt die Lücken
entnommener Stücke bereits zeitlich WEICH (C¹ via `computeSegmentBlend`) und
masse-/trägheitsgewichtet (Anker = schwerste Gruppe, siehe CLAUDE.md
"Layout-Umordnungen"). Sie wird bisher NUR als separater Render-Modus
genutzt, nicht als **Koordinatenbasis des Zooms**.

Teil C baut die Zoom-Bounding-Box aus den kompaktierten Rects statt aus den
rohen relativen Koordinaten. Konkret:

1. Pro Zoom-Checkpoint `t` wird via `computeCompactionWaypoints()` (bereits
   C¹, Wegpunkte bei jeder Sichtbarkeitsänderung) das kompaktierte, geglättete
   Logical-Rect jedes Restsücks geholt: `makeCompactedLogicalRectLookup(wp)(p, t)`
   → `{x,y,w,h}` im kompaktierten Raum. C¹ via `computeSegmentBlend` —
   keine zweite Kompressionsfunktion.
2. Der Zoom-Rahmen wird aus DIESEN kompaktierten Rects gebaut, **relativ zum
   Anker im kompaktierten Raum** (rein Float, keine absoluten `p.x`):
   - Anker = schwerste sichtbare Gruppe (max `w*h`) für ruhige Kamera
     (CLAUDE.md "Layout-Umordnungen", User-Vorgabe).
   - `relW = r.w / anchorRect.w`, `x0 = (r.x - anchorRect.x) / anchorRect.w`.
   - `minRelX/maxRelX/...` über alle sichtbaren Stücke (KEIN kThresholdDiff-
     Filter — mit Kompaktierung werden ALLE Stücke berücksichtigt, der
     Parameter ist irrelevant).
3. `z = 0.5 / halfW` mit `halfW` = halbe Spanne des kompaktierten Clusters.
   Die Gesamtfläche des Rests (sum(w*h) im kompaktierten Raum) macht
   35–70% der Frame-Fläche aus — der Rest ist sichtbar.
4. `ZOOM_MARGIN = 0.05` für einen kleinen Rand am Pixelrand.
5. Zeitliche C¹-Glätte: Rect-Glätte via `computeSegmentBlend` (Nicht-
   Überlappungs-Garantie) + Zoom-Dämpfung via `buildDampedFilterBundle()`
   (träge Kamera, kein Zappeln).

### Umsetzungsschritte

1. `compiler.js`: `computeCompactionWaypoints(bank_pieces, maxTick,
   ZOOM_COMPACTION_TRANSITION_TICKS)` **immer** berechnet (unabhängig vom
   `compactionEnabled` Render-Modus) — der Zoom braucht die kompaktierten
   Rects zwingend.
2. `zoom_rect_lookup = makeCompactedLogicalRectLookup(zoom_waypoints)` —
   Performance-optimierter Lookup (berechnet `times` nur einmal).
3. In der Zoom-Schleife: Anker = schwerste Gruppe (max `w*h`), Rects via
   `zoom_rect_lookup(p, t)`, Rahmen relativ zum Anker im kompaktierten Raum.
4. `kThresholdDiff` wird nicht mehr gebraucht (kompaktierte Geometrie
   ersetzt den Filter). Bestehender Code kann entfernt/ignoriert werden.

### Testkriterien

Erweiterung von `tests/unit/zoom-robust.test.js`:

1. **Rest-Fläche sichtbar:** bei base 2/10 und Tiefe 20/30/40/50 ist die
   Gesamtfläche aller sichtbaren Reste (nach Kompaktierung) als Bruchteil
   der Frame-Fläche ≥ 10%. Gemessen: `sum(w*h) / (frameW * frameH)` im
   Anker-relativen Koordinatensystem. Bestätigt: 35–70% (Messung).
2. **Sichtbarkeit im kompaktierten Raum:** alle sichtbaren Stücke (kein
   Filter) müssen nach Zoom-Transformation in [0,1] liegen. Keine NaN/
   Infinity in z, cx, cy, offsetX/Y.
3. **Weiche Transition:** z/Rahmen-Center ändern sich C¹-stetig über die
   Zeit (via `computeSegmentBlend` + `buildDampedFilterBundle`).
4. **Regression:** bestehende Teil-B-Tests (relativePosition, isolationScore,
   z endlich) bleiben grün.
5. Vollständige Unit-Suite + `pnpm check` + `pnpm build` + E2E grün.
6. **Wichtig (AGENTS.md):** jede Änderung am Zoom-Pfad braucht `pnpm build`
   + E2E — JS-Fehler crashen die ganze Seite und bleiben in node-Tests
   unsichtbar.

### Nächster Schritt (nach Umsetzung)

Offen: Verhalten bei Tiefe 60+ (Stückzahl ~67k) prüfen — ob die
Kompaktierungs-Waypoints dort performance-mäßig tragen und die Rest-Fläche
über 10% bleibt.

## Teil D: Rekursives Box-in-Boxes-Modell ersetzt Wegpunkte/externe Kompaktierung

Konsolidiert aus einer Diskussion zu `docs/NEW-REST-MODEL-SPEC.md` (Ausgangs-
Vorschlag des Users, dort unverändert als Rohfassung stehen gelassen). Status:
**Entwurf, mit User besprochen, noch nicht implementiert.** Ersetzt (nicht
ergänzt) die Rendering-/Kompaktierungs-Schicht aus Teil C, sobald umgesetzt.

### Befund

- `bank_pieces` (`bank-core.js`) ist bereits genau der Baum, den ein
  rekursives Box-in-Boxes-Modell braucht: jeder Schnitt teilt einen Parent in
  genau `BASE` gleich große Kinder entlang **einer** Achse
  (`is_vert_cut`, `bank-core.js:169-176`) - kein Umbau des Kernalgorithmus
  nötig, nur additive Felder (wie schon Teil B).
- Die zweistufige Architektur aus Teil C (Wegpunkte vorberechnen via
  `computeCompactionWaypoints`, dann pro Frame interpolieren/lookup via
  `makeCompactedLogicalRectLookup`) hat zwei strukturelle Nachteile, die ein
  Live-Modell nicht hat:
  - **Ordnungstreue** (CLAUDE.md Bug-Klasse 2) muss dort extern über
    `computeSegmentBlend()` erzwungen werden. Wertet man effektive
    Größe/Position dagegen als geschlossene Funktion von `t` aus, bei der
    alle Geschwister einer Box zum selben `t` per Präfixsumme ihrer
    effektiven Größen positioniert werden, ist Überlappung durch
    Konstruktion unmöglich - keine externe Garantie nötig.
  - **Live-Parameteränderung ohne Neukompilat** (z.B.
    `GAP_CLOSE_DELAY_TICKS` zur Laufzeit verstellen) ist mit vorberechneten
    Wegpunkten grundsätzlich nicht möglich, weil der Parameter im
    Wegpunkt-Raster fest eingebacken ist. Bei reiner Live-Auswertung ist er
    nur ein Formel-Parameter - Änderung wirkt im nächsten Frame.
- **Vorbedingung für Live-Auswertung bei ~67k Stücken (Tiefe 50+):** die zu
  jedem Zeitpunkt `t` tatsächlich "aktive" Teilmenge des Baums (nicht
  `beendet`, nicht `nicht gestartet`) ist strukturell klein (User-
  Beobachtung) - Pruning (siehe Architektur) macht die Kosten pro Frame
  unabhängig von der Gesamtgröße von `bank_pieces`.

### Architektur

**Datenmodell - additiv auf `bank_pieces`, keine zweite Struktur** (User-
Vorgabe: "wir wollen definitiv nicht zwei Weisheiten"):

| Spec-Feld | Herkunft |
|---|---|
| `ts` | `born_time` (vorhanden) |
| `td` | `cut_time` (vorhanden) |
| `te` (Blatt) | **neu**, beim Entnehmen einmalig berechnet + eingefroren (siehe unten) |
| `te` (geteilt) | rekursiv `max(te_child)` über alle Kinder, sobald bekannt |
| `wd`/`hd` | `w`/`h` (vorhanden, ändern sich nach Erzeugung nie) |
| `k` | `k` (vorhanden) |
| `dir` | **neu**, 1 Feld: beim Schnitt am Parent speichern (bisher nur implizit über `localOffsetX` vs. `localOffsetY` der Kinder ablesbar) |

**Zeitachse:** dieselbe Tick-Achse wie die Simulation, aus Symmetriegründen
(User-Entscheidung) - kein separates Animationszeit-Mapping für dieses
Modell nötig; die vorhandene `buildTickTimeMapping`-Brücke bleibt für andere
Zwecke unangetastet nutzbar, falls später doch gebraucht.

**Zustandsmaschine pro Box, als reine Funktion von `t`:**

- `t < ts`: nicht gestartet → effektive Größe 0.
- `ts <= t < td` (bzw. bis zum eigenen Exit bei Blättern): gestartet, nicht
  geteilt → effektive Größe = designte Größe (`wd`/`hd`), **sofort ab `ts`**,
  kein Fade-in (User-Entscheidung: "sofort, kann später noch markiert
  werden" - siehe Offene Punkte).
- `td <= t < Exit`: geteilt → effektive Größe rekursiv aus Kindern (Summe in
  Laufrichtung `dir`, Maximum quer dazu).
- **Exit eines Blatts, 3 Phasen** (ersetzt einfaches "wird ausgeblendet" aus
  dem Ausgangsvorschlag - notwendig für "Lücke bleibt eine Zeit lang
  erkennbar", User-Vorgabe):
  1. `[taken_time, taken_time + delaySnapshot)`: effektive Größe bleibt auf
     designtem Wert stehen (Lücke sichtbar, keine Kompaktierung).
  2. `[taken_time + delaySnapshot, te)`: C¹-Ease designte Größe → 0
     (Nullsteigung an beiden Enden - vorhandenes `smoothing.js`-Bauteil
     wiederverwenden, keine neue Kernel-Formel).
  3. `t >= te`: `beendet`, effektive Größe 0, Teilbaum wird ab hier für alle
     künftigen Frames übersprungen (Pruning).
  `delaySnapshot`/die Transition-Länge werden **beim Entnehmen einmalig aus
  den dann aktuellen `GAP_CLOSE_DELAY_TICKS`/Transition-Konstanten
  eingefroren** und als Feld am Stück gespeichert (User-Vorgabe: "einfrieren
  wäre super") - eine spätere Laufzeit-Änderung der globalen Konstante wirkt
  dadurch nur auf künftige Entnahmen, nie rückwirkend auf bereits laufende
  Ausblendungen (kein Sprung).
- **Exit einer geteilten Box:** automatisch `beendet`, sobald
  `te_parent = max(te_child)` erreicht ist - keine Sonderregel, identisch
  zum Blatt-Exit aus Sicht des Elternknotens (das ist der eigentliche Kern
  der Kompaktierung, siehe Diskussion: ein leergeräumter Teilbaum verhält
  sich für seinen Parent exakt wie ein entnommenes Blatt).

**Rendering/Komposition: top-down, nicht bottom-up.** Jeder
Rekursionsschritt der ohnehin rekursiven Zeichenfunktion multipliziert einen
lokalen Skalenfaktor (Bereich `[1/BASE, 1]`, wandert Richtung `1`, während
Geschwister auf dieser Ebene kompaktieren) auf den von oben mitgeführten
Transform auf. Im Unterschied zu Teil Bs `relativePosition()` (die für
Paarvergleiche AUSSERHALB einer Top-down-Traversierung eine Ahnen-Kette zur
Laufzeit suchen musste) wird hier kein Ahnen-Walk gebraucht - der
Rekursionsabstieg IST der Walk. Jede Ebene bleibt lokal in einem
gutkonditionierten Zahlenbereich nahe 1 (kein Auslöschungsrisiko) -
Präzision entsteht durch Komposition vieler harmloser Faktoren statt durch
eine einzelne Zahl mit riesiger Dynamik. Damit wird Teil Bs
`relativePosition()`/Ahnen-Suche für den Zoom-Pfad überflüssig, sobald Teil D
den kompletten Rendering-/Zoom-Pfad übernimmt; `localOffsetX/Y` selbst kann
als Feld bleiben (harmlos, ggf. für `dir`-Herleitung nützlich).

**Moment/Masse - kontinuierlicher Zoom-Anker statt diskreter Wahl.** Jede
Box führt neben effektiver Größe zusätzlich ein Moment
(`Σ effective_size_child · center_child`) und eine Masse
(`Σ effective_size_child`) in lokalen Einheitskoordinaten mit, exakt
bottom-up komponiert wie die effektive Größe selbst. Der daraus abgeleitete
Schwerpunkt (`Moment/Masse`) ersetzt Teil Cs diskrete Anker-Wahl ("schwerste
sichtbare Gruppe", Zoom-Loop in `compiler.js`) durch einen stetig
mitgeführten, kontinuierlich wandernden Referenzpunkt für die Kamera - keine
Sprunggefahr durch Anker-*Wechsel* (welche Gruppe gerade "am schwersten"
ist), weil diese diskrete Entscheidung entfällt. Formalisiert damit exakt
CLAUDE.mds Massen-/Trägheits-Regel für Layout-Umordnungen ("große Objekte
bekommen am wenigsten Beschleunigung") - hier nicht als Sonderregel für eine
Ebene, sondern strukturell in jeder Rekursionsebene eingebaut.

**Live-Auswertung pro Frame mit Pruning:** die Rekursion steigt nur in einen
Teilbaum ab, wenn er zum aktuellen `t` weder `beendet` noch `nicht
gestartet` ist (letzteres hat noch keine Kinder, trivial). Die "aktive
Front" ist strukturell klein, unabhängig von der Gesamtgröße von
`bank_pieces` (~67k bei Tiefe 50).

### Offene Punkte (bewusst nicht in diesem Konsolidierungsschritt entschieden)

- **Fade-in bei `ts`:** User-Entscheidung "sofort" (kein Fade-in) -
  markiert als mögliche spätere Verfeinerung, falls sich beim Bauen ein
  sichtbarer C⁰/C¹-Sprung zeigt (siehe Testkriterium 4 unten).

### Verhältnis zu Teil A/B/C

- **Teil A** (exakte `l`/`l²`/`R` über BigInt-Ziffernzählung) bleibt komplett
  unberührt - eigene, unabhängige Quelle (`axes`/`p.k`), keine Berührung mit
  diesem geometrischen Rendering-Modell.
- **Teil B** wird für den Zoom-Pfad funktional überflüssig (siehe
  Architektur oben), muss aber nicht sofort entfernt werden - additive
  Felder bleiben, nur der Aufrufpfad ändert sich.
- **Teil C** (Wegpunkte + `zoom_rect_lookup`) wird komplett **ersetzt**, nicht
  ergänzt - Teil D übernimmt Kompaktierung und Zoom-Framing in einem
  Mechanismus.

### Umsetzungsschritte (Entwurf, vor Beginn mit User zu bestätigen)

1. `bank-core.js`: `dir`-Feld beim Schnitt ergänzen (additiv,
   `getPieceFromBank`).
2. `bank-core.js`: `te`/`delaySnapshot`-Felder beim Entnehmen berechnen
   (`taken_time` + aktuell gültige `GAP_CLOSE_DELAY_TICKS`/Transition-Länge).
3. Neues Modul (Kandidat: eigene Datei, z.B. `recursive-layout.js`, um
   `bank-core.js` nicht weiter aufzublähen): `effectiveSize(box, t)` +
   `composeTransform(box, t, parentTransform)` als reine, pro Frame neu
   ausgewertete Funktionen mit Pruning.
4. `TargetBankCanvas.svelte`: Rendering + Zoom-Framing auf die neue
   Top-down-Rekursion umstellen, alte Wegpunkt-Aufrufe entfernen.
5. `compiler.js`: `computeCompactionWaypoints`/`zoom_rect_lookup`-Aufrufe aus
   `finalizeCompiled` entfernen, sobald Teil D produktiv ist.

### Testkriterien (Entwurf)

1. **Pruning-Korrektheit:** ein Teilbaum, dessen `te` erreicht ist, wird
   nachweislich nicht mehr rekursiv besucht (Aufruf-Zähler-Test).
2. **Ordnungstreue automatisch:** für zufällige `t`-Stichproben überlappen
   Geschwister nie (Regressionstest gegen CLAUDE.md Bug-Klasse 2, hier als
   Beweis der Konstruktion statt externer Prüfung).
3. **Eingefrorene Delay-Werte:** `GAP_CLOSE_DELAY_TICKS` zur Laufzeit
   ändern - bereits laufende Ausblendungen bleiben unverändert (kein
   Sprung), nur neue Entnahmen nutzen den neuen Wert.
4. **C¹ an Phasengrenzen:** Ableitung der effektiven Größe an
   `taken_time + delaySnapshot` und an `te` numerisch prüfen (keine
   Sprünge); zusätzlich Ableitung an `ts` prüfen und dokumentieren, ob der
   "sofort"-Ansatz dort tatsächlich sprungfrei bleibt (siehe Offene Punkte).
5. **Performance:** aktive Knotenzahl pro Frame bei Tiefe 50+ bleibt klein
   (messen, nicht nur behaupten - analog Teil As Testkriterium 6).
6. **Präzision:** keine NaN/Infinity über den gesamten Tiefenbereich bis
   mindestens Tiefe 60 (Nachfolgetest zu Teil Bs Testkriterium 10, diesmal
   ohne Ahnen-Suche).
7. **Regressions-Parität:** bei Tiefe 3-8 weichen Positionen/Größen von den
   heutigen (Teil-C-)Werten innerhalb enger Toleranz ab (visuell keine
   Überraschung).
8. **E2E:** Canvas bleibt über die komplette Wiedergabe bei Tiefe 22 visuell
   stabil (analog Teil B Testkriterium 15).
9. **Schwerpunkt stetig:** der komponierte Moment/Masse-Schwerpunkt ändert
   sich C¹-stetig über `t` (keine Sprünge bei Entnahme/Fade einzelner
   Stücke) - direkter Test der "kein Sprung durch Anker-Wechsel"-Behauptung.

### Nächster Schritt

Diese Skizze mit dem User gegenlesen (insb. Offene Punkte Fade-in/
Moment-Masse). Der aktuelle Branch-Stand ist laut User "kläglich
gescheitert" (uncommittete Änderungen an `TargetBankCanvas.svelte`,
`bank-core.js`, `smoothing.js`, `bank-core-compaction.test.js`) - vor Beginn
der Umsetzung klären, ob dieser Stand zurückgesetzt wird (ggf. für spätere
Auswertung gesichert, z.B. als Patch/Branch) und Teil D auf sauberem Stand
nach committetem Teil C neu aufgesetzt wird.
