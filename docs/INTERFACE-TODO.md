Lass uns die Einstellungen / die Remote-Steuerung aufräumen

## Stand / Entscheidungen (Phase 1 umgesetzt)

  - **Tabs als eine Komponente:** `ControlPanel.svelte` rendert alle vier
    Tabs (Grundeinstellungen / Animation / Admin / Remote-Connect). Die
    Fernsteuerung (`RemoteControl.svelte`) übergibt `visibleTabs={['Grundeinstellungen']}`
    und sieht nur diesen Tab. Das Exponat-Overlay (gleiche Komponente) zeigt
    alle Tabs. Die `/admin`-Route (noch offen) wäre ein weiterer Host mit
    `visibleTabs = alle` - keine neue Logik nötig.
  - **Zoom-Schwellwert (Admin):** im Store bleibt `bankZoomThresholdPowers`
    (Potenzen zur echten Basis, wie vom Canvas erwartet). Die UI zeigt einen
    Basis-10-Wert und rechnet beim Schreiben mit `10/base` um (siehe
    `base10Threshold`/`onThreshold10Change`). Bei aktiver Kompaktierung ist
    das Feld disabled + Hinweis.
  - **Geschwindigkeit:** `playSpeed` wanderte aus dem Einstellungs-Panel in
    die `PlaybackBar` als **logarithmischer** Regler über der Zeitleiste
    (Faktor 1 in der Mitte, Bereich ~1/20 … 20×). Zeit/Tick/Play unten sind
    jetzt immer sichtbar (kein Reveal-Gating mehr für die Playback-Controls).
  - **Reveal-Zone:** das Einstellungs-Overlay klappt jetzt am gesamten rechten
    Rand auf (`RIGHT_REVEAL_ZONE_PX`), nicht nur oben rechts.
  - **Nicht mehr in Phase 1:** `/admin`-Vite-Entry (eigener Host),
    Scroll-Rad auf Zahlenfeldern, Finalisierung des Standard-Zahl-Widgets,
    asynchroner/cancelbarer Recompile. Diese bleiben unter "Später".
  - **Regressions-Achtung:** die vom Canvas per `getElementById` beschriebenen
    Readouts `#bankZoomLabel`/`#bankAreaLabel` mussten im Grundeinstellungs-Tab
    erhalten bleiben (sie werden aus `TargetBankCanvas` heraus aktualisiert).

  ## Korrektur: Geschwindigkeitsregler (Layout + Bug)

  Das in Phase 1 gewählte Layout war falsch verstanden:

  - **Missverständnis (Phase 1):** `playSpeed` als eigene, ganze Breite
    einnehmende Zeile ÜBER der Zeitleiste im unteren Balken platziert.
  - **Richtig (neue Anforderung):** Geschwindigkeitsregler UND
    Zeit-Positionsregler gehören als **kompakte, externe Steuerung** in die
    *Controls* (Einstellungs-Panel bzw. Fernsteuerung) - unabhängig von der
    Zeit-Darstellung im Hauptfenster. Im Hauptfenster selbst soll der
    Geschwindigkeitsregler **genauso dezent** sein wie der Zeitregler:
    **nicht** die ganze Breite, sondern rechts vor dem Bank-Zähler
    (Rest-Counter) angeordnet, schmal.

  Hintergrund: mit dieser Änderung bauen wir die *externe* Steuerung über ein
  weiteres Fenster / ein weiteres User-Gerät auf (Fernsteuerung / `/admin`).
  Die Controls sind der Ort für alle Regler; das Hauptfenster zeigt die
  Zeit/Pause dezent und den Geschwindigkeitsregler als schmales Element am
  rechten Rand vor dem Bank-Zähler.

  - **Bug:** der Geschwindigkeitsregler war im unteren Balken nicht
    betätigbar (überschrieben/inkorrektes Layout durch die Phase-1-Zeile).
  - **Neu:** `playSpeed` (logarithmisch, Faktor 1 in der Mitte) lebt wieder in
    den Controls (Grundeinstellungen-Tab bzw. Fernsteuerung), als schmales
    Widget. Im Hauptfenster liegt ein dezenter, schmaler Geschwindigkeitsregler
    **rechts vor dem Bank-Zähler** (`#bankPanel`), optisch wie der Zeitregler.

  ### Test-Kriterien (Geschwindigkeit)
   - [ ] Controls: ein Geschwindigkeitsregler ist in den Controls vorhanden
         und ändert `configStore.playSpeed` live (logarithmisch, Faktor 1 in
         der Mitte, Bereich ~1/20 … 20×).
   - [ ] Hauptfenster: ein schmaler Geschwindigkeitsregler ist rechts VOR dem
         Bank-Zähler (`#bankPanel`) sichtbar, nimmt NICHT die ganze Breite ein
         und ist betätigbar (ändert `playSpeed`).
   - [ ] Unabhängigkeit: Änderung der Zeit-Darstellung/des Zeitreglers im
         Hauptfenster beeinflusst den Geschwindigkeitsregler nicht und umgekehrt.
   - [ ] E2E: Geschwindigkeitsregler in der Fernsteuerung (`/remote.html`)
         ändert die Wiedergabegeschwindigkeit im Hauptfenster (Sync via
         BroadcastChannel, analog zum bestehenden Sync-Test).
   - [ ] E2E: der schmale Geschwindigkeitsregler im Hauptfenster ist per Klick
         betätigbar und schreibt `playSpeed` (kein Overlay/keine tote Zone).

