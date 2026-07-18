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
     **nicht** die ganze Breite, sondern **rechts neben der Timeline**
     (Zeitregler) ganz unten in der `#bottomBar` angeordnet, schmal.

   Hintergrund: mit dieser Änderung bauen wir die *externe* Steuerung über ein
   weiteres Fenster / ein weiteres User-Gerät auf (Fernsteuerung / `/admin`).
   Die Controls sind der Ort für alle Regler; das Hauptfenster zeigt die
   Zeit/Pause dezent und den Geschwindigkeitsregler als schmales Element
   rechts neben der Timeline.

   - **Bug:** der Geschwindigkeitsregler war im unteren Balken nicht
     betätigbar (überschrieben/inkorrektes Layout durch die Phase-1-Zeile).
   - **Neu:** `playSpeed` (logarithmisch, Faktor 1 in der Mitte) lebt wieder in
     den Controls (Grundeinstellungen-Tab bzw. Fernsteuerung), als schmales
     Widget. Im Hauptfenster liegt ein dezenter, schmaler Geschwindigkeitsregler
     **rechts neben der Timeline in der `#bottomBar`**, optisch wie der
     Zeitregler.
   - **Bug (behoben):** jede Änderung an `playSpeed` löste einen
     **vollen Recompile** aus (compileOrchestrator hat auf JEDE
     configStore-Änderung `runJob` getriggert). `playSpeed` ist ein
     reine Laufzeit-Einstellung und darf KEINEN Compile auslösen. Fix:
     compileOrchestrator vergleicht jetzt einen `compileRelevantKey`
     (base/depth/transformMode/bankZoomThresholdPowers/zoomSpeedCoef/
     compactionEnabled/compactionTransitionTicks) und startet den Job nur,
     wenn sich EIN solches Feld ändert.

   ### Test-Kriterien (Geschwindigkeit)
    - [ ] Controls: ein Geschwindigkeitsregler ist in den Controls vorhanden
         und ändert `configStore.playSpeed` live (logarithmisch, Faktor 1 in
         der Mitte, Bereich ~1/20 … 20×).
    - [ ] Hauptfenster: ein schmaler Geschwindigkeitsregler ist **rechts
         neben der Timeline** in der `#bottomBar` sichtbar, nimmt NICHT die
         ganze Breite ein und ist betätigbar (ändert `playSpeed`).
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
- Quelle: `leafEffectiveSize()` (`recursive-layout.js:54`) lieferte volle
  Groesse bis `taken_time`, dann **hart 0** (im Code so stehend, begruendet
  im Kopfkommentar Zeilen 34-59 mit "sichtbarer Rest endet HART bei
  taken_time"). Ebenso der `cut_time`-Umschalt in `layoutBox` (`:86`):
  Blatt->geteilt ist ein harter Wechsel, keine Ueberblendung.

  **KORREKTUR (User-Klaerung):** dieses "hart" ist KEIN
  Missverstaendnis im Sinne einer Geschmacksfrage, sondern ein ECHTER BUG:
  die aktuelle Spezifikation sieht das Ausblenden der Luecke NICHT als
  harten C0-Sprung vor. Richtig: die Sichtbarkeit muss AUSGESCHALTET
  werden, ABER die Luecke (das Rechteck) soll WEICH VERSCHWINDEN - also ein
  C1-Ease-Out vom Design-Mass auf 0, statt eines C0-Sprungs.
- Kamera dagegen: `GLOBAL_TEIL_D_ZOOM_SPLINE.at(t).z` liefert im gesamten
  getesteten Zeitfenster **konstant** (max dz = 0) - die Kamera bewegt sich
  in diesem Ausschnitt gar nicht, waehrend der Inhalt springt. Das ist der
  wahrnehmbare Ruckel-Kontrast.

### ZWEI Luecken-Parameter (und EIN Interpolator)
Die Lücke wird durch ZWEI im `bank-core.js` beim Entnehmen eingefrorene
Tick-Werte gesteuert (`compactionParams` / `gapCloseDelayTicks` /
`transitionTicks`):
- **Hold:** wie lange die Lücke einfach SO BLEIBT WIE SIE IST
  (= `gapCloseDelayTicks`, am Stueck als `gapHoldTicks` gespeichert).
- **Compact:** wie lange es dauert, bis sie kompaktiert (weg) ist
  (= `transitionTicks`, am Stueck als `transitionSnapshot`).

Daraus die u_time-Phasengrenzen (in `finalizeCompiled()` aus dem
Tick->Zeit-Mapping abgeleitet, am Stueck als `gapHoldEnd_u` abgelegt):
- `t <= taken_time`            -> volle Design-Groesse (Sichtbarkeit an)
- `taken_time < t <= gapHoldEnd_u` -> volle Groesse (Hold/Luecke bleibt)
- `gapHoldEnd_u < t < te`     -> **C1-Ease** volle Groesse -> 0 (Compact)
- `t >= te`                    -> 0 (unsichtbar)

**EIN Interpolator** `gapEase(s)` (`recursive-layout.js`, exportiert):
Eingabe `s = normierter Fortschritt durch die Compact-Phase`
(`s = (t - gapHoldEnd_u)/(te - gapHoldEnd_u)`, also Eingabe wird
DRAUSSEN skaliert/verschoben), Ausgabe der Ease-Faktor. Reine
smoothstep (C1, Ableitung 0 an BEIDEN Enden -> keine Kinks bei
`gapHoldEnd_u` noch bei `te`). Die Phasengrenzen duerfen frei skaliert
werden (z.B. folgt `gapHoldEnd_u` dem Tick->Zeit-Raster, die Hold-Dauer
in u_time ist damit nicht strikt konstant) - der Interpolator SELBST
wird nicht neu berechnet. Hinweis: das ist bewusst KONSISTENT mit `te`
(max(te der Kinder) - ebenfalls Tick-basiert, nicht u_time-konstant).
Beim SCHNEIDEN (cut) bleibt die Masse erhalten (ein Stueck -> seine
Kinder), der cut-Umschalt ist KEIN Problem und wurde NICHT geaendert.

### Fix-Status: UMGESETZT (commit folgt)
`leafEffectiveSize()` (`recursive-layout.js`) nutzt jetzt `gapEase(s)`
statt hartem 0. Verifiziert per Unit-Test: entnommenes Blatt bleibt
voll bis `gapHoldEnd_u`, dann C1-Ease auf 0 bei `te` (max Flaechen-
Schritt ueber die Exit-Phase ~1e-5 statt des frueheren C0-Sprungs auf 0).
Bestelnde Tests, die das harte "sofort verschwunden" assertions
enthielten, wurden auf das C1-Verhalten umgeschrieben.

### Einordnung gegen CLAUDE.md "stetige Ableitung"
CLAUDE.md fordert fuer ALLE automatisierten Bewegungen C1 (kein Sprung in
Wert ODER Steigung). Der harte Blatt-Exit verletzte das - und zwar als
ECHTER BUG: die Spezifikation sieht das Ausblenden der Luecke NICHT als
harten C0-Sprung vor (s.o., User-Klaerung). Er war auch KEINE bewusste
Ausnahme. Der im Kopfkommentar genannte Grund ("kein Ease-Out brachte
laut Messung keine Rest-Drift-Besserung") bezog sich auf ein frueheres
Ausblenden BIS `te` (zu lang, zu spaet); ein kurzer, auf
`[gapHoldEnd_u, te]` begrenzter Ease-Out ist damit nicht widerlegt. Der
Konflikt bei `base=2/depth=40` + dicht getakteten Entnahmen: aus den
C0-Einzelsprüngen werden tausende pro Sekunde -> sichtbares Ruckeln.

### HARTE RAND-BEDINGUNG beim Weich-Ausblenden (nicht vergessen)
Die inklusive Grenze `t <= taken_time` MUSS erhalten bleiben: bei GENAU
`taken_time` ist das Blatt noch in Design-Groesse sichtbar. `flightQueryTime`
fragt bei gewoehnlichen Blaettern EXAKT `taken_time` ab (siehe
`bankOriginState()` in TargetBankCanvas.svelte) - sonst startet die
Flug-Animation bei (0,0) statt an der gerenderten Position, und das
Testkriterium "Bank-Zaehler == Bank-Visualisierung" bricht in genau diesem
einen Zeitpunkt. Das Weich-Ausblenden darf also erst FUER `t > taken_time`
(im Fenster `[gapHoldEnd_u, te]`) einsetzen; bei `t == taken_time`
bleibt die volle Groesse. Alle Rest-Widget-/Zahlentafel-Filter
(`t < p.taken_time`) muessen dieselbe inklusive Grenze nutzen.

### Diagnose-Skript (Reproduktion)
`/tmp/opencode/diag-smooth.mjs` (kompiliert base=2/depth=10, sampelt
`layoutCentered` ueber 8000 `u_time`-Schritte, misst Massen-/Zentrums-
Sprünge + Kamera-dz). Bestätigt: Massen-Sprünge bis 2.0/Frame (C0),
Kamera-dz = 0 im Fenster.

## Bug (NEU, gefunden nach dem C1-Blatt-Exit-Fix): Blatt-Exit und Kamera-Kompaktierung laufen ASynchron

Symptom (User): "während der Kompaktierung ist die Lücke NOCH gezeichnet
(Blatt sichtbar schrumpfend), obwohl die Kompaktierung (Nachbarn schliessen
die Lücke) BEREITS passiert ist" - Blatt-Exit und Kompaktierung greifen
zeitlich nicht zusammen.

### Wurzel
Beide Modelle teilen sich zwar dasselbe Tick-Fenster (`gapHoldTicks=1`,
`transitionTicks` aus `compactionTransitionTicks` - verifiziert in
`diag-raw.mjs`: leaf-exit Compact `[taken+1, taken+1+transitionTicks]`
== Kompaktierungs-Reserve-Fenster), ABER der (gedämpfte) Bank-Zoom
(`GLOBAL_TEIL_D_ZOOM_SPLINE`, aus `layoutCentered`-Zoom-Staenden bei den
`eventTimes`-Stützpunkten gebaut) kannte das Blatt-Exit-Fenster gar nicht:
`eventTimesSet` (`compiler.js`) enthielt nur jedes `taken_time` (Blatt VOLL),
aber NICHT `gapHoldEnd_u`/`te` (Blatt schrumpfend -> 0). Dazwischen lag
KEIN Stützpunkt, der gedämpfte Filter interpolierte über die ganze
Exit-Phase hinweg -> die Kamera "hinkt" hinter der tatsächlich gerenderten
Geometrie her: das Blatt ist im Rect-Layout schon auf 0 geschrumpft
(Nachbarn haben die Lücke geschlossen), aber der Zoom steht noch auf dem
"Blatt voll"-Zustand von `taken_time` -> Blatt erscheint noch schrumpfend.

### Fix (UMGESETZT)
`eventTimesSet` (`compileSystemData`) enthält jetzt zusätzlich jedes
`gapHoldEnd_u` und `te` eines entnommenen Blatts als Stützpunkt. Beide
Modelle (rekursives Rect-Layout UND Kamera-Spline) nutzen damit exakt
dasselbe Exit-Fenster; der gedämpfte Zoom trifft den "Blatt weg"-Zustand
jetzt bei `te` exakt. Budget erhalten: das bestehende `MAX_CHECKPOINTS`-
Downsampling greift weiterhin (gleichverteilt über ALLE Stützpunkte inkl.
der neuen), damit `finalizeCompiled()` auf dem Main-Thread nicht blockiert
(Kriterium 6: keine >500ms-rAF-Lücke während der Kompilierung). Sehr
kleine/tiefe Blätter ohne eigenen Knoten "hinken" höchstens marginal -
die sichtbaren großen/frühen Blätter sind behoben.

### Verifikation
- Unit-Test `compiler.test.js`: "TEIL D: Blatt-Exit-Fenster
  (gapHoldEnd_u, te) sind Kamera-Spline-Knoten" - prüft, dass beide
  Fenstergrenzen eines entnommenen Blatts in `GLOBAL_BANK_ZOOM_TIMES`
  als Stützpunkt vorhanden sind.
- `pnpm test:e2e` (16/16 grün, Kriterium 6 + 10 inklusive).
- `diag-camera.mjs`: `eventTimes` innerhalb eines Blatt-Exit-Fensters
  enthalten jetzt die Fenstergrenzen.

## Bug (NEU, nach dem C1-Blatt-Exit): Restteil waehrend der Ease-out-Phase noch gezeichnet

Symptom (User): "Restteil wird waehrend der-Ease-out-Phase angezeigt.
Die Luecke muss sichtbar sein, das Teil wird dann aber nicht mehr
gezeichnet." - das Blatt wurde im Rect-Layout noch als schrumpfendes
Rechteck GEZEICHNET (ueber die ganze Compact-Phase [gapHoldEnd_u, te]
hinweg), obwohl die Rest-Zaehlung (`computeLiveL`, Filter `t <=
taken_time`) es schon ab `taken_time` ausgeblendet hatte -> Blatt und
Rest-Zaehler waren asynchron, und das Teil war sichtbar, wo es nicht
mehr sein sollte.

### Fix (UMGESETZT)
In `layoutBox` (`recursive-layout.js`) wird die effektive Slot-Groesse
(`leafEffectiveSize`) UNVERAENDERT weitergereicht (treibt Parent-Cursor
+ Masse, damit die Luecke sichtbar BLEIBT und sich ueber
[gapHoldEnd_u, te] C1 schliesst - das ist das gewuenschte "Luecke
sichtbar"). ABER das `out.push` (das tatsaechliche ZEICHNEN) ist jetzt
auf `t <= taken_time` (inklusive Grenze, wichtig fuer `flightQueryTime`)
begrenzt: ab `t > taken_time` wird das Stueck NICHT mehr gezeichnet.
Damit sind Blatt-Zeichnung und Rest-Zaehlung exakt synchron bei
`taken_time`, und die Luecke (reservierter Slot) schliesst sich weich
C1, waehrend das Teil selbst nicht mehr gezeichnet wird.

### Verifikation
- `recursive-layout.test.js`: die drei Blatt-Exit-Tests wurden auf das
  neue Modell umgeschrieben - sie pruefen jetzt die RESERVIERTE
  Slot-Groesse (via `layoutBox`-Rueckgabe) statt der gezeichneten Rect:
  voll bis `taken_time` (und dort noch gezeichnet), danach Slot voll in
  der Hold-Phase (Luecke sichtbar, Teil nicht gezeichnet), C1 -> 0 bei
  `te`.
- `pnpm test:e2e`: die 2 Kriterium-6/10-Fails unter VOLL-SUITE-Last
  sind praeexistend (Ressourcen-Konkurrenz bei 16 schweren Tests,
  bestehen unabhaengig von diesem Change auch auf dem Vorgaenger-Commit
  `b1f3412`; in Isolation gruen).
- `diag-notdrawn.mjs` / `diag-slot.mjs`: Blatt nur bei `taken_time`
  gezeichnet; Masse/Slot bleibt ueber die Exit-Phase reserviert und
  schrumpft C1.

## Flug-Stottern: Korrelation mit HUD-Update (neue Hypothese)

Der Haupt-Hebel fuer das **Flug**-Stottern ist NICHT der Blatt-Exit
(s.o.), sondern die **Zwei-Uhren-Architektur** + die teure HUD-Aktualisierung:

- Canvas `loop()` (`TargetBankCanvas.svelte:570`) laeuft EIGENEN
  `requestAnimationFrame`, advance `u_time` und zeichnet **jeden Frame**
  inkl. der Flug-Animation (`render_pipeline`, Zeilen 418-510).
- `App.svelte:207` abonniert `playbackStore` -> `updateHUD(u_time)`.
  `loop()` schreibt JEDEN Frame `playbackStore.set({time})`
  (`TargetBankCanvas.svelte:591`) -> die HUD wird **pro Frame** neu
  berechnet: `computeLiveL` + `innerHTML`-Rewrite + **MathJax
  `typesetPromise`** (teuer, blockiert den Main-Thread).
- Korrelation: HUD-Aenderungen cluster GENAU dann, wenn Schalen
  abschliessen (Ziffern wechseln) = wenn Fluege passieren. Das blockierende
  MathJax-Typeset stallt den rAF-`loop` -> die Flug-Animation ruckelt.
  Zwei Uhren, selbe Zeitquelle, aber verschiedene Kosten/Takte.

### Schalter eingebaut (Diagnose, noch NICHT die eigentliche Fix)
Zwei Checkboxen im Animation-Tab (`ControlPanel.svelte`) + configStore-
Felder + URL-Parameter, um die Quelle zu isolieren:
- **`hudUpdateEnabled`** (URL `hud=0`): gatet `updateHUD` in
  `App.svelte` (playback-Subscribe + applyConfig). Bei `0` wird die
  Zahlentafel nicht neu typsettet -> MathJax blockiert den Loop nicht mehr.
- **`bankRenderEnabled`** (URL `bankrender=0`): gatet `renderFrame` in
  `TargetBankCanvas.svelte` (fruehes Return). Bei `0` friert der
  Bank-Canvas (inkl. Flug) ein.

Test-Kriterium zur Isolierung:
- `hud=0` -> Flug wird ruhig => HUD/MathJax IST die Quelle. **BESTAETIGT
  (laeuft nun butterweich):** mit `hud=0` laeuft die Flug-Animation
  raeumlich gluckenfei; das Stottern kam ausschliesslich aus dem pro-Frame
  HUD-Update (MathJax-Typeset blockiert den rAF-Loop).
- `bankrender=0`, `hud=1` -> HUD aktualisiert sich, Bank steht =>
  bestaetigt die Entkopplung.

### Fazit: MathJax ist fuer die Zahlendarstellung UNGEEIGNET
Die Zahlentafel (l/l²/R) wird ueber `updateHUD()` (`App.svelte:62`)
jeden sichtbaren Schritt neu als LaTeX-String gebaut und via
`MathJax.typesetPromise` gerendert. Das ist fuer eine **pro-Frame-
Animation** grundsaetzlich falsch:
- MathJax ist ein schwerer, synchron blockierender Typesetter (DOM-Rewrite
  + Layout), kein Canvas-/Text-Renderer. Schon ein einzelnes Typeset
  pro sichtbarem Ziffernwechsel reicht, um den rAF-Loop zu stallen -
  exakt dann, wenn Schalen abschliessen (= wenn Fluege passieren).
- Die Zahlentafel zeigt ohnehin nur 3 kurze Zeilen (l, l², R) in
  Basis-Darstellung - das braucht KEINEN vollwertigen Math-Typesetter.

### Eigener Renderer fuer die Zahlendarstellung (UMGESETZT + auf Canvas verlagert)
MathJax durch einen leichtgewichtigen, **eigenen** Renderer ersetzt
(`src/lib/numberRenderer.js` + `formatLiveNumbers` + `splitBaseNumber`).
Die Zahlentafel (l/l²/R) wird JETZT **direkt auf dem Bank-Canvas gemalt**
(`TargetBankCanvas.svelte` `renderFrame` -> `renderHud()`), nicht mehr ins
DOM geschrieben. Layout: **linksbuendig oben**, Schriftgroesse wird
**automatisch verkleinert**, falls die laengste Zeile die verfuegbare
Breite ueberschreitet.

Performance: das Canvas wird pro Frame voll geloescht, die Zahlentafel
muesste also eigentlich jeden Frame neu gezeichnet werden - das (inkl. dem
teuren `computeLiveL`/BigInt) WAR die Performance-Regression (massiv
langsamer). Daher wird die Zahlentafel nur NEU berechnet + auf ein
**Offscreen-Canvas** gemalt, wenn sich die angezeigten Werte (Hash ueber
l/l²/R/Basis) ODER die Canvas-Groesse aendern. Pro Frame wird nur das
gecachte Bitmap via `drawImage` aufgelegt (sehr guenstig, kein Reflow,
keine BigInt-Berechnung pro Frame). Der Schalter "Zahlendarstellung"
(`hudUpdateEnabled`) schaltet die Anzeige weiterhin ab (Cache wird
zurueckgesetzt).

Anforderungen (aus dem alten TODO), alle erfuellt:
- KEIN MathJax, KEINE pro-Frame Typeset-Neuberechnung. Dezimalpunkte
  ALLER Zeilen stehen exakt untereinander (reines `fillText`, drei
  rechtsbuendige Zeilen).
- Uebenimmt die exakte BigInt-Darstellung aus `computeLiveL` (P_str /
  P2_str / rem_str inkl. Basis-Punkt-Formatierung + Trailing-Zero-Trim
  aus `App.svelte` `updateHUD`) - nur die *Darstellungsschicht*
  getauscht, nicht die Mathematik.
- DOM-Zwischenschicht entfernt: das stuendige `innerHTML`-Umschreiben in
 kl. `#numberPanel` INKL. erzwungenem Reflow (`updateNumberPanelScale`
  las scrollWidth/clientWidth) verursachte nach dem MathJax-Entzug NEUE
  Ruckler. Canvas-Paint hat keinen Reflow, kein `innerHTML`. `App.svelte`
  `updateHUD`/`updateNumberPanelScale` + das `#numberPanel`-Markup und die
  `.np-*`-CSS-Regeln sind entfernt; `compiledRef` wird in
  `TargetBankCanvas.applyConfig` aus dem `compiledStore` uebernommen.
- `index.html`: MathJax-`<script>` (cdn.jsdelivr) + `window.MathJax`-
  Chtml-Config entfernt. Keine externe Bibliothek mehr.
- `hudUpdateEnabled`-Schalter (nur Diagnose) bleibt als nuetzliches
  Wartungs-Werkzeug erhalten (nun ohne Funktion in der Zahlentafel);
  der `bankRenderEnabled`-Schalter bleibt.

Verifikation:
- Unit-Test `tests/unit/numberRenderer.test.js` (5 Tests): splitBaseNumber
  + formatLiveNumbers (l/l²/R, Trailing-Zero-Trim, Basis>10
  Buchstaben-Ziffern, ganzzahlig, KEIN MathJax-Markup).
- `pnpm test:e2e` sqrt2-Suite (8/8): Canvas + HUD mount, l/l²/R
  werden wie zuvor in der gewaehlten Basis dargestellt.
- Flug-Animation bei `hud=1` (Default): nicht mehr durch pro-Frame
  MathJax-Typeset blockiert (Haupt-Hebel des Flug-Stotterns, via
  `hud=0` bestaetigt). Die verbleibende Restarbeit am Stottern
  (C1-Blatt-Exit, async Kamera, s.o.) ist unabhaengig davon.


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
  - [x] **Eigener Renderer für Zahlendarstellung (statt MathJax)** - UMGESETZT
        (s. "Eigener Renderer für die Zahlendarstellung (UMGESETZT)" oben).
        MathJax als pro-Frame-Typesetter war die Ursache des Flug-Stotterns
        (via `hud=0` bestätigt); `updateHUD()` behält die BigInt-Mathematik
        aus `computeLiveL`, nur die Darstellungsschicht wurde getauscht.
  - [x] **BUG: Lücke hart ausblenden (kein Ease)** - war `leafEffectiveSize()`
        (`recursive-layout.js`) hart auf 0 statt C1-Ease-Out. **UMGESETZT:**
        `gapEase(s)`-Interpolator + Hold/Compact-Phasen via `gapHoldEnd_u`
        (s. "Fix-Status: UMGESETZT" oben). Inklusive `t <= taken_time`-
        Grenze gewahrt (`flightQueryTime`!), Unit-Tests angepasst.
