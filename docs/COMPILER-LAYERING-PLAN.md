# Compiler-Layering: Struktur/Darstellung trennen, inkrementelle Tiefe, Dual-Path-Zoom

Eigenständiger Plan, ergänzend zu `docs/ASYNC-COMPILE-PLAN.md`. Während der
Async-Plan das Symptom behandelt (Neuberechnung blockiert den Main-Thread),
senkt dieser Plan die eigentlichen Rechenkosten - für einen Großteil der
Alltags-Regler (Zoom-Trägheit, Zoom-Schwellwert, Kompaktierung) wird gar
keine Neuberechnung von `buildSystem()` mehr nötig. **Empfohlene
Reihenfolge: dieser Plan zuerst** (kleiner, isolierter Eingriff in
`compiler.js`, sofortiger spürbarer Nutzen), der Async-Plan danach/parallel
für die verbleibenden echten Neuberechnungsfälle.

## Befund: die Trennung existiert schon strukturell, wird nur nicht genutzt

In `compileSystem()` (`src/lib/compiler.js`) hängen `GLOBAL_BANK_ZOOM_SPLINE`
(Zeile 260-277) und `GLOBAL_COMPACTION_*` (Zeile 285-315) ausschließlich von
`bank_pieces`, `local_max_time` und ihren eigenen Config-Werten ab
(`zoomSpeedCoef`, `bankZoomThresholdPowers`, `compactionEnabled`,
`compactionTransitionTicks`) - **nicht** direkt von `base`/`depth`/
`transformMode`. Trotzdem läuft bei JEDER Config-Änderung der komplette,
teure `buildSystem()`-Aufruf erneut, auch wenn er für den geänderten
Parameter irrelevant ist.

## A. Config-Gruppen trennen, `compileSystem()` aufspalten

- **STRUKTURELL** (`base`, `depth`, `transformMode`): bestimmt
  `bank_pieces`/`render_pipeline`/`axes` - teuer (siehe
  `ASYNC-COMPILE-PLAN.md`, O(TOTAL_STEPS²)-artiges Wachstum), selten geändert.
- **DARSTELLUNG** (`zoomSpeedCoef`, `bankZoomThresholdPowers`,
  `compactionEnabled`, `compactionTransitionTicks`): nur die
  Zoom-/Kompaktierungs-Ableitung - billig (linear in der Anzahl Checkpoints,
  nicht in `TOTAL_STEPS²`), vermutlich die im Ausstellungsbetrieb am
  häufigsten gedrehten Regler.

Aufteilung (deckt sich mit dem `compileSystemData()`/`finalizeCompiled()`-Split
aus dem Async-Plan, ergänzt ihn um eine weitere Zwischenstufe):

- `simulateBank(base, depth, transformMode)` - reine Funktion der drei
  strukturellen Parameter, liefert `axes`, `TOTAL_STEPS`, `bank_pieces`,
  `render_pipeline`, `n_arr`, `P_FINAL`, `shell_start_time`,
  `tickTimePairs`, `local_max_time`. Cachebar (siehe B).
- `derivePresentation(simResult, presentationConfig)` - baut darauf
  `GLOBAL_TTM`, `GLOBAL_TARGET_DISPLAY_*`, `GLOBAL_BANK_ZOOM_*`,
  `GLOBAL_COMPACTION_*`. Läuft bei JEDER Presentation-Änderung neu, ist
  aber billig genug, um synchron auf dem Main-Thread zu bleiben (kein
  Worker nötig für diesen Pfad).
- `compileSystem(config) = derivePresentation(simulateBank(...), config)`
  bleibt als Wrapper für Rückwärtskompatibilität (Tests, Fallback).

## B. Memoization von `simulateBank()`

- Cache-Key: `${base}|${depth}|${transformMode}`.
- Kleiner LRU-Cache (Kapazität konfigurierbar, Vorschlag: 8 Einträge) -
  Speicher/Zeit-Tradeoff, verhindert unbegrenztes Wachstum bei viel
  Herumprobieren.
- Cache-Hit: `simulateBank()` liefert sofort, kein `buildSystem()`-Lauf.
- Cache-Miss: voller Lauf wie bisher (im Async-Plan: im Worker).