## Ruckeln / "stotternder Film" - Root-Cause (Korrektur der 1e-9-Hypothese)

URL: `base=2&depth=40&mode=S&zoomthresh=0&autozoom=3&zoomspeed=0.012&
linewidth=0.3&pause=1.5&compaction=1&speed=0.0687&transition=3&time=94.934&play=1`

### Korrektur der urspruenglichen Hypothese
Die erste Vermutung war: die festen `1e-9`-Schwellen in `buildCompactionMap`
(`bank-core.js:387`/`:420`) liessen die Kamera pro Frame springen. **FALSCH.**
Diese Schwellen laufen NUR bei der Kompilierung (einmalig) ueber
`computeCompactionFitStates` -> `computeCompactionAt` -> `buildCompactionMap`
(`compiler.js:617`), um die Compile-Zeit-Kamera-Fit-Wegpunkte zu bauen. Zur
Laufzeit werden die Stueck-POSITIONEN NICHT ueber diese Map gerechnet - das
macht der rekursive Renderer selbst (siehe unten). Die `1e-9` sind also ein
reines Compile-Zeit-Thema, kein Per-Frame-Stutter.

### Was wirklich stottert: die Geometrie ist C0, die Kamera C1
Der rekursive Renderer (`recursive-layout.js`, `layoutBox`/`layoutCentered`)
berechnet die sichtbaren Stueck-Rechtecke **exakt bei `u_time`**, OHNE
jegliche zeitliche Interpolation/Glaettung der Geometrie selbst. Nur die
Kamera (`GLOBAL_TEIL_D_ZOOM_SPLINE`, ein `buildDampedFilterBundle` ueber
`eventTimes`-Checkpoints) ist C1/gedaempft. Das fuehrt zum asymmetrischen
"Stotterfilm": die Kamera gleitet weich, waehrend der Inhalt harte Spruenge
macht.

Konkret (gemessen mit einem Node-Diagnostic ueber `compileSystem` + feines
`u_time`-Sampling, base=2/depth=10 als Stellvertreter):
- **Massen-Sprung bis 2.0 volle Einheiten in EINEM Frame** an Ereignis-
  zeitpunkten (C0-Diskontinuitaet). Bei `dt~1.18e-3` ist das ein echter
  Sprung, keine interpolierte Bewegung.
- Quelle: `leafEffectiveSize()` (`recursive-layout.js:54`) liefert volle
  Groesse bis `taken_time`, dann **hart 0** (bewusste Design-Entscheidung
  dort, Zeilen 34-59: "sichtbarer Rest endet HART bei taken_time"). Ebenso
  der `cut_time`-Umschalt in `layoutBox` (`:86`): Blatt->geteilt ist ein
  harter Wechsel, keine Ueberblendung.
- Kamera dagegen: `GLOBAL_TEIL_D_ZOOM_SPLINE.at(t).z` liefert im gesamten
  getesteten Zeitfenster **konstant** (max dz = 0) - die Kamera bewegt sich
  in diesem Ausschnitt gar nicht, waehrend der Inhalt springt. Das ist der
  wahrnehmbare Ruckel-Kontrast.

