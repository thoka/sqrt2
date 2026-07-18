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
