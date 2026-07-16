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
  `GLOBAL_TTM`, `GLOBAL_AUTO_ZOOM_*`, `GLOBAL_BANK_ZOOM_*`,
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