## C. Inkrementelle Tiefen-Erweiterung (baut auf B auf)

**Beweis aus dem Code, dass das architektonisch sauber geht:**

- `n_arr`/`P_int` (`bank-core.js:41-55`): klassischer Stellen-für-Stellen-
  Algorithmus. `P_int` trägt den Zustand über die Stellen; Stelle `m` hängt
  nie von der Zieltiefe `N_MAX` ab, nur von den Stellen `1..m-1`.
- `axes` (`bank-core.js:56-58`): strikte Präfix-Erweiterung - mehr Tiefe
  hängt nur neue Einträge hinten an, ändert nie vorhandene.
- `buildSystem()`s Schalen-Schleife (`bank-core.js:244-264`) referenziert
  nirgends `N_MAX`/`TOTAL_STEPS` direkt - nur `axes[u]`/`axes[v]` für
  `u,v ≤ S`, und diese Werte sind bei größerer Zieltiefe identisch.
  `getPieceFromBank()`/`isolationScore()`/`filterToStripEnds()`
  (`bank-core.js:79-140`) haben ebenfalls keinen `N_MAX`-Bezug, nur den
  laufenden `bank_pieces`/`tick`-Zustand.

**Konsequenz:** hält man den `sim`-Zustand (bank_pieces + tick + axes +
n_arr/P_int) zwischen Compiler-Läufen, kann `buildSystem()` bei
Tiefen-**Erhöhung** einfach ab der alten `TOTAL_STEPS` weiterschaleln -
kein Neurechnen der bereits fertigen Schalen. Aus O(neue_Tiefe²) wird grob
O(neue_Tiefe² − alte_Tiefe²).

**Nur für Erhöhung.** Der Zustand ist irreversibel mutiert (`taken_time`,
`children`-Arrays beim Zerschneiden) - eine Tiefen-*Verringerung* kann
nicht rückwärts laufen. Fallback: Cache-Lookup auf eine bereits besuchte
kleinere Tiefe (Snapshot im LRU-Cache aus B), sonst normaler Neulauf
(ohnehin billiger bei kleinerer Tiefe).

**API-Änderung:** `buildSystem()` bekommt einen optionalen `resumeFrom`-
Parameter (bestehende `sim`-Instanz + Start-Schale), Default-Verhalten
(kein `resumeFrom`) bleibt unverändert. **Das ist der einzige Punkt in
diesem Plan, an dem `bank-core.js` selbst angefasst wird** - laut
`CLAUDE.md` ein Modul mit dokumentierter Historie an genau dieser Art von
Fehlern (Fehlerklasse 2 zu unabhängig geglätteten Werten betrifft dies
zwar nicht direkt, aber die generelle Warnung "fragil, gut testen" gilt).
Entsprechend hohe Sorgfalt: rein additive Änderung, bestehende
`bank-core*.test.js` müssen unverändert grün bleiben, PLUS der neue
Kerntest unten (Testkriterium 5).

## D. Dual-Path-Zoom: beide Layouts immer berechnen, Umschalt-Strategie

Heute wird `GLOBAL_BANK_ZOOM_SPLINE` bereits **immer** berechnet
(`compiler.js:260-277`) - nur `GLOBAL_COMPACTION_*` ist bedingt
(`if (compactionEnabled)`, Zeile 288). Vorschlag: `GLOBAL_COMPACTION_*`
ebenfalls immer mitberechnen (Kosten sind laut Code-Kommentar "nicht
kostenlos bei tiefer Rekursion", aber deutlich billiger als
`buildSystem()`, da nur auf bereits vorhandenem `bank_pieces` operierend -
per Benchmark verifizieren, siehe Testkriterium 8, nicht annehmen).

**Stufe 1 (dieser Plan, geringer Aufwand):** hartes Umschalten beim
Rendern bleibt wie heute (`project()` wählt einen der beiden Zustände),
aber weil beide Layer schon vorab berechnet sind, ist der Wechsel
**sofort** - kein Ruckler durch Recompute mehr. Löst den eigentlichen
Schmerzpunkt vollständig, ohne die Render-Architektur anzufassen.

