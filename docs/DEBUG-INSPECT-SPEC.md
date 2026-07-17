# Debug-Inspect-Kanal — Spec (Stand 2026-07-17)

## Ausgangslage & Problem

Wir haben ein **massives Zeit-Drift-Problem** zwischen der Bank (Canvas/
rAF-Loop in `TargetBankCanvas.svelte`) und dem Rest der Visualisierung
(Zahlentafel, Rest-Widgets, Playback-Bar). Symptom: die Rest-Animation
zeigt eine **frühere** Zeit als die Zahlentafel (`1.3` bei dir, aber Rest
noch bei den Stücken einer früheren Entwicklungsstufe).

Um das zu debuggen, braucht Claude **exakt denselben inneren
Applikationszustand** wie der User — nicht den gerenderten Screen
(Screenshots driften, sind teuer, verbergen den echten Store-Stand).

## Topologie (PRIMÄR: User-Chrome via CDP, Claude im WSL2-Container)

- User arbeitet auf **Win11**, Chrome gestartet mit:
  ```
  "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\chrome-debug"
  ```
- Claude/opencode läuft im **WSL2-Arch-Container**. Dieser sieht den
  Win11-Chrome bereits unter `localhost:9222` (kein netsh-Portproxy nötig —
  verifiziert: `curl http://localhost:9222/json/version` antwortet aus dem
  Container). Sollte das einmal nicht klappen (andere WSL-Topologie):
  Win11 `netsh interface portproxy add v4tov4 listenaddress=0.0.0.0
  listenport=9222 connectaddress=127.0.0.1 connectport=9222` + Firewall.
- Playwright `connectOverCDP('http://localhost:9222')` aus `@playwright/test`
  attached an den **laufenden** User-Chrome (live verifiziert). Der Peer
  liest den inneren Stand direkt per `page.evaluate(window.__debugSnapshot())`
  und kann `page.screenshot()` machen. Kein eigener Browser-Prozess, keine
  GPU/Lib-Abhängigkeit im Container.
- Vite-Dev läuft auf **Port 5173** (HMR-aktiv). Ein alter Port 5300 war ein
  veralteter Server (vor Änderungen gestartet) → immer 5173 nutzen.
- CDP-Timeout tritt auf, wenn Chrome das Debug-Profil neu lädt → Script
  einfach erneut starten.

## Nicht-Ziel

- Kein allgemeiner Steuerungs-Kanal (das ist Remote-Control über
  `configStore`/`playbackStore`).
- Keine Änderung am Produktions-Sync. Der Debug-Kanal ist **opt-in,
  standardmäßig aus** (`?debug=1`).
- Kein Ersatz für die `compiledStore`-Nicht-Übertragungs-Regel; der Debug-
  Snapshot ist ein *reiner Lese*-Export.

---

## 1. Implementierter Stand (was tatsächlich gebaut ist)

### Frontend: `src/lib/debugAgent.js` (opt-in `?debug=1`)

`initDebugAgent()` wird in `src/App.svelte` `onMount` aufgerufen (nur bei
`?debug=1`). Legt `window.__debugSnapshot()` offen — eine synchrone Funktion,
die den inneren Stand zurückgibt. Kein eigenes Transport-Protokoll; der CDP-
Peer liest sie per `page.evaluate`.

`window.__debugSnapshot()` liefert:
```js
{
  t,                              // performance.now()
  time: playbackStore.time,       // Zeit der Zahlentafel/Rest
  uTimeBank,                      // u_time der Bank-rAF-Loop (separat!)
  tick: playbackStore.tick,       // aus GLOBAL_TTM.timeToTick(time)
  playing,
  config, display,
  compiled: {                     // KLEINER lesbarer Ausschnitt
    l, l2, R,                     // Zahlentafel-Werte (BigInt als String)
    piecesCount, depth, maxTick,
    tick,                         // timeToTick(time)
    shellGaps: [{S, shellStart, firstBorn, gap}],  // Schalen-Anker vs. 1. born
    pieceSample,                  // Feldnamen eines bank_piece
  },
  restByK,                        // {k:count} REST-ANZEIGE (born<=t<cut && t<taken)
  restByKBank,                    // selbes gegen uTimeBank
  bankDrawnRest,                  // {k:count} was die BANK tatsächlich zeichnet
  bankDrawnDetail,                // [{k,born,cut,taken}] pro gezeichnetem Rect
  bankSig,                        // kanonische Signatur der Bank-Reste
  restSig,                        // kanonische Signatur der Rest-Anzeige
  hud, hudBank,                   // computeLiveL-Step (N_l, N_R) gegen time/uTimeBank
  piecesAtTime,                   // rohe bank_pieces bei aktuellem time (Debug)
  frame: { fps, frameNo, bankTransform, lastDt },
}
```

