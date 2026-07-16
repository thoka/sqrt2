Lass uns die Einstellungen / die Remote-Steuerung aufräumen

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

  - [ ] Einstellungen öffnen sich am gesamten rechten Rand, nicht nur oben
        rechts (Reveal-Zone erweitern - reine Ersteinrichtungs-Bedienung,
        siehe oben)
    - [ ] "Tiefe > 5 kann Leistung beeinträchtigen." kann weg
      - [ ] Stattdessen: Neuberechnung asynchron und cancelbar (bei
            Wertänderung) - eigener Plan mit Testkriterien:
            `docs/ASYNC-COMPILE-PLAN.md` (komplex, eigene Session)

  - [ ] Einstellungen in Tabs gliedern:
    - [ ] Grundeinstellungen
    - [ ] Remote-Connect
    - [ ] Animation
    - [ ] Admin

  - [ ] Remote-Steuerung (Besucher-QR) zeigt nur Grundeinstellungen
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
   - [ ] Basis (b) -> "Basis"
   - [ ] Tiefe ($n_{max}$) -> "Tiefe"
   - [ ] Modus B (modeAB) -> "Zoom"
   - [ ] Auto-Zoom: Mindestbreite feinste Stelle (Pixel, 0 = aus) -> "Auto-Zoom: Mindestbreite (px)"
         - gleiches Widget in Remote-Steuerung UND Config nutzen, inkl.
           Anzeige, wenn Auto-Zoom den Zoom-Regler übersteuert
   - [ ] Kompaktierung (compactionEnabled) -> "Kompaktierung"
         - wenn eingeschaltet: Zoom-Schwellwert (Admin) ausgegraut
   - [ ] Kompaktierung: Übergangsdauer (Ticks) -> "Übergangsdauer (Ticks)"
         (direkt unter Kompaktierung, "Kompaktierung" nicht im Label wiederholen)

  ### Animation
   - [ ] Transformation (Flug-Modus) -> "Flug-Modus"
   - [ ] Bank-/Kompaktierungs-Zoom: Trägheit -> "Zoom-Trägheit"
   - [ ] Linienbreite (Erklärtext raus, nur bei Bedarf/ⓘ) -> "Linienbreite"
   - [ ] Wiedergabe: Wartezeit an Anfang & Ende -> "Wartezeit (Anfang/Ende)"
         (ehemals als "nach Admin auslagern" notiert - bleibt hier im
         Animation-Tab, da der Tab selbst schon nicht besucher-sichtbar ist;
         bei Bedarf revidieren)

  ### Admin
   - [ ] Zoom-Schwellwert (Potenzen ignorieren) -> "Zoom-Schwellwert"
         - immer zur Basis 10 interpretiert, d.h. mit 10/Basis multiplizieren
   - [ ] Tick (Vergleich mit Test-Tool) -> "Tick (Debug)"
   - [ ] Rest-Anzeige (austauschbares Widget) -> "Rest-Anzeige"
         - **hat aktuell keine Wirkung** (Bug/TODO, unabhängig vom Umbau zu klären)
   - [ ] Aktuellen Zustand teilen (URL / Parameter kopieren)

  ### Remote-Connect
   - [ ] Fernsteuerung (Handy via QR) - kompletter bestehender Block
         (Relay-URL, API-Key, Seats, PIN, Session)

  ### Außerhalb der Tabs
   - [ ] Geschwindigkeit (playSpeed) -> log. Regler über der Zeitleiste
   - [ ] Zeit / Tick / Play -> Scrollbar unten, immer sichtbar

## Später (nach Phase 1)

  - [ ] Standard-Zahlwidget final festlegen + überall anwenden
  - [ ] Scroll-Rad-Listener auf Zahlenfeldern
  - [ ] `/admin`-Route implementieren (neuer Vite-Entry, analog `remote.html`)
  - [ ] weitere Admin-only-Werte bündeln