**Stufe 2 (separate Recherche, NICHT Teil dieses Plans):** lineare
Interpolation zwischen beiden fertigen Zuständen beim Umschalten, wie
vorgeschlagen. Zwei Dinge sprechen dagegen, das hier einfach mitzunehmen:

- Nach der `CLAUDE.md`-Regel "Automatisierte Parameteränderungen: stetige
  Ableitung" braucht ein automatisierter Übergang mindestens C¹-Stetigkeit
  (kein Sprung in Wert ODER Steigung). Eine reine lineare Überblendung über
  eine feste Dauer springt an BEIDEN Enden in der Steigung (Geschwindigkeit
  0 → >0 → 0). Der richtige Baustein wäre `computeSegmentBlend()`
  (`smoothing.js`) - exakt der dort beschriebene Fall "mehrere voneinander
  abhängige Werte, deren relative Lage eine Invariante einhalten muss"
  (hier: Nichtüberlappung der Stücke), nicht ein Ad-hoc-Lerp.
- Kompaktierung ändert nicht nur Zoom/Offset, sondern blendet auch STÜCKE
  AUS und verschiebt Positionen (andere Anzahl/Lage sichtbarer Rechtecke
  als im reinen Bank-Zoom). Eine reine z/offsetX/offsetY-Interpolation
  reicht dafür vermutlich nicht - es ist unklar, ob eine echte Überblendung
  zwischen "kompaktiert" und "unkompaktiert" ohne größere Änderungen an
  `project()`/`TargetBankCanvas.svelte` überhaupt sauber geht. Das ist eine
  eigenständige Rendering-Architektur-Frage, kein Compiler-Performance-Thema
  - als offener Punkt vermerkt, bewusst nicht in diesem Plan ausimplementiert.

## Testkriterien

**Unit (`node --test`, `tests/unit/`):**

1. **Split-Äquivalenz:** `derivePresentation(simulateBank(b,d,m), config)`
   liefert bit-identisches Ergebnis zu `compileSystem(config)` (analog zum
   entsprechenden Kriterium im Async-Plan).
2. **Memoization greift:** zwei `simulateBank()`-Aufrufe mit identischem
   `(base, depth, transformMode)` - `buildSystem()` wird nachweislich nur
   EINMAL aufgerufen (Spy/Zähler), unabhängig davon, wie oft sich
   Presentation-Parameter dazwischen ändern.
3. **Cache-Invalidierung korrekt:** Änderung von `base` ODER
   `transformMode` bei gleicher `depth` erzeugt garantiert einen NEUEN
   `simulateBank()`-Lauf (kein falscher Cache-Hit über Parametergrenzen
   hinweg).
4. **LRU-Verdrängung:** bei Cache-Kapazität N werden nach N+1
   unterschiedlichen `(base, depth, transformMode)`-Kombinationen ältere
   Einträge verdrängt - nachweisbar durch erneuten vollen Lauf bei
   erneuter Anfrage des verdrängten Keys.
5. **Inkrementelle Tiefe bitidentisch (Kerntest):**
   `buildSystem(base, 20, mode, { resumeFrom: sim@depth16 })` liefert
   `bank_pieces`/`render_pipeline`/`axes` bitidentisch zu
   `buildSystem(base, 20, mode)` von Grund auf - für mehrere
   `(base, transformMode)`-Kombinationen, inkl. Randfälle (Tiefensprung um
   1, um viele, `depth=1 → depth=2`).
6. **Tiefen-Verringerung sicher:** fällt korrekt auf Cache-Lookup oder
   vollen Neulauf zurück, produziert nie ein zu tiefes/falsches Ergebnis.