Hooks (aus `TargetBankCanvas.svelte`), die den Agent füttern:
- `setDebugFrame(dt)` in der rAF-Loop
- `setDebugBankTransform(z,x,y)` in `renderFrame` (teilDCamera)
- `setDebugBankTime(t)` in der Loop (`u_time`)
- `setDebugBankDrawnRest(map)` + `setDebugBankDrawnDetail(arr)` in `renderFrame`
  (zählt die tatsächlich gezeichneten `bank_out`-Rects nach `k`).

### Peer-Skripte (Claude-Terminal)

- `scripts/debug-cdp.mjs` — verbindet `connectOverCDP`, findet die
  `?debug=1`-Page, pollt `window.__debugSnapshot()` alle 200 ms →
  `./debug/state.json` + zeigt `frameNo/fps/time/uTimeBank/driftT` sowie
  `restByK` vs `restByKBank` bei Differenz. `--shot` → `./debug/shot.png`.
  Nutzung: `DEBUG_URL="http://localhost:5173/?debug=1" node scripts/debug-cdp.mjs`.
- `scripts/debug-mode-test.mjs` — scannt die Zeitachse **in einem einzigen
  `page.evaluate`** (kein Roundtrip pro Punkt!) und misst die Modus-Wechsel
  von `bankSig` vs `restSig`. Schreibt nach `/tmp/opencode/debug-mode-result.txt`.
  Achtung: Scan mit 600 Punkten dauert >120 s (compile/render pro Slice) →
  Schrittzahl reduzieren (z.B. 200, upper=60).
- `scripts/debug-selftest.mjs` — prüft Invarianten (Bank==Rest, HUD-Step
  nicht vor firstBorn). Zu langsam in der 600-Punkte-Variante → ebenfalls
  reduzieren.

`debug-agent`/`debug-cdp` sind **nicht** committet (Stand dieses Schreibens);
`./debug/` ist in `.gitignore` (Debug-Artefakte).

---

## 2. Root-Cause der Drift (GEFUNDEN + GEFIXT, Stand 2026-07-17)

**Die ursprüngliche Hypothese unten (Spuren 1/2/4) war falsch.** Es ist
**keine Zeit-Drift zwischen zwei Uhren** - `time === uTimeBank` galt schon
vorher exakt (`driftT=0.000`). Die tatsächliche Ursache: **zwei
verschiedene, nicht mehr identische Objektgraphen für dieselben logischen
Stücke.**

### Der eigentliche Bug: `compileSystemData()`s Flach-Kopie brach `children`

```js
let raw_bank_pieces = bank_pieces.map((p) => ({ ...p }));
```

`{...p}` ist nur eine FLACHE Kopie - `children` blieb dieselbe
Array-Referenz und zeigte weiter auf die ALTEN (Vor-Map-)Objekte, nicht auf
die neu erzeugten `raw_bank_pieces`-Elemente. `finalizeCompiled()` konvertiert
`taken_time`/`cut_time`/`born_time`/`te` von Tick- zu Zeit-Einheiten aber NUR
auf den TOP-LEVEL-Array-Elementen (`for (let p of bank_pieces) p.taken_time =
...`). Ergebnis:

- Jeder Konsument, der `piece.children` traversiert (`layoutBox()` in
  `recursive-layout.js`, also die **Bank-Visualisierung**), sah dauerhaft die
  ALTEN, nie konvertierten Roh-Tick-Werte.
- Jeder Konsument, der `bank_pieces` FLACH iteriert (`restByK` der
  **Rest-Widgets** rechts, `computeLiveL`s `N_R`-Summe), sah die korrekt
  konvertierten Zeit-Werte.

