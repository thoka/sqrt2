# Neuberechnung asynchron & cancelbar

Teilplan zu `INTERFACE-TODO.md` ("Stattdessen: Neuberechnung asynchron und
cancelbar (bei Wertänderung)"). Der einzige wirklich komplexe Punkt im
Interface-Umbau - eigenes Dokument, eigene Testkriterien.

**Verhältnis zu `docs/COMPILER-LAYERING-PLAN.md`:** dieser Plan behandelt
das Symptom (Neuberechnung blockiert den Main-Thread), der Layering-Plan
senkt die eigentlichen Kosten (Caching, inkrementelle Tiefe, Dual-Path-Zoom)
und sollte zuerst umgesetzt werden - danach greift dieser Plan nur noch für
die verbleibenden echten Neuberechnungen (structural changes, Tiefen-Neuland
jenseits des Caches).

## Ist-Zustand (warum es überhaupt blockiert)

`compiledStore = derived(configStore, ($config) => compileSystem($config))`
(`src/lib/stores.js:43`) läuft **synchron auf dem Main-Thread**, jedes Mal
wenn sich `configStore` ändert (base/depth/mode/zoomthresh/compaction/
zoomSpeedCoef - die "pre"-Felder, die laut `ControlPanel.svelte`-Kommentar
ohnehin nur bei `change`/Blur feuern, nicht bei jedem Tastendruck).

`compileSystem()` (`src/lib/compiler.js`) ruft `buildSystem()`
(`bank-core.js:240`) auf: eine Schleife über `TOTAL_STEPS` Schalen, die pro
Schale `getPieceFromBank()` aufruft - darin wiederum `isolationScore()`,
O(Anzahl bank_pieces) pro Aufruf. Das ist der Grund für "Tiefe > 5 kann
Leistung beeinträchtigen": die Kosten wachsen überproportional mit `depth`.
Bestätigt durch die eigene Warnung im UI, nicht nur vermutet.

**Wichtiger Befund für die Architektur:** Das Ergebnis von `compileSystem()`
ist NICHT plain-serialisierbar. `buildTickTimeMapping()`
(`bank-core.js:624`) gibt Closures zurück (`tickToTime`, `timeToTick`),
ebenso `buildMonotoneSpline()`/`buildDampedFilterBundle()`
(`smoothing.js`). Ein Web Worker kann per `postMessage` nur strukturiert
klonbare Daten übergeben - Funktionen gehen dabei verloren. Ein naiver
"ganzes `compileSystem()` in den Worker" Ansatz funktioniert deshalb nicht
ohne Weiteres.

## Architekturentscheidung

**1. `compiler.js` in zwei Phasen aufteilen, keine Verhaltensänderung:**

- `compileSystemData(config)` - der TEURE, rein numerische Teil (worker-tauglich):
  `buildSystem()`, die `render_pipeline`/`tickTimePairs`-Schleife, die
  `bank_zoom_states`-Schleife, `computeCompactionWaypoints()`. Rückgabe: nur
  Arrays/Zahlen/Plain-Objects, keine Funktionen.
- `finalizeCompiled(data, config)` - der BILLIGE Rest: `buildTickTimeMapping()`,
  `buildMonotoneSpline()`, `buildDampedFilterBundle()`,
  `makeCompactedLogicalRectLookup()`. Läuft auf bereits vorverdichteten
  Checkpoint-Arrays (nicht mehr O(TOTAL_STEPS²)) - schnell genug für den
  Main-Thread, baut nur die Closures.
- `compileSystem(config) = finalizeCompiled(compileSystemData(config), config)`
  bleibt als Kompatibilitäts-Wrapper bestehen (bestehende Tests, Node-Kontext
  ohne Worker, Fallback) - reine Umbenennung/Aufteilung, keine Logikänderung.
  `bank-core.js`/`smoothing.js` selbst werden NICHT angefasst (siehe
  CLAUDE.md-Warnung zu deren Fehlerklassen - jede Änderung dort ist
  riskant, hier nicht nötig).

**2. Web Worker + Terminate-basierte Cancellation, keine kooperative
Abbruchprüfung:**

`buildSystem()`/`getPieceFromBank()` ist eine eng verschachtelte,
synchrone Schleife - eine "prüfe ob abgebrochen" Kondition mittendrin
einzubauen wäre ein Eingriff in genau den Code, den CLAUDE.md als fragil
markiert. Stattdessen: pro Compile-Job wird ein **frischer Worker**
gestartet; kommt ein neuer Job, während der alte noch läuft, wird der
alte Worker per `Worker.terminate()` hart beendet (kein Ergebnis, keine
Nachricht mehr von ihm) und ein neuer gestartet. Einfach, robust, kein
Risiko für die Simulations-Korrektheit.

**3. Fortschrittsanzeige: erst indeterminiert, echte % optional später.**

Phase A (dieser Plan): reiner "läuft noch"-Indikator, der erst nach einer
kurzen Schwelle (z.B. 300 ms) erscheint - kein Rechenaufwand, keine
Änderung an `bank-core.js` nötig, deckt die TODO-Anforderung
("Progress-Anzeige, wenn es länger dauert") ab.
Phase B (optional, separat zu entscheiden): echte Prozentanzeige durch
einen zusätzlichen, rein additiven `onProgress(S, TOTAL_STEPS)`-Callback
in der `for (let S = 1; S < sim.TOTAL_STEPS; S++)`-Schleife in
`buildSystem()` - ändert keinen Wert/keine Reihenfolge, nur ein Seitenkanal.
Erst nach Phase A und nur auf Wunsch.

**4. Store-Layer:**

- `compiledStore` wird von `derived()` auf `writable()` umgestellt, befüllt
  durch einen Orchestrator (`src/lib/compileOrchestrator.js`, neu):
  - abonniert `configStore`
  - bei Änderung: `jobId++`, laufenden Worker terminieren, neuen Worker mit
    `{ jobId, config }` starten
  - `worker.onmessage`: `finalizeCompiled(data, config)` aufrufen, in
    `compiledStore` schreiben, `compileStatusStore` auf `idle` setzen
  - Fallback ohne Worker-Support (z.B. `typeof Worker === 'undefined'`):
    synchron `compileSystem(config)` wie bisher, mit `console.warn` einmalig
- neuer `compileStatusStore` (`{ state: 'idle'|'compiling', startedAt }`) -
  treibt die Progress-Anzeige, sonst nichts.
- `configStore` selbst bleibt synchron/sofort (Tippen/URL-Export dürfen
  NICHT auf den Compile warten - nur `compiledStore` hinkt hinterher).

**Nicht-Ziele:** kein Worker-Pool, keine parallele Mehrfach-Kompilierung,
keine partiellen/Teilergebnisse, keine Änderung an `bank-core.js`/
`smoothing.js` selbst (außer optionalem Progress-Callback in Phase B).

## Umsetzungsschritte

1. `compiler.js`: `compileSystem()` in `compileSystemData()` +
   `finalizeCompiled()` aufteilen, `compileSystem()` als Wrapper erhalten.
2. Neuer Test: `compileSystemData(c)` + `finalizeCompiled(data, c)` liefert
   bit-identisches Ergebnis zu `compileSystem(c)` (Regressionsschutz für
   den Split selbst).
3. `src/lib/compile.worker.js` (neu): `onmessage({jobId, config})` ->
   `postMessage({jobId, data: compileSystemData(config)})`.
4. `src/lib/compileOrchestrator.js` (neu): Terminate-basierte
   Job-Verwaltung wie oben beschrieben, exportiert `compiledStore` +
   `compileStatusStore`.
5. `stores.js`: `compiledStore`-Export auf den Orchestrator umstellen
   (Konsumenten in `ControlPanel.svelte`/`App.svelte`/`PlaybackBar.svelte`
   ändern sich nicht - gleicher Store-Name, gleiche Form).
6. Kleine Progress-UI (z.B. dünner Balken/Spinner im `settingsPanel` oder
   nahe `#errorMsg`), sichtbar nur wenn `compileStatusStore.state ===
   'compiling'` UND `Date.now() - startedAt > 300`.
7. Fehlerfall im Worker (`try/catch` um `compileSystemData`) -> bestehendes
   `#errorMsg`-Element wiederverwenden statt neuem UI-Element.

## Testkriterien

**Unit (`node --test`, `tests/unit/`):**

1. **Split-Äquivalenz:** für eine Matrix aus Configs (u.a. depth=1, depth=5,
   depth=16 Standard, depth=100 Extremfall, base=2, base=16, beide
   `transformMode`, `compactionEnabled` true/false) liefert
   `finalizeCompiled(compileSystemData(c), c)` ein zu `compileSystem(c)`
   identisches Ergebnis - inkl. Stichproben-Auswertung der Closures
   (`GLOBAL_TTM.timeToTick`/`tickToTime`, `GLOBAL_TARGET_DISPLAY_SPLINE`,
   `GLOBAL_BANK_ZOOM_SPLINE`) an mehreren `t`-Werten, nicht nur
   Referenzgleichheit der Objekte.
2. **Bestehende Suite unverändert grün:** `compiler.test.js`,
   `bank-core-compaction.test.js`, `smoothing.test.js`,
   `auto-zoom-visibility.test.js` laufen ohne Anpassung durch (Beleg, dass
   `bank-core.js`/`smoothing.js` nicht angetastet wurden).
3. **`compileSystemData()` ist worker-tauglich:** `JSON.stringify()` (oder
   `structuredClone()`, falls in der Testumgebung verfügbar) auf dem
   Rückgabewert wirft nicht und verliert keine für `finalizeCompiled()`
   nötigen Felder (Beweis: kein Funktionswert im Baum).
4. **Fallback-Pfad:** mit `Worker` auf `undefined` gestubbt liefert der
   Orchestrator dasselbe Ergebnis wie der Worker-Pfad (gleiche Config,
   gleiches `compiledStore`-Ergebnis) - der Fallback ist korrekt, nicht nur
   vorhanden.
5. **Job-Ersetzung race-frei (mit gestubbtem/künstlich verzögertem
   Worker):** zwei Config-Änderungen kurz hintereinander (z.B. depth=20,
   dann depth=5, bevor der erste "fertig" postet) -> im `compiledStore`
   landet niemals ein Zwischenergebnis, das zu depth=20 gehört, NACHDEM
   depth=5 anfragt wurde; das letztlich sichtbare Ergebnis entspricht exakt
   depth=5. Simulierbar ohne echten Worker, indem der Orchestrator gegen
   ein injizierbares "WorkerFactory"-Interface getestet wird.

**E2E (`tests/e2e/`, Playwright/Chromium, gegen `dist/`):**

6. **Main-Thread bleibt frei:** Tiefe auf einen empirisch langsamen Wert
   setzen (Benchmark vorab: welcher `depth`-Wert reproduzierbar > 300 ms
   Kompilierzeit braucht - vermutlich 20; erst validieren, nicht
   Bauchgefühl-vermuten). Während der Kompilierung per
   `page.evaluate(() => requestAnimationFrame(...))` einen rAF-Tick-Zähler
   laufen lassen; Assertion: keine Lücke zwischen zwei Ticks > 100 ms
   während des gesamten Kompiliervorgangs.
7. **UI bleibt bedienbar während der Kompilierung:** während o.g. langsamer
   Kompilierung auf Play/Pause klicken -> `playbackStore.isPlaying`
   schaltet sofort um (nicht blockiert bis Compile fertig ist); Zeitslider
   lässt sich bewegen.
8. **Alte Darstellung bleibt sichtbar bis zum fertigen Ergebnis:** Canvas
   zeigt während der Kompilierung weiterhin den VORHERIGEN kompilierten
   Zustand (kein Blank/Grau/Platzhalter) - Screenshot-Vergleich oder
   Prüfung, dass kein Lade-Overlay das Canvas verdeckt.
9. **Cancellation sichtbar im Endergebnis:** depth=20 setzen, sofort (vor
   Fertigstellung) depth=6 setzen -> `compiledStore`/Zahlentafel zeigt am
   Ende zuverlässig den Zustand für depth=6, nie kurz depth=20 aufblitzend
   gefolgt von depth=6 (würde auf eine Race hindeuten, bei der der
   terminierte Worker doch noch etwas schreibt).
10. **Progress-Schwelle:** depth=3 (schnell) -> Progress-Indikator wird zu
    keinem Zeitpunkt sichtbar. depth=20 (langsam) -> Progress-Indikator
    wird sichtbar (innerhalb Schwelle + Toleranz) UND verschwindet wieder,
    sobald das Ergebnis da ist (kein "hängen bleiben").
11. **Kein Worker-Leck:** `depth` fünfmal schnell hintereinander ändern ->
    zu keinem Zeitpunkt sind mehr als 1 aktive Worker-Instanzen vorhanden
    (Zähl-Hook nur im Test-/Dev-Build, z.B. via `window.__activeWorkers`).
12. **Config/URL-Export wartet nicht auf Compile:** `depth` ändern,
    SOFORT (ohne zu warten) "Als URL kopieren" klicken -> die kopierte URL
    enthält bereits den NEUEN `depth`-Wert (beweist: `configStore`/
    `buildStateParams()` sind synchron, nur `compiledStore` hinkt hinterher).

## Bekannte Stolperfalle: "Function object could not be cloned"

Diese Meldung taucht NICHT durch einen Logikfehler im Code auf, sondern
wenn E2E gegen einen **stale `dist/`-Build** läuft (der Preview-Server
serviert einen alten Build, während `compiler.js`/der Worker sich geändert
haben). Dann passen die Hashes der Worker-Chunks (`compile.worker-*.js`)
nicht mehr zum Rest des Builds, und der strukturierte Klon/Transfer
scheitert. **Immer vor `pnpm test:e2e` neu bauen** (`pnpm build`) und
laufende Preview-Server stoppen (`scripts/serve.sh stop`), sonst wird ein
völlig harmloser alter Build als "Worker-Fehler" angezeigt. Im frischen
Build ist `compileSystemData()` sauber clonbar (Unit-Test 3 belegt: kein
Funktionswert im Baum, `structuredClone` wirft nicht).

## Reihenfolge / Abgrenzung zu Phase 1

Dieser Plan ist unabhängig vom Tab-/Label-Umbau (Phase 1 in
`INTERFACE-TODO.md`) und kann parallel oder danach umgesetzt werden - beide
Teile ändern unterschiedliche Dateien (`ControlPanel.svelte`-Markup vs.
`compiler.js`/`stores.js`/neuer Worker). Empfehlung: Phase 1 zuerst
(schnell, geringes Risiko), dieser Plan danach als eigener Task/eigene
Session (anderes Werkzeug-Set: Playwright-E2E nötig, siehe Testkriterien
6-11).