7. **`GLOBAL_COMPACTION_*` jetzt immer befüllt:** `compactionEnabled=false`
   liefert trotzdem befüllte `GLOBAL_COMPACTION_*`-Felder. **Bricht den
   bestehenden Test `compiler.test.js:97` ("... alle GLOBAL_COMPACTION_*-
   Felder sind leer/null") - der muss bei Umsetzung explizit angepasst
   werden, nicht übersehen.**
8. **Performance-Benchmark, nicht Annahme:** `GLOBAL_COMPACTION_*`-
   Berechnung bei typischer Tiefe (z.B. 16) kostet auch bei
   `compactionEnabled=false` unter einer noch festzulegenden Schwelle
   zusätzlich (empirisch ermitteln, nicht raten) - Beweis, dass "immer
   berechnen" nicht selbst zum neuen Bottleneck wird.
9. **Hartes Umschalten ist recompute-frei:** `compactionEnabled` bei
   bereits kompiliertem Zustand toggeln löst keinen neuen
   `buildSystem()`-Lauf aus (Spy/Zähler bleibt bei 0 neuen Aufrufen) und
   liefert den jeweils anderen Layer synchron.

**E2E (`tests/e2e/`, optional, macht Stufe 1 sichtbar):**

10. Kompaktierung während laufender Animation umschalten - kein sichtbares
    Einfrieren/Ruckeln über eine Schwelle X ms (gleiche Messmethode wie im
    Async-Plan, Kriterium 6, aber hier für den Toggle statt für
    Tiefenänderung).

## Abgrenzung / Reihenfolge

- Ergänzt `docs/ASYNC-COMPILE-PLAN.md`, ersetzt ihn nicht: dieser Plan
  senkt die Häufigkeit/Kosten teurer Neuberechnungen, der Async-Plan federt
  die verbleibenden (echter `base`/`transformMode`-Wechsel, echtes
  Tiefen-Neuland jenseits des Caches) auf dem Main-Thread ab.
- Empfehlung: A+B+D-Stufe-1 zuerst (reine `compiler.js`-Änderungen, kein
  Eingriff in `bank-core.js`, kleines Risiko). C (inkrementelle Tiefe)
  danach als eigener Schritt, weil einzig hier `bank-core.js` angefasst
  wird. D-Stufe-2 (Überblendung) bewusst zurückgestellt, eigene Recherche.

## E. Render-Hotpath: Layout-Aggregate cachen (gemessen, Priorität NIEDRIG)

**Frage:** `layoutBox()` (`recursive-layout.js`) rekursiert pro Frame den
gesamten aktiven Baum ab der Wurzel neu. Lohnt es, den "für die Fortsetzung
der Rekursion notwendigen Wert" eines geschnittenen Knotens (sein Aggregat
`{w, h, mass, momentX, momentY}` + Kind-Positionen) zu cachen und nur bei
tatsächlicher Änderung neu zu berechnen?

**Messung** (Skript-Ansatz: `bank-core` + `layoutBox` headless über den
gesamten Zeitverlauf, Basis 10; `visited` = tatsächlich besuchte Knoten pro
Frame, `needed` = Knoten auf der Vereinigung aller Wurzel→Blatt-Pfade zu
Blättern, deren voll/0-Zustand sich seit dem Vorframe geändert hat, bei
~4 Frames/Tick):

| Tiefe | Knoten total | avg visited/Frame | avg needed/Frame | Speedup |
| ----: | -----------: | ----------------: | ---------------: | ------: |
|     6 |        1 511 |               108 |                3 |     37× |
|    10 |        6 141 |               185 |                4 |     43× |
|    14 |       15 711 |               282 |                6 |     50× |
|    16 |       18 931 |               301 |                6 |     50× |
|    20 |       35 011 |               398 |                7 |     55× |

Sensitivität (Tiefe 16) über Frames/Tick: 1 → 12,6×, 2 → 25,1×, 4 → 50,2×
(mehr Frames pro Tick = mehr geometrisch identische Frames = `needed ≈ 0`).

**Zwei Kernbefunde:**

1. **Pruning wirkt bereits stark.** `avg visited` bleibt bei ~300 (nicht
   Zehntausende), obwohl der Baum bei Tiefe 20 über 35 000 Knoten hat - der
   `t > te`-Prune (`recursive-layout.js:82`) überspringt abgeschlossene
   Teilbäume komplett. Die aktive Rekursion ist TIEF (langer Pfad), aber
   durch Pruning schmal.
