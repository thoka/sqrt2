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

## Intro-Screen (2026-07-20)
- `App.svelte`: `showIntro`-State, `.intro-overlay` (zentrierte Willkommens-Box
  "√2 als Fläche" + kurzer Text) plus `.intro-settings-hint` fix oben rechts
  ("Einstellungen ↗") - positioniert genau über der bestehenden Maus-Hover-
  Zone, die die Einstellungen öffnet (`TOP_RIGHT_ZONE_PX`, siehe TODO.md
  "Einstellungen aufräumen").
- Blendet sich nach `INTRO_DURATION_MS` (6 s) von selbst aus, ODER sofort
  sobald `playbackStore.isPlaying` wahr wird (EIN Subscribe deckt Space,
  Play-Button UND Remote-Steuerung gleichzeitig ab, da alle über denselben
  Store laufen).
- Bewusst `pointer-events: none` auf dem gesamten Overlay (anders als das
  bestehende `.help-overlay` bei "?"): der Intro-Screen ist rein informativ
  und darf im Exponat-Kontext NIE Klicks auf Play/Timeline blockieren, auch
  nicht kurz vor dem automatischen Ausblenden.
- E2E-Test `tests/e2e/sqrt2.e2e.test.js` ("Intro-Screen: sichtbar beim Start,
  verschwindet bei Play") - Sichtbarkeit + Play-Trigger, da DOM-/Mount-Pfad
  laut AGENTS.md nicht nur per Unit-Test verifiziert werden darf.

## Dokumentation + Fernsteuerung/Connection-Nachpflege (2026-07-20)
- `selection_strategy_prototype.html`: TODO als erledigt markiert (Datei war
  bereits in einer früheren Aufräum-Runde entfernt, Commit "Legacy-Prototypen
  ... entfernt" - nur die Checkliste war nicht nachgezogen).
- `docs/DEPLOYMENT.md`: Kopf verlinkt jetzt explizit `TOOLING_SPEC.md` (§8,
  GitHub-Pages-Demo ohne Relay) zusätzlich zu README/CONNECTION_SERVICE_SPEC;
  §7 Test-Pfade korrigiert (`test-api.mjs` etc. lagen tatsächlich unter
  `tests/relay/`, nicht Repo-Root wie zuvor dokumentiert) + Rate-Limit-Hinweis
  verlinkt; §2 um die Docker-Compose-Alternative (`deploy/.env.example`)
  ergänzt.
- `docs/TOOLING_SPEC.md`: §8-Kopf grenzt jetzt explizit gegen
  `docs/DEPLOYMENT.md` ab (GitHub-Pages-Demo vs. Exponat-Betrieb - zwei
  verschiedene "Deployment"-Bedeutungen im selben Repo, leicht verwechselbar).
  "Nächster Schritt" auf heutigen Stand aktualisiert (Beschriftung/
  Flug-Animation-Schwellwert/Intro-Screen).
- `docs/CONNECTION_SERVICE_SPEC.md`: §10 verlinkt jetzt `docs/DEPLOYMENT.md`
  als konkrete Betriebsanleitung; §12 Punkt 6 (Tailscale-Test) als erledigt
  markiert + verlinkt (war bereits umgesetzt, nur nicht als "erledigt"
  gekennzeichnet); doppelte Nummerierung "7./7." korrigiert.
- `README.md` §10: "Admin-konfigurierbare Steuerungs-Komplexität" verweist
  jetzt explizit auf `TOOLING_SPEC.md` Phase 6 (war inhaltlich schon korrekt
  als "offen" markiert, nur ohne Phasen-Referenz).
- **Exponat-Key-Management** (TODO.md "Fernsteuerung/Connection"): neue
  `deploy/.env.example` (API_KEYS/ADMIN_KEY/ACME_EMAIL/ADMIN_BASIC_AUTH) -
  `deploy/docker-compose.yml` liest diese Werte jetzt per
  `${API_KEYS:-}`/`${ADMIN_KEY:-}`-Interpolation aus `deploy/.env` (via
  `--env-file`) statt sie hartkodiert/auskommentiert in der committeten
  Compose-Datei vorzuhalten. `.gitignore` blockt `.env`/`deploy/.env` neu
  (vorher nicht erfasst - Lücke, `.ports.local.env` war das einzige
  `*.env`-Muster und explizit KEIN Secret).
- **Tailscale/TLS-Setup**: bereits vollständig vorhanden
  (`scripts/setup-tailscale.sh` config/check/reachable/https-Unterbefehle +
  DEPLOYMENT.md §5) - der im TODO genannte Pfad
  `infra/connection-service/setup-tailscale.sh` existierte nie so (kein
  `infra/`-Verzeichnis im Repo); nur die Checkliste + CONNECTION_SERVICE_SPEC
  §12 waren nicht als erledigt markiert.
- **Relay-Status im Exponat**: bereits vorhanden - `ControlPanel.svelte`
  (Tab "Remote-Connect", auch im Haupt-Exponat gemountet, nicht nur in
  `RemoteControl.svelte`) zeigt `connStatus` + `guestCount` live an, sobald
  eine Host-Sitzung läuft. Die TODO-Prämisse "aktuell nur in RemoteControl"
  bezog sich auf `#relayStatus` in `RemoteControl.svelte`, das aber etwas
  ANDERES anzeigt (Gast-eigener WS-Status, nicht die Gast-Zahl des Hosts).
- Weiterhin offen (echte Feature-Arbeit, nicht nur Dokumentation):
  **`RemoteControl` als foldbare Route** im Exponat (TODO.md "Fernsteuerung /
  Connection (Nachpflege)").

## MathJax-Metriken: Brüche/Exponenten ohne MathJax (2026-07-20)
- Nutzer-Anfrage: Brüche (untere/linke Achsen-Beschriftung, siehe oben) und
  Zahlendarstellungen allgemein sollen optisch wie MathJax aussehen, OHNE
  MathJax zur Laufzeit zu laden (MathJax war 2026-07-18 wegen Flug-Stotterns
  entfernt worden, Commit `b3adf99`).
- Neues Analyse-Tool `scripts/mathjax-metrics.mjs` (Node + Playwright, mit
  Nutzer-Freigabe: laedt MathJax 3 von der oeffentlichen CDN in eine
  Sandbox-Headless-Seite, EINMALIG/offline, kein Teil des Laufzeit-Bundles):
  rendert `\frac{1}{8}`, `\left(\frac{1}{2}\right)^{3}`, `x^{3}`,
  `1.4142_{10}` (identisch zur frueheren HUD-Formel) bei fixer grosser
  Schriftgroesse, liest den CHTML-DOM-Baum aus (Tag/Klasse/BoundingRect/
  font-size relativ zum Container) und leitet daraus 5 Verhaeltniszahlen ab
  (SCRIPT_SCALE 0.707, RULE_THICKNESS/RULE_GAP je 0.06, SUP_SHIFT 0.358,
  SUB_SHIFT 0.128 - alle relativ zur Grundschriftgroesse).
- Zwei reale Mess-Fallen dabei gefunden + im Skript dokumentiert: (1) ein
  naiver "erstes Kind rekursiv"-Abstieg griff MathJax' unsichtbaren
  Grundlinien-Strut statt der echten Ziffer-Glyphe (verwaesserte
  SCRIPT_SCALE von 0.707 auf 0.85 - Fix: gezielt nach Tag `mjx-c` suchen);
  (2) `getComputedStyle().fontSize` einer Zaehler-/Nenner-Box bleibt bei
  MathJax oft auf der VOLLEN Groesse (Skalierung laeuft ueber CSS-Transform,
  nicht font-size) - erst das innere Glyph-Element traegt die tatsaechlich
  reduzierte Schriftgroesse.
- `src/lib/mathMetrics.js`: die 5 abgeleiteten Konstanten, dokumentiert +
  mit Regenerier-Anleitung. `src/lib/mathCanvasRenderer.js`: reine Geometrie
  (`layoutFraction()`/`layoutFractionPower()`, testbar mit injiziertem
  Fake-Measurer) + duenne Canvas-Zeichenschicht (`drawFraction()`/
  `drawFractionPower()`, nutzt `ctx.measureText().actualBoundingBox*` als
  echten Measurer, `opts.dryRun` fuer den "passt die Breite?"-Test ohne zu
  zeichnen). 8 Unit-Tests (`tests/unit/mathCanvasRenderer.test.js`).
- `TargetBankCanvas.svelte drawTargetLabels()`: zeichnet jetzt ECHTE
  gestrichene Brueche statt Klartext "1/2" - unten geklammerter Bruch mit
  Exponent (`(1/2)³`), links reiner Bruch (`1/8`). `numberRenderer.js`:
  `formatAxisFormulaLabel`/`formatAxisValueLabel` (Klartext-Varianten aus
  der vorigen Beschriftungs-Runde) durch `formatAxisDenominator()` ersetzt
  (liefert nur noch den Nenner-String, Zaehler ist immer "1" - der Bruch
  selbst wird jetzt GEZEICHNET statt als String formatiert).
- Nebenbei vereinheitlicht: die Basis-Subscript-Darstellung in der
  Zahlentafel (`renderHud()`, "1.4142₁₀") nutzte bisher geschaetzte Werte
  (Skalierung 0.7, Absenkung `fontSize - subFont` = 0.3·fontSize) - jetzt
  `MATH_METRICS.SCRIPT_SCALE`/`SUB_SHIFT` (0.128·fontSize, naeher an
  MathJax' tatsaechlicher Index-Position).
- Visuell verifiziert: Playwright-Screenshots der App (Basis 2 + 10,
  `?labels=1`) zeigen echte Zaehler/Bruchstrich/Nenner-Stapel + Klammern/
  Exponent; zusaetzlich per `--screenshot`-Flag PNG-Referenzbilder der
  ECHTEN MathJax-Ausgabe erzeugt und direkt verglichen (gleiche Struktur,
  andere Schriftart - siehe `docs/MATHJAX_METRICS.md` §6/§7 fuer bewusste
  Vereinfachungen).
- Methodik + Rohmesswerte + Konstanten + Grenzen vollstaendig in
  `docs/MATHJAX_METRICS.md` dokumentiert (neu, in README-Dateiuebersicht
  verlinkt).

## Beschriftung: echtes, gecachtes MathJax statt Hand-Nachbau (2026-07-20)
- Nutzer-Feedback (`docs/Beschriftung.md`, siehe Checkliste dort): der
  Hand-Nachbau (obiger Eintrag) sah trotz vermessener Konstanten sichtbar
  falsch aus (Klammern zu fett, Bruch nicht zentriert, Farbe/Optik
  inkonsistent zum Einheitsquadrat, gerade statt schräger Bruch links,
  ungebremstes Ein-/Ausblenden). Nach Diskussion: Achsen-Beschriftung
  komplett auf ECHTES MathJax umgestellt (die Menge moeglicher Ausdruecke
  ist klein/endlich, bounded durch Basis/Tiefe - ideal fuer Caching). Die
  Zahlentafel (HUD) bleibt beim eigenen Renderer (Wert aendert sich jeden
  Frame, ein Cache hilft dort nicht - explizite Nutzer-Vorgabe).
- **Font-Untersuchung** (`docs/Beschriftung.md` Punkt 2): MathJax' CHTML-
  Fonts sind einzeln adressierbare WOFF-Dateien (`MathJax_Main-Regular.woff`
  fuer Ziffern/Klammern/Schraegstrich/lateinische Buchstaben, Apache-2.0,
  ~34 KB) - lokal gebuendelt unter `src/assets/fonts/` (+ NOTICE.md +
  LICENSE-Apache-2.0.txt), eingebunden per `FontFace`-API in
  `src/lib/mathFont.js`. Wird weiterhin fuer den HUD-Renderer genutzt
  (`MATH_FONT_STACK`, `ensureMathFont()`).
- **Neue Laufzeit-Abhaengigkeit `@mathjax/src`** (v4, Apache-2.0, Nachfolger
  des deprecated `mathjax-full`) - mit Nutzer-Freigabe installiert. NUR
  dynamisch importiert (`src/lib/mathJaxRenderer.js`, `await
  import('./mathJaxRenderer.js')` in `mathJaxLabelCache.js`): der schwere
  TeX-Parser+SVG-Renderer-Teil (~1,3 MB minifiziert/~470 KB gzip) bildet
  dadurch einen EIGENEN Chunk, der nur bei einem echten Cache-Miss geladen
  wird - das Haupt-Bundle blieb bei ~26 KB (vorher versehentlich auf
  1,35 MB aufgeblaeht, als der Import noch statisch war - Regression sofort
  gefunden + gefixt).
- **Zwei Cache-Ebenen** (`src/lib/mathJaxLabelCache.js`):
  1. In-Memory (`Map`) fuer sofortigen synchronen Zugriff im Render-Loop.
  2. IndexedDB (`src/lib/mathJaxImageCache.js`) fuer Persistenz ueber
     Seiten-Reloads hinweg ("beim zweiten Aufruf der Seite ist alles im
     Cache", Nutzer-Vorgabe) - speichert den rohen SVG-String pro
     TeX-Ausdruck (Schluessel = TeX-Quelle selbst).
  `src/lib/mathJaxSvgImage.js` (SVG-String -> `HTMLImageElement`, liest
  `width`/`height` in MathJax' "ex"-Einheit aus) ist bewusst OHNE
  MathJax-Abhaengigkeit ausgelagert, damit es immer statisch importierbar
  bleibt (nur `mathJaxRenderer.js` selbst zieht `@mathjax/src` nach).
- **Kein Fallback-Renderer**: `TargetBankCanvas.svelte` (`mathLabelBox()`)
  zeichnet ein Label nur, wenn `getLabelImage()` synchron etwas liefert;
  sonst stoesst `requestLabelImage(key, tex, onReady)` das Rendern/Laden an
  und der aktuelle Frame laesst das Label einfach weg - `onReady` ruft
  `renderFrame()` erneut auf, sobald das Bild bereit ist (wichtig bei
  pausierter Animation, sonst bliebe das Label bis zum naechsten "echten"
  Trigger unsichtbar).
- **Alle uebrigen Beschriftung.md-Punkte im selben Zug erledigt:**
  - Farbe schwarz (kein Rahmen/Umriss mehr).
  - Nur bereits gerenderte Schalen beschriftet: `u_time >=
    GLOBAL_SHELL_START[i]`-Check pro Achsen-Index VOR dem Zeichnen.
  - Kein Unterschied Einheitsquadrat/Schalen: exp=0 ("1") laeuft jetzt durch
    DENSELBEN MathJax-Pfad wie jede andere Schale (kein separater
    Text-Code-Pfad mehr) - TeX-Quelle ist einfach `"1"`.
  - Linke Beschriftung als schraeger (einzeiliger) Bruch: TeX `{}^{a}/_{b}`
    (OHNE `\!` - erzeugte einen Rendering-Defekt, empirisch mit einer
    kleinen Testreihe geprueft, siehe Gespraechsverlauf).
  - Untere Beschriftung: Klammern jetzt MathJax-authentisch duenn (kein
    Hand-Tuning mehr noetig), Bruch durch echtes `\left(\frac{1}{b}
    \right)^{n}` automatisch korrekt zentriert/proportioniert.
  - Weiches Ein-/Ausblenden: `labelsAlphaFilter` (`buildDampedFilter()` aus
    `smoothing.js`, TAU=0.09, wie CLAUDE.md "stetige Ableitung" vorgibt) auf
    Basis von ECHTER Wanduhrzeit (`performance.now()`, nicht Simulationszeit
    `u_time` - der Schalter ist eine UI-Aktion, muss auch bei pausierter/
    gescrubbter Animation weich reagieren). Eigener kurzlebiger rAF-Ticker
    (`kickLabelsFadeTicker()`), unabhaengig von der Haupt-Playback-Loop
    (die nur bei `isPlaying` laeuft).
- **Alter Hand-Nachbau entfernt**: `mathCanvasRenderer.js` verlor
  `layoutFraction`/`drawFraction`/`layoutFractionPower`/
  `drawFractionPower`/`layoutSlashFraction`/`drawSlashFraction` (nicht mehr
  gebraucht) - nur `layoutScript`/`drawScript` bleiben (HUD-Subscript).
  Zugehoerige Tests entsprechend reduziert; `docs/MATHJAX_METRICS.md` mit
  Verweis auf diesen neuen Stand versehen (Methodik/Konstanten bleiben fuer
  den HUD-Anwendungsfall gueltig, fuer Achsen-Beschriftung ueberholt).
- **Bekannte, gewollte Nebenwirkung**: MathJax rendert manche Ausdruecke
  etwas breiter als der alte Hand-Nachbau - bei den schmalsten Zellen (hohe
  Exponenten) kann eine Beschriftung dadurch knapp nicht mehr in die
  verfuegbare Breite passen (der bestehende "passt es?"-Test greift dann
  haeufiger). Kein Bug, sondern die korrekte Konsequenz des genaueren
  Renderings (bestaetigt per Debug-Messung: identische MathJax-Breite fuer
  "(1/2)²" und "(1/2)³", nur die verfuegbare Zellbreite unterscheidet sich).
- **Neuer E2E-Test** (`tests/e2e/sqrt2.e2e.test.js` "MathJax-Renderer laedt
  einmalig, zweiter Aufruf nutzt den IndexedDB-Cache"): prueft genau das
  Kernversprechen - 1. Seitenaufruf laedt den `mathJaxRenderer`-Chunk
  (Netzwerk-Request beobachtet), 2. Aufruf (gleicher Browser-Context) NICHT
  mehr, keine Laufzeitfehler in beiden Faellen.
