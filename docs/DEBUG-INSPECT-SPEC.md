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

## 2. Root-Cause der Drift (lokalisiert, Fix OFFEN)

### Was synchron ist

Bei `time=1.0, tick=1` (Anker "Teil 1 entnommen"): Zahlentafel `l=0,R=1`,
`restByK={0:1}`, Bank zeichnet `{0:1}` — **synchron**. Auch im laufenden
Zustand: `time == uTimeBank` exakt (`driftT=0.000`), FPS hoch.

### Was auseinanderläuft

`debug-mode-test` zeigt: Bank (`bankSig`) und Rest-Anzeige (`restSig`)
wechseln ihre Modi an **unterschiedlichen Zeitpunkten** und in
**unterschiedliche Modi** (bei `t=6`: Bank `{1:5,2:8}` vs Rest `{1:3,2:2}`).
Bei fortgeschrittener Zeit zeigt die Zahlentafel bereits `l≈1.414`
(weit fortgeschritten), während die Rest-Stücke noch eine frühe Verteilung
zeigen.

### Spuren (unbestätigt, richtungsweisend)

1. **Schalen- vs Tick-Basis (User-Hypothese):** `computeLiveL`
   (compiler.js:677) bestimmt `Step` über `GLOBAL_SHELL_START[S]` — den
   **Schalen-Anchor** (Render-Loop-Schalenwechsel). Die Rest-Stücke nutzen
   aber die **tick-genauen** `born/cut/taken_time`. `shellGaps` zeigt:
   `GLOBAL_SHELL_START[S]` liegt **vor** dem ersten `born_time` der Schale
   (Lücke wächst mit S: S=1→-0.1, S=3→+4.45, S=7→+11.45, S=9→+13.85).
   → Zahlentafel springt zu früh auf die neue Schale.
2. **`CUT_BORN_LEAD` (compiler.js:358):** `born_time`/`cut_time` werden um
   `0.1` nach *vorn* gezogen (`- CUT_BORN_LEAD`), `taken_time` **nicht**.
   Das macht die Sichtbarkeits-Spanne `[born,taken)` asymmetrisch länger.
3. **`leafEffectiveSize` (recursive-layout.js):** zeichnete Blätter bis
   `te` (Hold+Ease). User-Regel: sichtbarer Rest endet hart bei `taken_time`
   (born..taken = Hold/sichtbar; taken..taken+delay = Hold/nicht-sichtbar;
   taken+delay..te = Ease). Erster Fix-Versuch (Größe 0 ab `taken_time`)
   brachte **keine** Besserung → die Diskrepanz sitzt nicht (nur) in
   `layoutBox`, sondern in der Compiler-Zeitgebung (siehe 1+2).
4. **`tickTimePairs`** (compiler.js:196/214/220) mappen Einzel-Stücke
   `tick→t_fly`, Zerschneiden-Gruppen `tick→t_cut` — inkonsistent.

### Invariante des Users (Massstab für den Fix)

- `tick=T` = Zeitpunkt, wo das Stück mit diesem Tick **wegfliegt/verschwindet**.
- Tauschen/Zerschneiden muss **vorher** passiert sein.
- **Bank-Zähler und Rest-Anzeige müssen immer synchron sein** (dieselbe
  Zeitbasis). Das rekursive Layout (Bank) muss sich dem **bewährten alten
  Rest-Modell** anpassen, nicht umgekehrt.

### Nächster Schritt (Fix, noch nicht geschehen)

1. `debug-mode-test.mjs` mit reduzierter Schrittzahl (200 / upper=60) laufen
   lassen → exakte Modus-Wechsel-Zeitpunkte Bank vs Rest.
2. Prüfen, ob `computeLiveL` wirklich über `GLOBAL_SHELL_START` (Schalen)
   statt tick-genauer Stückzeiten läuft.
3. Compiler so korrigieren, dass Rest-Anzeige + Zahlentafel **dieselbe
   tick-korrekte Zeitbasis** wie die Bank nutzen: `CUT_BORN_LEAD` entfernen
   bzw. konsistent auf alle drei Zeiten anwenden; `tickTimePairs` konsistent
   mappen; `GLOBAL_SHELL_START[S]` ggf. auf die Zeit des ersten Stücks der
   Schale setzen (statt Render-Loop-Schalenwechsel).
4. Danach `pnpm check` + `pnpm test` + `pnpm test:e2e`, dann committen.

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