2. **Der Cache-Faktor ist groß (~40-55×), die absolute Ersparnis klein.**
   Pro Frame ändern nur 3-7 Blätter ihren Zustand (`leafEffectiveSize` ist
   binär: voll oder 0, kein kontinuierliches Schrumpfen mehr), während
   `layoutBox` jedes Mal alle ~300 aktiven Knoten neu aggregiert. ~300
   Knoten × wenige Flops = einige µs pro Frame - im 16,7-ms-Budget
   vernachlässigbar.

**Fallstrick bei der Umsetzung:** nicht rein bottom-up cachebar. Die oberen
`MAX_CENTER_DEPTH` (=2) Ebenen zentrieren (Zwei-Pass mit `shift`,
`recursive-layout.js:110-152`), und `momentX/momentY` (Kamera-Schwerpunkt)
hängen an allen Massen. Inkrementelle Cache-Invalidierung müsste diese
Aggregate entlang jedes geänderten Wurzel→Blatt-Pfads nachziehen (genau der
billige `needed`-Pfad) - machbar, aber mit den aus den GOTCHAS bekannten
Float-/Tiefen-Fallstricken.

**Fazit / Empfehlung:** NICHT priorisieren. Der eigentliche
Performance-Schmerz sitzt im **Compiler** (siehe A-C oben + F unten), nicht
im Render-Hotpath. Wenn überhaupt, erst nach einer echten Wandzeit-Messung
von `layoutBox` (nicht nur Knotenzahl), und nur falls sehr hohe Tiefe (>20)
auf schwacher Hardware zum Thema wird. Das LCA-Debug-Overlay
(`commonAncestor`, nur `?debug=1`) ist von dieser Frage unberührt - sein
Kostenanteil ist ohnehin µs-Bereich und Debug-only.

### E.1 Basis 2, bis Iterationsstufe 40 (gemessen)

**Methodik (Herantasten statt Groß-Benchmark):** erst `buildSystem`-Wandzeit
+ Knotenzahl je Tiefe einzeln geprobt (Tiefen 4→40, hartes `timeout`), um zu
sehen WO es teuer wird, bevor die volle Layout-Messung lief. Das ist die
empfohlene Vorgehensweise für alle weiteren Läufe (Basis/Tiefe hochtasten,
nicht blind eine riesige Reihe starten - kann bei anderer Basis schnell
explodieren).

`buildSystem`-Wandzeit Basis 2: unter 11 ms bis Tiefe 28, dann 106 ms
(Tiefe 32), 137 ms (36), 200 ms (40) - unkritisch. **Ganz anders als Basis 10**
(dort ~18 000 Knoten schon bei Tiefe 16).

Layout-Cache-Messung Basis 2 (gleiche Kennzahlen wie oben, 4 Frames/Tick):

| Tiefe | Knoten | avg visited/Frame | avg needed/Frame | Speedup |
| ----: | -----: | ----------------: | ---------------: | ------: |
|     8 |     73 |                29 |                4 |    7,9× |
|    16 |    159 |                51 |                6 |    9,2× |
|    24 |    437 |               106 |                9 |   11,3× |
|    32 |    879 |               148 |               13 |   11,7× |
|    40 |  1 609 |               185 |               16 |   11,8× |

**Was das an der Einschätzung ändert:**

- **Basis 2 ist geometrisch VIEL kleiner.** Bei Tiefe 40 nur ~1 600 Knoten
  und ~185 besuchte/Frame - Basis 10 hat schon bei Tiefe 20 das ~20-fache
  (35 000 Knoten). Die kleine Basis sättigt lange (bis Tiefe ~12 bleibt die
  Bank bei 73 Knoten, weil √2 in Basis 2 nur langsam neue Stellen fordert).
- **Der Cache-Faktor ist bei Basis 2 KLEINER (~8-12× statt ~40-55×).** Grund:
  weniger Kinder pro Schnitt (2 statt 10) → jeder geänderte Blatt-Pfad macht
  einen größeren Anteil des ohnehin schmalen aktiven Baums aus, `needed`
  liegt relativ höher. Der Layout-Cache lohnt bei Basis 2 also noch WENIGER
  als bei Basis 10.