Live verifiziert per Debug-Kanal (CDP, echter Chrome, Play/Pause-Zyklus):
`bankSig`/`restSig` liefen an derselben `time` auseinander (z.B. Bank
`{1:6,2:9}` vs Rest `{1:5,2:7}`), obwohl `playback.time === uTimeBank` exakt.
`render_pipeline[].bp` (Herkunft: `e.piece`/`g.piece` aus den rohen
`events`) hatte dasselbe Problem.

**Fix** (`compiler.js`, `compileSystemData()`): nach der Flach-Kopie einen
`id -> neues Objekt`-Map bauen und `children` sowie `render_pipeline[].bp`
explizit auf die NEUEN Objekte umhängen, bevor irgendetwas postMessage/
structuredClone verlässt - EIN konsistenter Objektgraph, egal ob man ihn
flach (`bank_pieces`) oder über `children` erreicht.

### Drei zusätzliche Grenzfall-Bugs (gefunden über einen neuen Regressionstest)

Nutzer-Auftrag: "Teile fliegen exakt bei den gerenderten Reststücken los"
als Test verifizieren (`tests/unit/compiler.test.js`, prüft
`findRect(bank_root, bp.flightQueryTime, bp.id)` für JEDEN
`render_pipeline`-Eintrag gegen die tatsächliche Design-Größe). Deckte drei
weitere, vom Objektgraph-Bug UNABHÄNGIGE Grenzfälle auf:

1. **`taken_time`-Grenze war exklusiv** (`t < taken_time`), sollte aber
   inklusiv sein (`t <= taken_time`) - ein entnommenes Blatt ist bei GENAU
   `taken_time` noch in Design-Größe sichtbar (Kommentar an
   `flightQueryTime` sagt das explizit). Gefixt in `recursive-layout.js`
   (`leafEffectiveSize`) UND allen Rest-Zähler-Stellen
   (`RestCounterBars.svelte`, `RestCounterGrid.svelte`, `debugAgent.js` ×3,
   `compiler.js` ×2) - sonst würde ein exakter Tick-Sprung (z.B. per
   `ControlPanel.svelte`s `tickToTime()`) die Bank/Rest-Übereinstimmung
   genau an diesem einen Zeitpunkt brechen.
2. **`t_cut = global_time - 0.5` konnte retroaktiv vor den bereits
   vergebenen Zeitpunkt des VORHERIGEN Events zurückfallen**, wenn dieses
   zuvor nur um `0.15` (kein Schalenwechsel) statt einem vollen `SHELL_GAP`
   erhöht hatte - brach die von `buildTickTimeMapping()` geforderte
   Monotonie. Fix: `global_time` VOR der Subtraktion um denselben Betrag
   vorziehen (`compiler.js`, Zerschneiden-Gruppen-Zweig).
3. **`te`-Pruning war exklusiv** (`t >= te`), obwohl `te >= taken_time`
   immer gilt - fielen beide durch eine Tick-Zeit-Plateau exakt zusammen
   (`te === taken_time`), prunte der äußere Bulk-Check das Blatt, BEVOR
   `leafEffectiveSize()` seine eigene (jetzt inklusive) Grenze auswerten
   konnte. Fix: `t > te` statt `t >= te` in `layoutBox()`.

### Offener Rest (NICHT gefixt, siehe Abschnitt 5)

`findRect()` findet ein Stück mit `cut_time === born_time` (im selben
Tick geboren UND sofort weitergeschnitten, nur im `Z`-Modus/Zerschneiden-
Gruppen) nie als sich selbst - siehe Abschnitt 5.

---

## 3. Nicht implementiert (nur geplant, ggf. wegfallen)

- **WS-Sekundärpfad** (`scripts/debug-ws-server.mjs`, `DEBUG_WS=1` im Agenten,
  `window.__debugSnapshot` → `ws://localhost:8787`): war in der ersten
  Spec-Skizze als Option, aber durch den CDP-Pfad obsolet. Nicht gebaut.
- **Unit-Tests** `tests/unit/debugAgent.test.js` / E2E `debug-inspect.test.js`:
  noch nicht angelegt (der CDP-Peer ersetzt sie weitgehend für die
  Drift-Diagnose).

---