### Einordnung gegen CLAUDE.md "stetige Ableitung"
CLAUDE.md fordert fuer ALLE automatisierten Bewegungen C1 (kein Sprung in
Wert ODER Steigung). Die Bank-Geometrie ist hier bewusst davon ausgenommen
(harter Blatt-Exit, begruendet mit "kein Ease-Out brachte laut Messung
keine Rest-Drift-Besserung"). Das ist der eigentliche Konflikt: bei
`base=2/depth=40` + vielen, dicht getakteten Entnahmen (hier ~37
Ereigniszeiten auf `MAX_TIME~9.45` bei depth=10; bei depth=40 entsprechend
viel dichter) werden aus den C0-Einzelsprüngen tausende pro Sekunde ->
sichtbares Ruckeln.

### Offene Richtungsfrage (noch NICHT umgesetzt)
Moegliche Hebel, um "Interpolation der Zeit glatt genug" zu machen, OHNE die
Rest-Drift-Garantie zu brechen:
1. Die Bank-Geometrie (nicht nur die Kamera) ueber `computeSegmentBlend()`
   oder `buildDampedFilterBundle()` zeitlich glaetten - aber: der harte
   Blatt-Exit ist aktuell BEWUSST hart (s.o.), aendert man das, muss die
   Bank/Rest-Drift erneut vermessen werden.
2. `u_time` nicht linear, sondern ueber eine C1-Zeit-Transformation
   vorruecken lassen, die bei Ereignisdichten automatisch "ausdünnt"
   (Vermeidung von Häufungs-Sprüngen) - entspräche der "stetigen
   Ableitung" der ZEIT selbst.
3. `MAX_CHECKPOINTS=400` (`compiler.js:297`) ist fuer depth=40 zu
   grob: die Kamera-Spline-Stuetzpunkte werden auf 400 heruntergesampelt,
   waehrend die Geometrie an ALLEN Ereigniszeiten (viel mehr) springt ->
   Kamera und Inhalt laufen auseinander. Feineres Sampling oder
   ereignis-relative Kamera-Waypoints pruefen.

### Diagnose-Skript (Reproduktion)
`/tmp/opencode/diag-smooth.mjs` (kompiliert base=2/depth=10, sampelt
`layoutCentered` ueber 8000 `u_time`-Schritte, misst Massen-/Zentrums-
Sprünge + Kamera-dz). Bestätigt: Massen-Sprünge bis 2.0/Frame (C0),
Kamera-dz = 0 im Fenster.

## Architektur: drei Oberflächen, eine Komponente

  - **Exponat selbst** (`#settingsPanel`-Overlay, Hover-Reveal): nur während
    der Ersteinrichtung relevant - danach hat das Exponat kein
    Eingabegerät mehr angeschlossen, das Overlay wird nicht mehr benutzt.
  - **Remote-Steuerung** (`remote.html`, QR-Code fürs Besucher-Handy):
    zeigt NUR den Tab "Grundeinstellungen".
  - **`/admin`-Route** (neu, für Kurator auf separatem Gerät/Fenster, nach
    der Ersteinrichtung der primäre Zugriffsweg): äquivalent/identisch
    zum Exponat-Overlay - alle Tabs, alle Felder. Gleiche Komponente wie
    das Overlay, nur eigener Host (analog zu `remote.html`, aber ohne
    Tab-Einschränkung).

  Damit sind "Admin-Tab" und "Auslagern nach /admin" keine zwei
  konkurrierenden Konzepte mehr: der Admin-**Tab** bündelt Kurator-/
  Debug-Felder (Zoom-Schwellwert, Tick-Debug, Rest-Anzeige, Zustand
  teilen) *innerhalb* der einen Komponente; die `/admin`-**Route** zeigt
  einfach alle Tabs dieser Komponente auf einem eigenen Gerät.

  - [x] Einstellungen öffnen sich am gesamten rechten Rand, nicht nur oben
        rechts (Reveal-Zone erweitern - reine Ersteinrichtungs-Bedienung,
        siehe oben)
    - [x] "Tiefe > 5 kann Leistung beeinträchtigen." kann weg
      - [ ] Stattdessen: Neuberechnung asynchron und cancelbar (bei
            Wertänderung) - eigener Plan mit Testkriterien:
            `docs/ASYNC-COMPILE-PLAN.md` (komplex, eigene Session)

  - [x] Einstellungen in Tabs gliedern:
    - [x] Grundeinstellungen
    - [x] Remote-Connect
    - [x] Animation
    - [x] Admin

  - [x] Remote-Steuerung (Besucher-QR) zeigt nur Grundeinstellungen
  - [ ] `/admin`-Route: alle Tabs, äquivalent zum Exponat-Overlay (neuer
        Vite-Entry analog `remote.html`, ohne Tab-Filter)

  Designkriterien (für alle Einstellungen gemeinsam)
    - so elegant wie möglich
    - Erklärungen nur später bei Bedarf einblenden
    - Zeit-Scrollbar unten immer sichtbar und ganze Breite
    - Darüber Geschwindigkeitsregler, nichtlinear (logarithmisch: Faktor 1 in der Mitte)
    - Standard-Widgets für Zahlen ausprobieren (Label + Zahl in einer Zeile, minimaler Platz)
    - (Phase 2) Scroll-Rad auf Zahlenfeldern = inkrementieren/dekrementieren

## Phase 1: Umbenennen, Labels aufräumen, Reihenfolge, Tabs zuordnen

  ### Grundeinstellungen
   - [x] Basis (b) -> "Basis"
   - [x] Tiefe ($n_{max}$) -> "Tiefe"
   - [x] Modus B (modeAB) -> "Zoom"
   - [x] Auto-Zoom: Mindestbreite feinste Stelle (Pixel, 0 = aus) -> "Auto-Zoom: Mindestbreite (px)"
         - gleiches Widget in Remote-Steuerung UND Config nutzen, inkl.
           Anzeige, wenn Auto-Zoom den Zoom-Regler übersteuert
   - [x] Kompaktierung (compactionEnabled) -> "Kompaktierung"
         - wenn eingeschaltet: Zoom-Schwellwert (Admin) ausgegraut
   - [x] Kompaktierung: Übergangsdauer (Ticks) -> "Übergangsdauer (Ticks)"
         (direkt unter Kompaktierung, "Kompaktierung" nicht im Label wiederholen)

  ### Animation
   - [x] Transformation (Flug-Modus) -> "Flug-Modus"
   - [x] Bank-/Kompaktierungs-Zoom: Trägheit -> "Zoom-Trägheit"
   - [x] Linienbreite (Erklärtext raus, nur bei Bedarf/ⓘ) -> "Linienbreite"
   - [x] Wiedergabe: Wartezeit an Anfang & Ende -> "Wartezeit (Anfang/Ende)"
         (ehemals als "nach Admin auslagern" notiert - bleibt hier im
         Animation-Tab, da der Tab selbst schon nicht besucher-sichtbar ist;
         bei Bedarf revidieren)

  ### Admin
   - [x] Zoom-Schwellwert (Potenzen ignorieren) -> "Zoom-Schwellwert"
         - immer zur Basis 10 interpretiert, d.h. mit 10/Basis multiplizieren
   - [x] Tick (Vergleich mit Test-Tool) -> "Tick (Debug)"
   - [x] Rest-Anzeige (austauschbares Widget) -> "Rest-Anzeige"
         - **hat aktuell keine Wirkung** (Bug/TODO, unabhängig vom Umbau zu klären)
   - [x] Aktuellen Zustand teilen (URL / Parameter kopieren)

  ### Remote-Connect
   - [x] Fernsteuerung (Handy via QR) - kompletter bestehender Block
         (Relay-URL, API-Key, Seats, PIN, Session)

  ### Außerhalb der Tabs
   - [x] Geschwindigkeit (playSpeed) -> log. Regler über der Zeitleiste
   - [x] Zeit / Tick / Play -> Scrollbar unten, immer sichtbar

## Später (nach Phase 1)

  - [ ] Standard-Zahlwidget final festlegen + überall anwenden
  - [ ] Scroll-Rad-Listener auf Zahlenfeldern
  - [ ] `/admin`-Route implementieren (neuer Vite-Entry, analog `remote.html`)
  - [ ] weitere Admin-only-Werte bündeln
