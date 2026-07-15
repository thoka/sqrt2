# AGENTS.md - Kurzübersicht für Agents

Kondensat aus `CLAUDE.md` (detaillierte Agentenregeln) + praktische Gotchas
aus der Svelte-Migration. Bei Unsicherheit `CLAUDE.md` und `TOOLING_SPEC.md`
voll lesen - hier nur das Nötigste zum schnellen Einstieg.

## Architektur (Stand: Phasen 0-4 erledigt)

- `sqrt2.html` ist nur noch eine **dünne Shell**: mountet Svelte-Komponenten,
  hält das `SETTINGS`-Array (URL-Sync), die Zahlentafel (`updateHUD`) und die
  Playback-Brücke für die Zahlentafel. **Kein Canvas-Rendering mehr hier.**
- Canvas + rAF-Loop + Auto-Zoom/Kompaktierung: `src/components/TargetBankCanvas.svelte`
  (Port von `renderFrame()`). Rest-Widgets (austauschbar): `RestCounterBars.svelte`
  / `RestCounterGrid.svelte`. UI: `ControlPanel.svelte` / `PlaybackBar.svelte`.
- Stores in `src/lib/stores.js`: `configStore`/`playbackStore` (writable),
  `compiledStore` (derived, ruft `compileSystem` aus `src/lib/compiler.js`),
  `displayStore` (Lokaler UI-State - **bewusst NICHT** über BroadcastChannel
  synchronisiert; nur config/playback sind der geteilte Zustand, siehe
  `TOOLING_SPEC.md` §3.1).
- URL-Sync: `src/lib/urlState.js`. Gemeinsame Logik: `bank-core.js`,
  `smoothing.js` (von beiden HTML-Tools per ES-Modul importiert).

## Build / Test / Run

```bash
npm install
npm run dev      # Vite-Dev-Server, URL im Browser öffnen (live-reload)
npm run build    # -> dist/sqrt2.html (+ assets), direkt im Browser öffnen
npm test         # node --test *.test.js  (reine Logik)
                  #   +  vitest run       (Svelte-Komponenten, jsdom)
```

- **Keine visuelle Verifikation in dieser Sandbox möglich:** headless chromium
  hängt an DBus/Netzwerk. Korrektheit hier NUR über `npm run build` + `npm test`
  absichern. Playwright/Browser-Mode NICHT aufsetzen (siehe `CLAUDE.md`
  "Svelte-Komponenten-Tests": offizielle Svelte-5-Empfehlung ist vitest + jsdom
  mit `mount()`/`unmount()`/`flushSync()`, KEINE testing-library).
- **Smoke-Test ohne Browser:** Dev-Server (`nohup npm run dev -- --port 5173
  --strictPort &`) starten und per `curl -s -o /dev/null -w "%{http_code}"
  http://localhost:5173/sqrt2.html` (bzw. `/bank-core.js`,
  `/selection_strategy_prototype.html`) zumindest HTTP-200 + fehlerfreies
  Bundling prüfen - ersetzt keine visuelle Prüfung, fängt aber Import-/
  Build-Fehler früh.
- Branches: aktive Arbeit auf `migrate-to-svelte`.

## GOTCHAS (spart einem nächsten Agenten Zeit)

1. **Toter Code in `sqrt2.html`:** der ursprüngliche SYSTEM-C-Renderblock
   (`renderFrame()`, `resizeCanvas()`, `applyPlayback()`, `loop()`) ist seit
   Phase 4a noch als **uncalled/toter Code** vorhanden (sicher, weil nie
   aufgerufen). Beim Editieren von `sqrt2.html` NICHT re-aktivieren; beim
   Aufräumen einfach entfernen. Der lebendige Render-Pfad ist
   `TargetBankCanvas.svelte`.
2. **`compiledStore` hat KEIN `depth`-Feld.** Für Array-Längen `configStore.depth`
   (Alias N_MAX) nutzen - ein früherer Bug (RestCounterBars) kam daher.
3. **derived-Store-Caching-Pitfall:** `compiledStore` (derived) cached seinen
   Wert NUR bei mindestens einem aktiven Subscriber. Ein `get(compiledStore)`
   OHNE offenes `.subscribe()` löst JEDES MAL neu kompilieren aus. In
   Svelte-Komponenten daher **`$compiledStore` (Auto-Subscription)** nutzen,
   NICHT wiederholtes `get()` in einer Render-Schleife (sonst kompiliert jeder
   Frame neu).
4. **`displayStore` ist lokal, nicht synchronisiert** - bei neuen geteilten
   Zuständen `configStore`/`playbackStore` verwenden, nicht `displayStore`.
5. **Tooling-Version:** `vite@7` (nicht `latest@8` mit Rolldown-Wechsel)
   behalten - Minimal sicheren Versionssprung wählen, Architekturwechsel
   vermeiden (siehe `CLAUDE.md` "Tooling-Updates").
6. **`SETTINGS`-Array:** neue einstellbare Größe = EIN neuer Eintrag
   `{ key, phase, get(), set(v) }` in `sqrt2.html`; nie wieder vier parallele
   Listen pflegen (`bindEl()` für input/select/checkbox, `phase:'pre'` vor
   bzw. `phase:'post'` nach `compileSystem()`).

## Hart erkämpfte Regeln (Details in CLAUDE.md, hier nur die Faustregel)

- **Stetige Ableitung (C¹)** für ALLE automatisierten Bewegungen →
  `smoothing.js` nutzen, nicht Ad-hoc-Kernel neu erfinden.
  - Wert an jedem Stützpunkt exakt/ohne Verzögerung (Sicherheitsgarantie) →
    `buildMonotoneSpline()`.
  - MEHRERE abhängige Werte mit Ordnungs-Invariante (keine Überlappung) →
    `computeSegmentBlend()` (+ Pinning-Wegpunkt bei Zeit-Verzögerungs-Garantie).
  - Nur träge/asymptotisch folgen (Kamera/Zoom) → `buildDampedFilter()`.
- **Layout-Umordnung mehrerer Objekte:** masse-/trägheitsgewichtet (größte
  Gruppe = Anker, bleibt fix), KEIN Förderband/Prefix-Sum.

## Migrations-Spezifikation

`TOOLING_SPEC.md` ist das lebendige Doc (Phasen 0-5, Stand je Step). Nach
JEDEM erledigten Schritt dort den Status + "Nächster Schritt" aktualisieren.
Phase 5 (BroadcastChannel-Sync-Adapter + zweiter Vite-Entry `RemoteControl`)
ist der nächste Schritt.