- **Gesamtfazit E bleibt bestehen und wird sogar verstärkt:** der
  Layout-Render-Cache ist für BEIDE Basen keine Priorität. Bei Basis 2 ist
  die absolute Last (185 Knoten selbst bei Tiefe 40) trivial.
- **Offen bleibt der Compiler-Wandzeit-Vergleich bei Basis 10 / Tiefe > 20**
  (nicht Basis 2 - dort ist buildSystem billig). Der eigentliche
  O(TOTAL_STEPS²)-Schmerz (Abschnitt A/F) tritt bei GROSSER Basis + Tiefe
  auf, nicht bei Basis 2. Für Basis 2 ist damit kein Compiler-Handlungsbedarf
  erkennbar. Nachgemessen in E.2.

### E.2 Compiler-Wandzeit Basis 10, Tiefe > 20 (gemessen — WAND ERREICHT)

**Methodik:** vorsichtig herangetastet, `buildSystem`-Wandzeit je Tiefe
EINZELN mit hartem `timeout` (kein Groß-Benchmark - bei Basis 10 explodiert
die Stückzahl, siehe AGENTS.md GOTCHA zu `compiler-split.test.js`).

| Basis | Tiefe | Knoten | `buildSystem` Wandzeit |
| ----: | ----: | -----: | ---------------------: |
|    10 |    16 | 18 931 |               ~4 ms\* |
|    10 |    20 | 35 011 |            **36,6 s** |
|    10 |    21 | 35 961 |              41,7 s   |
|    10 |    22 | 41 791 |              58,7 s   |

\* Tiefe 16 aus dem Herantasten in Abschnitt E (Knotenzahl), nur zur
Einordnung des Sprungs.

**Befund:** die O(TOTAL_STEPS²)-Wand ist bei Basis 10 real und hart. Von
Tiefe 20→21→22 steigt die Wandzeit 37 s → 42 s → 59 s (superlinear,
`isolationScore()` ist O(Knoten) pro Entnahme, und die Knotenzahl wächst
weiter). **Tiefe 40 bei Basis 10 ist damit praktisch nicht messbar** (grob
extrapoliert viele Minuten bis Stunden) - der Lauf wurde bei Tiefe 22 bewusst
gestoppt, die Aussage ist belegt.

**Konsequenz für die Priorisierung:**

- Basis 10 wird bereits ab Tiefe ~20 **im Sekunden-Bereich unbenutzbar** -
  das ist der konkrete Beleg für den Compiler-Handlungsbedarf (Abschnitt A-C:
  Split + Cache + inkrementelle Tiefe; F1: Hintergrund-Vorrechnen). Ohne
  diese Maßnahmen ist "Basis 10 / Tiefe 40" schlicht kein erreichbarer
  Betriebspunkt.
- Der Kontrast zu Basis 2 (Tiefe 40 in 200 ms, E.1) zeigt: das Problem ist
  NICHT die Tiefe an sich, sondern das Produkt aus Basis (Verzweigungsgrad)
  und Tiefe, das TOTAL_STEPS und damit die Knotenzahl treibt.
- Damit ist die Layout-Cache-Frage (Abschnitt E) endgültig zweitrangig: bei
  Basis 10 kommt man wegen des Compilers gar nicht erst in die Tiefen, in
  denen der Render-Cache theoretisch interessant würde.

## F. Compiler bei hohen Iterationsstufen: offene Richtungen (Recherche)

Der Compiler ist der reale Bottleneck bei hoher Tiefe (siehe
`ASYNC-COMPILE-PLAN.md`: O(TOTAL_STEPS²)-artiges Wachstum durch
`isolationScore()` pro `getPieceFromBank()`). Drei Ideen aus dem Gespräch,
als Recherche-Richtungen festgehalten (noch NICHT geplant/umgesetzt):

1. **Inkrementell tiefere Stufen WÄHREND der Animation vorrechnen.** Baut
   direkt auf C (inkrementelle Tiefen-Erweiterung, `resumeFrom`) auf: statt
   bei einer Tiefen-Erhöhung erst nach dem vollen Neulauf loszulegen, im
   Hintergrund (Worker, Idle-Zeit zwischen Frames) die nächsthöheren Schalen
   weiterschaleln, während die aktuelle Animation schon läuft. Neue
   Animationen auf höherer Tiefe könnten so nahezu sofort starten (der teure
   Teil ist bereits gerechnet, wenn der Nutzer die Tiefe hochdreht). Setzt C
   voraus (Zustand `sim` zwischen Läufen halten + `buildSystem` ab alter
   `TOTAL_STEPS` fortsetzen).