## 4. Sicherheit / Nebenwirkungen

- Standardmäßig **aus** (`?debug=1`). Kein Snapshot im Produktions-Build ohne
  explizite Aktivierung.
- `connectOverCDP` nutzt den *laufenden* User-Chrome, lauscht nur auf
  `localhost:9222` — kein Netzwerk-Zugriff von außen.
- Kein Schreibzugriff des Peers auf Host-Stores (nur `page.evaluate` lesend).
- Mischt sich nicht in `config`/`playback`-Sync.

---

## 5. Offener Rest: `findRect()` findet instantan gespaltene Stücke nicht

**Nicht gefixt** (Stand 2026-07-17) - eigener, von Abschnitt 2 unabhängiger
Bug, gefunden über den neuen Test
`tests/unit/compiler.test.js`: "Teile fliegen exakt bei den gerenderten
Reststücken los".

### Symptom

Für ein Stück mit Kindern (`children.length > 0`) ist `flightQueryTime =
born_time` - die Annahme: das Stück ist ab `born_time` für ein positives
Zeitfenster "als Ganzes" sichtbar, bevor es (später) geschnitten wird
(`cut_time > born_time`). Bricht diese Annahme (`cut_time === born_time`
exakt - das Stück wird im selben Tick geboren UND sofort weitergeschnitten),
findet `findRect(bank_root, flightQueryTime, id)` das Stück NIE als sich
selbst: bei `t = born_time = cut_time` ist `isActive = children.length>0 &&
t>=cut_time` bereits `true` - `layoutBox()` deszendiert direkt in die
Kinder, das Stück selbst landet nie in `out`.

Betrifft nur `transformMode: 'Z'` (Zerschneiden-Gruppen) - `S`-Modus ist bei
allen getesteten Tiefen (3/6/8/16) bugfrei. Messung (`compileSystem()` +
`findRect()` für jeden `render_pipeline`-Eintrag):

| depth | mode Z: fails/total |
|---|---|
| 3 | 2/594 |
| 6 | 10/1575 |
| 8 | 64/4589 |
| 16 | 302/20075 (~1.5%) |

Alle Fehlschläge derselbe Ursache/Stück-Form (`cut_time === born_time`).

### Sichtbare Konsequenz (nicht verifiziert, aber naheliegend)

`bankOriginState()` (TargetBankCanvas.svelte) cached `flightOrigin = false`
bei einem Fehlschlag, `project()` liefert dann `[0,0,0,0]` für den
Startpunkt - ein betroffenes `Z_source`-Flug-Ereignis würde ausgehend vom
Ursprung (0,0) statt von seiner tatsächlichen Bank-Position starten
(sichtbarer Sprung/"Herausschießen aus der Ecke").

### Warum noch nicht gefixt

Kein einfacher Grenzfall-Fix wie die drei in Abschnitt 2 (Off-by-eine-
Instanz) - hier gibt es architektonisch KEIN gültiges `t`, an dem das Stück
je "als Ganzes" sichtbar war (das Zeitfenster ist leer, nicht nur ein
einzelner Randpunkt). Mögliche Ansätze (keiner umgesetzt/geprüft):

1. `flightQueryTime` für diesen Fall auf den `born_time` des EIGENEN
   Vorfahren zurückfallen lassen (rekursiv, bis ein Vorfahre mit
   `cut_time > born_time` gefunden ist).
2. `findRect()`/`bankOriginState()` bei Fehlschlag automatisch beim
   Elternstück nachfragen, statt (0,0) zurückzugeben.
3. Root-Cause in `bank-core.js` klären: WARUM entsteht ein Stück mit
   `cut_time === born_time` überhaupt (sofortiges Weiterschneiden im selben
   Tick) - ggf. dort vermeidbar statt nachträglich zu kompensieren.

### Nächster Schritt

Eine der drei Optionen oben wählen (Rücksprache mit User empfohlen, da
Option 3 ggf. das Simulationsverhalten selbst ändert), dann
`tests/unit/compiler.test.js`s "Teile fliegen exakt..."-Test muss für ALLE
`transformMode`/`depth`-Kombinationen grün werden (aktuell: `Z`-Modus bei
jeder getesteten Tiefe noch rot, `S`-Modus bereits grün).