2. **Flugbewegungen (`render_pipeline`) on-demand statt als Kompilat.** Die
   `render_pipeline` (`compiler.js:185-254`) wächst LINEAR mit der Stückzahl
   (bei Tiefe 20: ~35 000 Einträge), jeder Eintrag ist ein Flug-Ereignis mit
   festen Zeiten (`time_fly`/`time_cut`/`time_fuse`) und fester Gitter-Ziel-
   position (`u`/`v`). Diese Zeiten leiten sich rein deterministisch aus der
   Entnahme-Reihenfolge (`events` aus `buildSystem`) + festen Offsets
   (`SHELL_GAP`, 0.15/0.5/1.0) ab - sie könnten pro Frame NUR für die
   aktuell sichtbaren/fliegenden Stücke berechnet werden, statt die ganze
   Liste vorab zu materialisieren. Offene Fragen: Wie findet man ohne die
   materialisierte Liste effizient "welche Stücke fliegen zum Zeitpunkt t"?
   (evtl. Index tick→Zeitfenster). Der `tickTimePairs`→`GLOBAL_TTM`-Aufbau
   hängt ebenfalls an dieser Schleife - müsste getrennt werden.

3. **Scrubbing-Genauigkeit bei hoher Tiefe absenken.** Bei den hohen
   Scrubbing-Geschwindigkeiten für hohe Iterationsstufen "flirren" ohnehin
   nur Teile durch die Gegend - eine pixelgenaue Flug-Animation ist dort
   visuell gar nicht wahrnehmbar. Denkbar: bei schnellem Scrubbing / hoher
   Tiefe die Flug-Interpolation vereinfachen oder ganz überspringen (nur
   End-Zustand rendern), was sowohl Punkt 2 (on-demand) als auch den
   Render-Aufwand entlastet. Reine Darstellungs-Optimierung, kein
   Korrektheits-Thema - muss die C¹-Regel (CLAUDE.md) nur dort einhalten, wo
   tatsächlich noch eine sichtbare Bewegung stattfindet.

**Priorität:** 1 und 2 sind die substanziellen Hebel für "hohe Tiefe fühlt
sich träge an". 3 ist eine billige Ergänzung, die 2 zusätzlich rechtfertigt.
Alle drei setzen sinnvoll erst NACH A-C dieses Plans auf (Split + Cache +
inkrementelle Tiefe als Fundament).

## Status der Nachmessungen (Basis=2 / hohe Tiefe) — ERLEDIGT

Die ursprüngliche Messung in Abschnitt E beruhte NUR auf **Basis 10,
Tiefe ≤ 20**. Nachmessungen (beide erledigt, Details in E.1/E.2):

- [x] **Basis = 2, bis Iterationsstufe 40** - erledigt, siehe Abschnitt E.1.
      Ergebnis: geometrisch viel kleiner (Tiefe 40 ≈ 1 600 Knoten),
      Cache-Faktor kleiner (~8-12×), `buildSystem` billig (≤ 200 ms). Kein
      Handlungsbedarf für Basis 2.
- [x] **Basis = 10, Tiefe > 20 - Compiler-WANDZEIT** - erledigt, siehe
      Abschnitt E.2. Ergebnis: O(TOTAL_STEPS²)-Wand real (Tiefe 20 ≈ 37 s,
      22 ≈ 59 s, superlinear); Tiefe 40 praktisch nicht messbar. Belegt den
      Compiler-Handlungsbedarf (A-C, F1).

Reproduktion: `node scripts/measure-layout-cache.mjs [BASE] [tiefen...]`
(nimmt Basis + Tiefen als CLI-Argumente). Für die Compiler-Wandzeit reicht
ein kleines `buildSystem`-Timing-Skript wie beim Herantasten in E.1.
