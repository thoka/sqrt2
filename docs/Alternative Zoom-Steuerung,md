# Alternative (Rand-) Zoom-Steuerung

Lass uns eine andere Rand-Zoom-Steuerung ausprobieren (d.h. ein- und ausschaltbar über eine Checkbox im Admin-Tab).

Momentan hat der Nutzer zwei Schieberegler zur Steuerung des Zooms.

Alternativ könnte die Steuerung nur zwischen drei Zuständen verstellen (vie Radio-Button oder Später physischem Drei-Stufen schalter):
- Flächentreu (entspricht Zoom aus / Autozoom ganz links)
- Rand sichtbar (jetziger Schieberegler bleibt, aber im Animation-Tab)
- Gleichmäßig (entspricht Autozoom ganz rechts)

Die Übergänge dazwischen sollen allerdings weich animiert sein.
Wir bräuchten einen allgemeinen Parameter-Tweener für die Animationen.
Später sollte auch das Einschalten der Beschriftung weiches Einblenden sein etc.

Ziel dieses Versuchs ist  über Konzentration auf die wesentliche Funktionalität den Nutzer zu entlasten und nur optimierte Defaults anzubieten.

## Stand / Entscheidungen (ERSTER Versuch, seither beerdigt - siehe unten)

> Der folgende Abschnitt beschreibt den ERSTEN Umsetzungsversuch
> (Feder-Tween direkt auf `modeAB`/`autoZoomMinPx` + diskrete
> Zustands-Radios). Er ist wegen der im Feedback unten beschriebenen
> Probleme + der Erkenntnis "erst den Steuerungsraum umbauen, dann
> darauf aufsetzen" komplett zurueckgebaut worden (Commit
> "Feder-basierte Zoom-Zustands-Steuerung beerdigt"). Bleibt hier
> stehen als Dokumentation DIESES Zwischenschritts, siehe "Status:
> Grundlegender Umbau umgesetzt" ganz unten fuer den aktuellen Stand.

  - **Default aus, opt-in:** `configStore.edgeZoomControlMode` (Default
    `false`) schaltet die Alternativ-UI frei - solange sie aus ist, bleibt
    das bisherige Zwei-Regler-Verhalten (Grundeinstellungen: "Auto-Zoom:
    Mindestpixelgröße" + "Zoom") unveraendert und unangetastet. Checkbox
    "Alternative Rand-Zoom-Steuerung" im Admin-Tab.

  - **Preset-Mapping der 3 Zustaende** auf die zwei bestehenden Laufzeit-
    Felder `modeAB`/`autoZoomMinPx` (beide unveraendert vom Canvas gelesen,
    siehe `TargetBankCanvas.svelte`):
    | Zustand | modeAB | autoZoomMinPx |
    |---|---|---|
    | Flächentreu | 0 | 0 (Auto-Zoom aus) |
    | Rand sichtbar | `randZoomLevel` (Feinregler-Wert) | 3 (bisheriger Default) |
    | Gleichmäßig | 1 | 100 (Auto-Zoom-Slider-Maximum) |

    `randZoomLevel` ist ein eigenes Store-Feld (nicht `modeAB` selbst),
    weil `modeAB` beim Besuch der beiden anderen Zustaende ueberschrieben
    wird - ohne einen getrennten Merker wuerde ein Ausflug nach
    "Flaechentreu"/"Gleichmaessig" die Feineinstellung fuer "Rand sichtbar"
    verwerfen.

  - **"Rand sichtbar" behaelt den alten Feinregler:** der bisherige "Zoom"-
    Schieberegler (Grundeinstellungen) lebt im Alt-Modus im Animation-Tab
    weiter ("Zoom (Feinregler für „Rand sichtbar")"), disabled außer im
    Zustand "Rand sichtbar". Direkte Regler-Bedienung bleibt bewusst
    ungedaempft/live (kein Tween) - CLAUDE.md nimmt Maus-Drag explizit von
    der C1-Glaettungspflicht aus, nur die diskrete Zustandswahl (Radio-
    Klick) ist eine "automatisierte" Aenderung im Sinne dieser Regel.

  - **Genereller Echtzeit-Tweener statt Wiederverwendung von
    `smoothing.js`:** `smoothing.js` glaettet ueber die kompilierte
    Animations-Zeitachse (`u_time`), deren Stuetzpunkte VOR dem Rendern
    bereits alle bekannt sind - passt nicht auf eine Radio-Button-Wahl zu
    einer vorher unbekannten Echtzeit, bei der der Nutzer auch mitten in
    einem laufenden Uebergang erneut waehlen kann (Retargeting). Neues,
    eigenstaendiges Modul `src/lib/paramTween.js`
    (`createSpringTween()`/`springStep()`): klassischer kritisch gedaempfter
    Feder-Integrator mit explizitem Geschwindigkeits-Zustand (Prinzip von
    Unitys `Mathf.SmoothDamp`) - dadurch ist JEDES Retargeting, zu JEDEM
    Zeitpunkt, per Konstruktion C1 (siehe Modul-Kopfkommentar fuer die
    volle Begruendung inkl. Abgrenzung zu `buildDampedFilter()`).

  - **Treiber-Modul `src/lib/zoomStateTween.js`:** beobachtet
    `edgeZoomControlMode`/`zoomState`, animiert bei Aenderung
    `modeAB`/`autoZoomMinPx` per `createSpringTween()` (Uebergangsdauer
    `SMOOTH_TIME = 0.35s`) auf das Preset des neuen Zustands, per rAF-
    Schleife nur waehrend eine Animation tatsaechlich laeuft (stoppt
    selbststaendig, sobald beide Federn "isSettled" sind). Registriert
    ueber `initZoomStateTween()` in `TargetBankCanvas.svelte` `onMount()`
    (dort ohnehin die einzige Instanz des configStore-Subscribe/rAF-
    Rendering-Verbunds fuer den Zoom) - kein zusaetzlicher Render-Loop
    noetig, die bestehende `configStore.subscribe()`-Kette in
    `TargetBankCanvas` zeichnet bei jeder Feder-Aktualisierung automatisch
    neu.

  - **URL-Zustand:** drei neue Parameter analog zu den bestehenden
    `modeab`/`autozoom` (siehe `src/lib/urlState.js`): `altzoom`
    (`edgeZoomControlMode`), `zoomstate` (`zoomState`), `randzoom`
    (`randZoomLevel`) - ein geteilter Link reproduziert damit auch den
    gewaehlten Zoom-Zustand.

  - **Nicht Teil dieser Umsetzung** (siehe "Später" oben): physischer
    Drei-Stufen-Schalter, weiches Ein-/Ausblenden der Beschriftung. Der
    Tweener (`paramTween.js`) ist bewusst generisch gehalten, damit ein
    kuenftiges Beschriftungs-Fade denselben Baustein nutzen kann statt
    einen eigenen zu erfinden.

  - **Tests:** `tests/unit/paramTween.test.js` (reine Feder-Mathematik,
    `node:test`), `src/lib/zoomStateTween.test.js` (Treiber-Verhalten inkl.
    Retargeting/Stop-bei-Ausschalten, `vitest`/jsdom - braucht
    `requestAnimationFrame`, das `node:test` nicht bereitstellt),
    `tests/unit/url-state.test.js` (neue Parameter,
    Parse/Format/Roundtrip), `src/components/ControlPanel.test.js` (Admin-
    Checkbox, 3-Radio-UI ersetzt die 2 Regler, Feinregler-Enable/Disable).
    Manuell im Browser verifiziert (Playwright-Skript, Screenshots): alle
    3 Zustaende anwaehlbar, sichtbarer Zoom-Unterschied zwischen
    "Flächentreu"/"Gleichmäßig", Feinregler korrekt de-/aktiviert, keine
    Konsolenfehler.

## Feedback (User, nach erstem Ausprobieren) - offenes Kriterium

Die `createSpringTween()`-Loesung (kritisch gedaempfte Feder direkt auf
`modeAB`/`autoZoomMinPx`) erfuellt folgendes Kriterium **noch nicht** und
gilt bis zur Behebung als **nicht abgeschlossen**:

  - **A→B (Flächentreu → Rand sichtbar):** fühlt sich weich/gut an.
  - **B→A (Rand sichtbar → Flächentreu):** sollte sich exakt wie die
    zeitlich UMGEKEHRTE A→B-Bewegung anfühlen (wie ein rueckwaerts
    abgespieltes Video derselben Animation). Fühlt sich stattdessen
    SCHNELLER an als A→B.
  - **B→C (Rand sichtbar → Gleichmäßig):** fühlt sich zu schnell an.
  - **C→B (Gleichmäßig → Rand sichtbar):** wirkt wie eine Pause, gefolgt
    von einer ploetzlichen, zu schnellen Bewegung ("Pause dann Ruck").

  **Testkriterium (fuer die naechste Iteration):** alle 6 Uebergaenge
  zwischen den 3 Zustaenden fuehlen sich in Geschwindigkeit/Charakter
  gleichwertig an, UND jeder Rueckweg X→Y fuehlt sich wie die zeitlich
  gespiegelte Version von Y→X an (nicht nur "irgendwie weich", sondern
  hoerbar/sichtbar symmetrisch in der Bewegungskurve).

  Siehe Diskussion im Gespraechsverlauf: vermuteter Grund ist (a) ein
  kritisch gedaempfter Feder-Sprung AUS DER RUHE ist selbst bei
  gleicher Distanz NICHT zeitsymmetrisch zu seinem eigenen Rueckweg
  (beide Richtungen starten mit Geschwindigkeit 0 und demselben
  "erst leise, dann Peak, dann lang auslaufend"-Profil - keine
  Spiegelung), und (b) die Interpolation laeuft in ROHEN Config-Einheiten
  (`autoZoomMinPx` linear 0..100), waehrend die tatsaechliche visuelle
  Wirkung stark nichtlinear/saettigend ist (deshalb ist der bestehende
  manuelle Regler dafuer ja bereits LOGARITHMISCH, siehe `MINPX_LO`/
  `MINPX_HI`/`MINPX_SPAN` in `ControlPanel.svelte`) - reine Tiefpass-/
  Feder-Glaettung im rohen Werteraum kann diese Nichtlinearitaet nicht
  ausgleichen. Naechster Schritt: eigene "Interpolator"-Bausteine je
  Parameter (Wert = Formfunktion(s), s linear/gleichmaessig durchlaufen
  wie der Zeit-Regler) statt direkter Feder auf dem rohen Wert -
  siehe Diskussion, noch nicht entschieden/umgesetzt.

## Konzeptioneller Nachtrag: "Schalter-Tweening" als allgemeines Prinzip

Aus der Diskussion dieses Feedbacks ist ein **projektübergreifendes**
Entwurfsprinzip entstanden, jetzt in `CLAUDE.md` als eigener Abschnitt
"Schalter-Tweening: diskrete UI-Zustände als Punkte in einem
Embedding-Raum" festgehalten (und im README unter "Projektziel" verlinkt).
Kurzfassung fuer diesen konkreten Fall:

  - Die 3 Zoom-Zustaende werden Punkte in einem R^n (Topologie/Dimension
    experimentell waehlbar - 1D-Kette wie ein physischer
    Drei-Stufen-Schalter, ODER 2D-Simplex mit direkten Uebergaengen, ODER
    mehr) statt fest auf `modeAB`/`autoZoomMinPx` gesprungt zu werden.
  - Eine n-dimensionale Verallgemeinerung von `computeSegmentBlend()`
    bildet Position im Embedding auf die tatsaechlichen Ausgabewerte ab.
  - Der Cursor-Treiber (linear/Ease vs. Feder) bleibt ein eigener,
    austauschbarer Baustein - optional gekoppelt an `playSpeed`, damit
    sich Uebergangstempo und Wiedergabetempo fuer Besucher:innen konsistent
    anfuehlen.

  **Noch offen:** konkrete Implementierung (Embedding-Topologie UND
  Treiber-Variante sollen am fertigen Exponat ausprobiert/verglichen
  werden, keine Vorab-Festlegung). Die bisherige `createSpringTween()`-
  Loesung bleibt bis dahin production-Stand, gilt aber als vorlaeufig.

## Konkreter Umsetzungsplan (naechster Schritt, bestaetigt)

Aus der Diskussion konkretisiert - deutlich einfacher als der obige
generische Simplex-Entwurf, weil sich zwei Dinge am tatsaechlichen Code
(`computeAutoZoomTAB()`/`effective_t_AB` in `TargetBankCanvas.svelte`)
bestaetigt haben:

  - **`modeAB` muss vom Schalter-Tween GAR NICHT angefasst werden.**
    `computeAutoZoomTAB(thresholdPx, ...)` hat einen harten Zweig
    `thresholdPx <= 0 → return 0`. Bleibt `modeAB` bei seinem Default (0),
    liefert `autoZoomMinPx` alleine alle 3 Zustaende: `0` → Flaechentreu
    (`effective_t_AB = max(0,0) = 0`), `3` (heutiger Default) → Rand
    sichtbar (= heutiges Out-of-the-Box-Verhalten unveraendert), `100` →
    Gleichmaessig (`autoZoomTAB` saettigt praktisch bei 1). Das Schalter-
    Tween-Problem reduziert sich damit von 2 Dimensionen auf 1.
  - **`autoZoomMinPx` wird in zwei Groessen zerlegt** (loest das
    "Null ist auf der Log-Skala nicht sauber erreichbar"-Problem, siehe
    Feedback oben):
    - `engagement ∈ [0,1]` - linear, "ist Auto-Zoom ueberhaupt aktiv".
      Exakte 0 ist hier trivial erreichbar (linearer Skalar, kein
      Log-Grenzwert-Problem).
    - `level ∈ [0,1]` - dieselbe Log-Abbildung wie im bestehenden
      manuellen Regler (`MINPX_LO`/`MINPX_HI`/`MINPX_SPAN` in
      `ControlPanel.svelte`), extrahiert in eine gemeinsame Funktion statt
      zweimal gebaut - "wie aggressiv, wenn aktiv" (3px ↔ 100px).
    - Ausgabe: `autoZoomMinPx = engagement · shapeFn(level)`.
  - **Preset-Zuordnung:** Flaechentreu = `{engagement: 0}` (`level`
    bleibt unveraendert stehen, ist irrelevant); Rand sichtbar =
    `{engagement: 1, level: level(3px)}`; Gleichmaessig =
    `{engagement: 1, level: level(100px)}`.
  - **Zeitsymmetrie faellt dadurch groesstenteils geschenkt ab:**
    Flaechentreu↔Rand bewegt NUR `engagement` (ein Skalar, trivial
    spiegelsymmetrisch), Rand↔Gleichmaessig bewegt NUR `level` (ebenfalls
    ein Skalar, jetzt in wahrnehmungslinearisiertem Raum - behebt B→C/C→B
    aus dem Feedback oben direkt). Nur ein direkter Sprung
    Flaechentreu↔Gleichmaessig (Radio-Klick ueberspringt "Rand sichtbar")
    bewegt beide gemeinsam - bleibt aber symmetrisch, weil beide mit
    demselben Profil/derselben Dauer laufen.
  - **Treiber:** einfache Variante zuerst (linearer/Ease-Ramp, bei
    Retargeting neu bei `s=0` gestartet, kleiner Steigungsknick beim
    schnellen Umklicken akzeptiert - User-Entscheidung: "einfachere Loesung
    zuerst, ohne eine aufwaendigere spaeter zu blockieren"). Hinter einer
    schlanken, austauschbaren Schnittstelle, damit eine
    geschwindigkeitsstetige Neuplanung (Motion-Replanning wie in
    Robotik/CNC) spaeter nachgeruestet werden kann, ohne Embedding/Blend
    anzufassen.

  **Offener Folgepunkt - GEKLAERT:** statt eines Schalters ("Rand-Zoom
  einschalten") ist `engagement` bewusst EBENFALLS ein stufenloser Regler
  geworden (keine Checkbox) - Begruendung (User): vor einer spaeteren
  Automatisierung (Radio-Buttons/Tween) soll sich die wahrgenommene
  Gleichmaessigkeit JEDES einzelnen Reglers manuell durchziehen und
  beurteilen lassen; eine Checkbox liesse das gar nicht pruefen. `modeAB`
  ist als Store-/Render-Feld VOLLSTAENDIG entfallen (nicht nur
  "unangetastet gelassen" wie urspruenglich hier geplant) - siehe
  "Status: Grundlegender Umbau umgesetzt" unten.

## Status: Grundlegender Umbau umgesetzt (engagement/level)

**Reihenfolge-Entscheidung (User):** erst den zugrundeliegenden
Steuerungsraum umbauen, DANN darauf eine diskrete Zustands-Umschaltung
aufsetzen - nicht umgekehrt (nicht "optional hinterher"). Umgesetzt in
zwei Schritten:

1. **Beerdigt** (Commit "Feder-basierte Zoom-Zustands-Steuerung
   beerdigt"): `src/lib/paramTween.js`, `src/lib/zoomStateTween.js`
   (+Tests), die Store-Felder `edgeZoomControlMode`/`zoomState`/
   `randZoomLevel`, die zugehoerige Radio-/Feinregler-UI, die
   URL-Parameter `altzoom`/`zoomstate`/`randzoom`. Alles bleibt in der
   Git-Historie (`bb14495`..`f69faa9`) auffindbar, nur nicht mehr Teil
   des aktuellen Codes.
2. **Neu aufgebaut** (Commit "Grundlegender Umbau: zoomEngagement/
   zoomLevel statt modeAB+autoZoomMinPx"):
   - `configStore.modeAB`/`configStore.autoZoomMinPx` ersetzt durch
     `configStore.zoomEngagement` (linear 0..1, "ist Auto-Zoom aktiv")
     + `configStore.zoomLevel` (log-skaliert 0..1, "wie aggressiv, wenn
     aktiv"). Neues Modul `src/lib/autoZoomLevel.js`
     (`levelToPx()`/`pxToLevel()`) als einzige Quelle dieser Abbildung.
   - **Beide bewusst als stufenlose Regler**, KEINE Checkbox fuer
     `engagement` (User-Entscheidung, siehe oben) - Grundeinstellungen
     zeigt "Auto-Zoom: Aktivierung" + "Auto-Zoom: Stärke".
   - `TargetBankCanvas.svelte`: die resultierende Basisverzerrung
     (frueher `modeAB`) ist KEIN eigenstaendiges Store-Feld mehr,
     sondern wird JEDEN Frame aus `zoomEngagement` und
     `computeAutoZoomTAB(levelToPx(zoomLevel), scale, targetExp)`
     berechnet (Details/Korrektur siehe Bug-Eintrag unten) - kein
     `max()` mit einem separat gesetzten manuellen Wert mehr, damit auch
     keine "Auto-Zoom uebersteuert den Regler"-Anzeige mehr noetig
     (strukturell unmoeglich geworden, nicht nur ausgeblendet -
     `autoZoomMarker`/`autoZoomNote` entfernt).
   - `urlState.js`: `modeab`/`autozoom` ersetzt durch
     `zoomengage`/`zoomlevel`.
   - Verifiziert: alle Tests gruen (dieselben vorbestehenden,
     unabhaengigen Fails wie zu Sessionbeginn), manuell im Browser
     (Playwright/Screenshots) - beide Regler laufen 0..100%/
     0.001..100px sauber durch, sichtbarer Zoom-Effekt, keine
     Konsolenfehler.

**Naechster Schritt (jetzt erst moeglich):** die diskrete
3-Zustands-Umschaltung (Flächentreu/Rand sichtbar/Gleichmäßig) obendrauf
bauen - jetzt auf dem sauberen 2D-`(engagement, level)`-Raum statt auf
dem alten `modeAB`/`autoZoomMinPx`-Paar. Dafuer die Bausteine aus
`CLAUDE.md` Abschnitt "Schalter-Tweening" anwenden (Embedding/Blend/
Treiber) - Embedding-Topologie und Treiber-Variante weiterhin bewusst
NICHT vorentschieden, siehe dort.

## Bug (gefunden beim ersten Ausprobieren des Umbaus): `engagement` viel zu sensibel (behoben)

**Symptom (User):** der "Auto-Zoom: Aktivierung"-Regler wirkt viel zu
schnell - schon 1% Aktivierung macht einen gewaltigen Unterschied.

**Root Cause (nachgerechnet mit den echten Formeln aus
`computeAutoZoomTAB`):** die urspruengliche Umsetzung multiplizierte
`engagement` auf den ROHEN Pixel-Schwellwert (`effectivePx = engagement
* levelToPx(zoomLevel)`). Die natuerliche (unverzerrte) Breite der
gerade relevanten Ziffernstelle (`widthAt(0)` in `computeAutoZoomTAB`)
schrumpft waehrend der Wiedergabe aber ueber viele Groessenordnungen:

| targetExp | widthAt(0) |
|---|---|
| 4  | 13.5 px |
| 8  | 0.00135 px |
| 12 | 1.35e-7 px |
| 16 | 1.35e-11 px |

Sobald diese natuerliche Breite (je nach Animationszeitpunkt) deutlich
unter dem effektiven Schwellwert liegt, reicht JEDE noch so kleine
Aktivierung (0.01%) schon aus, um kraeftig zu zoomen - die "harmlose"
Uebergangszone verschiebt sich also staendig mit der Tiefe/Zeit. Eine
feste Reglerkurve (z.B. eine `(1-e^-x)`-Formkurve auf dem Regler selbst,
urspruenglicher Vorschlag) koennte das NICHT kompensieren, weil sich das
Ziel dynamisch waehrend der Wiedergabe verschiebt.

**Fix:** `engagement` multipliziert stattdessen das ERGEBNIS
(`autoZoomTAB`, bereits fest auf `[0,1]` begrenzt), nicht den rohen
Schwellwert davor:

```js
let autoZoomTAB = computeAutoZoomTAB(levelToPx(zoomLevel), scale, autoZoomTargetExp);
let effective_t_AB = zoomEngagement * autoZoomTAB;
```

Damit ist `engagement` ein robuster linearer Blend zwischen "kein Zoom"
und "voll berechneter Auto-Zoom fuer das aktuelle `level`" -
unabhaengig davon, wie tief die Wiedergabe gerade ist.

**Verifikation:** manuell im Browser (Playwright/Screenshots, tief in
die Wiedergabe gesprungen, `targetExp` entsprechend hoch) - Reihe
0%/1%/5%/10%/20%/30%/40%/50%/100% zeigt jetzt einen gleichmaessig
fortschreitenden Uebergang statt eines Sprungs bei 1%. Tests weiterhin
gruen (dieselben vorbestehenden Fails wie zu Sessionbeginn).

**Offen:** ob 50% Engagement auch tatsaechlich "halb so viel Zoom"
FUEHLT (statt nur "halb so viel `t_AB`"), ist noch nicht geprueft -
`t_AB` geht selbst exponentiell in die Darstellung ein
(`b_eff = BASE^(1-t_AB)`). Falls sich das beim weiteren Ausprobieren
als unrund erweist, waere genau HIER (eine zusaetzliche, auf `t_AB`
angewandte Formkurve) der richtige Ort fuer eine Idee wie den
urspruenglich vorgeschlagenen `(1-e^-x)`-Ansatz - nicht auf dem rohen
Schwellwert wie im ersten Versuch.

## Bug (User-Feedback nach dem engagement-Fix): toter Regelbereich bei "Auto-Zoom: Stärke" + unzureichende Gleichmässigkeit

**Feedback:** Der engagement-Fix fühlt sich gut an. Zwei Folgepunkte:

1. **`zoomLevel` muss nicht mehr unter 1px regelbar sein** - das
   "ist ueberhaupt aktiv"-Bedürfnis deckt jetzt `zoomEngagement` ab,
   `zoomLevel` deckt nur noch "wie aggressiv, wenn aktiv" ab.
2. **Toter Regelbereich (schon vor dieser Session vorhanden):** ein Teil
   des "Auto-Zoom: Stärke"-Reglers bewirkt gar nichts. Besser: der Regler
   soll zwischen Minimum (Position 0 → 1px) und Maximum (Position 1 →
   maximal erreichbare Breite) laufen, weiterhin monoton und mindestens
   C1-stetig über die gesamte Wiedergabe.

**Nachtrag (User, zweites Problem, selbe Ursache):** "abstrakt = gleich
große Stücke" (der Gleichmäßig-Zustand) ist momentan nicht hinreichend
implementiert - ein fester Deckel von 100px reicht nicht, um bei
KLEINER Schalenanzahl (wenig Tiefe) ebenfalls gleich große Quadrate zu
erzwingen.

**Root Cause (nachgerechnet):** `widthAt(1)` (die Breite bei vollem Zoom,
`t_AB=1`) ist die tatsaechliche maximal erreichbare Breite - oberhalb
davon bewirkt eine weitere Erhoehung des Schwellwerts nichts mehr (das
IST der tote Bereich). Sie haengt kaum von `targetExp` ab (< 0.1%
Abweichung ueber den ganzen Bereich, da `b_eff` bei `t_AB=1` immer ~1
ist - daher AUCH unabhaengig von der Animationszeit, nur von
Basis/Tiefe/Fenstergroesse), aber STARK von der Schalenanzahl
(`TOTAL_STEPS`) - Beispielrechnung:

| TOTAL_STEPS (Schalenanzahl) | widthAt(1) |
|---|---|
| 3  | ~37.500 px |
| 5  | ~25.000 px |
| 17 | ~8.333 px |

Der bisherige feste Deckel (100px) liegt bei KLEINER Schalenanzahl weit
UNTER diesem Wert (toter Bereich oberhalb ~100px bewirkt nichts, Regler
erreicht t_AB=1 nie exakt -> keine echte Gleichmaessigkeit) und bei
GROSSER Schalenanzahl witzlos WEIT DARUEBER (nichts oberhalb des
tatsaechlichen Maximums aendert noch etwas). **Beide gemeldeten Probleme
haben dieselbe Ursache** und werden durch denselben Fix behoben.

**Fix (geplant):** `levelToPx()`/`pxToLevel()` in `autoZoomLevel.js`
bekommen ein dynamisches `maxPx` (statt eines festen `AUTO_ZOOM_LEVEL_HI_PX`)
- berechnet als `widthAt(1, scale, 0)` (targetExp irrelevant, siehe oben)
in `TargetBankCanvas.svelte`, unveraendert waehrend der Wiedergabe (haengt
nur von Konfiguration/Fenstergroesse ab, nicht von der Zeit - erfuellt
damit automatisch "C1-stetig ueber die ganze Animation", weil es sich
waehrend einer Wiedergabe schlicht nicht aendert). Neue feste Untergrenze
`AUTO_ZOOM_LEVEL_MIN_PX = 1`. Der berechnete Maximalwert wird ueber einen
neuen Store (`autoZoomMaxPxStore` in `autoZoomLevel.js`) an
`ControlPanel.svelte` durchgereicht (nur bei tatsaechlicher Aenderung
geschrieben, kein Store-Churn pro Frame).

**Status: umgesetzt.** `src/lib/autoZoomLevel.js`:
`levelToPx()`/`pxToLevel()` nehmen jetzt `maxPx` entgegen (Default
`FALLBACK_MAX_PX=100` fuer den Fall vor dem ersten Render), feste
Untergrenze `AUTO_ZOOM_LEVEL_MIN_PX=1`, neuer Store
`autoZoomMaxPxStore`. `TargetBankCanvas.svelte`: `widthAt()` aus
`computeAutoZoomTAB()` herausgeloest, neue Funktion
`maxAutoZoomWidthPx(scale) = widthAt(1, scale, 0)`, pro Frame berechnet
(billig) und nur bei tatsaechlicher Aenderung an den Store gemeldet.
`ControlPanel.svelte` liest den Store fuer das px-Readout.
`configStore`-Default fuer `zoomLevel` ist jetzt ein neutraler
Reglerwert (0.5) statt eines aus einem festen px-Wert abgeleiteten
Defaults.

**Verifiziert (Playwright/Screenshots):**
- **Kein toter Bereich mehr:** Reglerposition 0..1 in Schritten
  (0/0.2/0.4/0.6/0.8/0.9/0.95/1) liefert bei Tiefe=16 die Reihe
  1.000/1.637/2.679/4.384/7.175/9.179/10.382/11.743 px - durchgehend
  wachsend, keine Plateaus.
- **Echte Gleichmaessigkeit bei kleiner Schalenanzahl:** bei Tiefe=3
  liefert Level=1 jetzt 60.842px (statt der alten 100px) - das
  Ziel-Quadrat zeigt bei Aktivierung=100%/Staerke=100% sichtbar
  GLEICH GROSSE Zellen (Screenshot geprueft), nicht mehr die
  unveraendert proportionalen Bloecke wie beim alten festen Deckel.
- Tests weiterhin gruen (dieselben vorbestehenden, unabhaengigen Fails
  wie zu Sessionbeginn).

## Dritter Regler: "Abstraktion" (manueller Basis-b→1-Override)

**Idee (User):** mit `engagement`/`level` sauber aufgeraeumt, fehlt noch
ein DRITTER, von Auto-Zoom unabhaengiger Regler fuer "Abstraktion
einschalten" (Basis Richtung 1 fuer ALLE Ziffernstellen) - das ist
inhaltlich der urspruengliche "Modus B" aus dem README ("Regler fuer
'hypothetische Basis b→1' - verzerrt NUR das Ziel, macht Stellenwert-
Struktur sichtbar"), nur jetzt als eigener, sauber getrennter Regler statt
als Store-Feld, das mit Auto-Zoom vermischt war.

**Entscheidung:** `abstraction` ist EBENFALLS ein stufenloser linearer
Regler (keine Formkurve, analog zu `engagement` - erst empirisch pruefen,
ob eine Kurve noetig ist, bevor eine gebaut wird).

**Korrektur (User, nach erstem Ausprobieren): `max()` war die falsche
Kombination.** Ein `max()`-Floor wird wirkungslos, sobald der Auto-Zoom-
Anteil bereits ueber dem Reglerwert liegt - genau das passiert spaet in
der Wiedergabe (Auto-Zoom zoomt dort ohnehin schon stark), sodass der
Regler dann nur noch auf der letzten Strecke von [0,1] ueberhaupt etwas
bewirkte. Das ist exakt dasselbe "eine Steuerung uebersteuert die andere
ueber einen Teil ihres Bereichs"-Problem, das schon die alte
`modeAB`/`autoZoomMinPx`-Kombination hatte ("Auto-Zoom aktiv -
uebersteuert den Regler nach oben").

**Fix:** lineare Mischung zwischen dem Auto-Zoom-Ergebnis (bei
`abstraction=0`) und 1 (bei `abstraction=1`) statt `max()` - dadurch
bewirkt der Regler IMMER eine proportionale Aenderung, unabhaengig vom
aktuellen Auto-Zoom-Stand:

```js
let autoZoomTAB = computeAutoZoomTAB(levelToPx(zoomLevel, maxWidthPx), scale, autoZoomTargetExp);
let autoZoomComponent = zoomEngagement * autoZoomTAB;
let effective_t_AB = autoZoomComponent + abstraction * (1 - autoZoomComponent);
```

Randwerte bleiben erhalten: `abstraction=0` liefert exakt das
unveraenderte Auto-Zoom-Ergebnis, `abstraction=1` liefert exakt 1 (volle
Gleichmaessigkeit), unabhaengig vom Auto-Zoom-Zustand.

**Umgesetzt:** `configStore.abstraction` (Default 0), URL-Parameter
`abstraction`, Regler "Abstraktion" in `ControlPanel.svelte`
(Grundeinstellungen, linear 0..1, live). Tests gruen (dieselben
vorbestehenden Fails).

## Status: diskrete 3-Zustands-Umschaltung umgesetzt (Schalter-Tweening)

Jetzt erst moeglich, da der Steuerungsraum (engagement/level/abstraction)
zuerst sauber umgebaut wurde (User-Vorgabe: "erst der grundlegende Umbau
und nicht optional hinterher"). Umsetzung der Bausteine aus `CLAUDE.md`
Abschnitt "Schalter-Tweening":

  - **Embedding:** NUR `zoomEngagement` + `abstraction` (2D) - `zoomLevel`
    bleibt bewusst AUSSERHALB, in KEINEM der 3 Presets festgelegt, bleibt
    also beim Zustandswechsel unveraendert stehen (wie ein Lautstaerke-
    regler, der beim Stummschalten seinen Wert behaelt) und ist
    unabhaengig vom aktiven Zustand jederzeit als eigener Regler nutzbar:
    ```js
    flaechentreu:  { engagement: 0, abstraction: 0 }
    rand:          { engagement: 1, abstraction: 0 }
    gleichmaessig: { abstraction: 1 } // engagement bewusst NICHT gesetzt
    ```
    "gleichmaessig" laesst `engagement` unveraendert, weil bei
    `abstraction=1` die lineare Mischung (siehe oben) ohnehin exakt 1
    liefert, unabhaengig von `engagement` - macht dadurch jeden der 3
    paarweisen Uebergaenge (Flaechentreu↔Rand, Rand↔Gleichmaessig) zu einer
    EIN-SKALAR-Bewegung, was sie automatisch zeitsymmetrisch macht (nur
    ein direkter Sprung Flaechentreu↔Gleichmaessig, der "Rand" ueberspringt,
    bewegt beide Groessen gemeinsam).
  - **Blend:** trivialer 2-Punkt-Blend (immer FROM=aktueller Live-Wert TO=
    Preset-Ziel) mit gemeinsamem Fortschritt `s` - kein Simplex noetig, da
    nie zwischen mehr als 2 Punkten gleichzeitig geblendet wird.
  - **Treiber:** einfacher Ease-Ramp (`smoothstep(elapsed/DURATION)`,
    `DURATION=0.35s`), KEINE Feder (User-Entscheidung "einfachere Loesung
    zuerst, ohne eine aufwaendigere spaeter zu blockieren") - bei
    Retargeting waehrend eines laufenden Uebergangs wird die Rampe bei
    `s=0` neu gestartet (kleiner Steigungsknick moeglich, akzeptierter
    Trade-off), der WERT selbst bleibt aber C0-stetig, weil "von" immer
    der aktuelle Live-Wert aus `configStore` ist.

**Neues Modul `src/lib/zoomStateTween.js`** (frischer, einfacher Code -
NICHT die beerdigte Feder-Implementierung wiederbelebt). Registriert ueber
`initZoomStateTween()` in `TargetBankCanvas.svelte` `onMount()`.

**ControlPanel.svelte:** Admin-Checkbox "Alternative Rand-Zoom-Steuerung"
(`edgeZoomControlMode`). Grundeinstellungen: bei aktivem Alt-Modus
ersetzen 3 Radio-Buttons (Flächentreu/Rand sichtbar/Gleichmäßig) die
Regler "Aktivierung" und "Abstraktion" - "Auto-Zoom: Stärke" bleibt
UNABHAENGIG vom Zustand immer sichtbar (ist ja nicht Teil des Embeddings).

**Verifiziert:** 5 Tests in `src/lib/zoomStateTween.test.js` (vitest/jsdom,
braucht `requestAnimationFrame`), 2 neue Tests in `ControlPanel.test.js`
(Admin-Checkbox, Radio-UI ersetzt Regler), neue URL-Parameter-Tests.
Manuell im Browser (Playwright/Screenshots): alle 3 Zustaende anwaehlbar,
sichtbarer Zoom-Unterschied, "Gleichmäßig" erzeugt tatsaechlich ein
einzelnes gleichmaessiges Element, keine Konsolenfehler. Tests insgesamt
gruen (dieselben vorbestehenden, unabhaengigen Fails wie zu
Sessionbeginn).

**~~Noch offen~~ GEKLAERT (User-Feedback nach erstem Ausprobieren):** der
einfache Ease-Ramp erzeugte beim schnellen Umschalten sichtbare "Blitze"
- siehe naechster Abschnitt fuer den Fix.

## Fix: Ease-Ramp durch geschwindigkeitsstetigen Integrator ersetzt ("Blitze" behoben)

**Symptom (User):** beim schnellen Hin- und Herschalten zwischen den 3
Zustaenden traten sichtbare "Blitze" auf.

**Root Cause:** der Ease-Ramp (`smoothstep(elapsed/DURATION)`) hat bei
JEDEM Retargeting Geschwindigkeit exakt 0 (Start einer neuen Rampe bei
`s=0`). Traf ein Retargeting eine Bewegung, die gerade eine REALE
Geschwindigkeit ≠0 hatte, entstand ein Geschwindigkeits-Knick. Weil
`engagement`/`abstraction` EXPONENTIELL in die Darstellung eingehen
(`BASE^(1-t_AB)`), zeigte sich dieser Knick als sichtbarer Sprung, nicht
nur als leichte Unrundheit - genau das war urspruenglich vereinbart
("Beschleunigung und Geschwindigkeit... damit immer hin und her
geschaltet werden kann"), aber bewusst als "aufwaendigere Variante spaeter"
zurueckgestellt worden.

**Fix:** `src/lib/zoomStateTween.js` nutzt jetzt einen kritisch gedaempften
Geschwindigkeits-Integrator (Position UND Geschwindigkeit als echter
Zustand - "Game Programming Gems 4.8"/Unitys `Mathf.SmoothDamp`, exportiert
als `springStep()`). Position/Geschwindigkeit laufen bei einem Retargeting
WAEHREND einer laufenden Bewegung unveraendert weiter (nur die Ziele
aendern sich) - dadurch ist JEDES Retargeting, zu JEDEM Zeitpunkt,
garantiert geschwindigkeitsstetig. Das ist konzeptionell dieselbe
Feder-Mathematik, die frueher fuer `paramTween.js` beerdigt wurde - dort
war sie auf ROHE, wahrnehmungs-nichtlineare Pixel-Schwellwerte angewandt
(Zeitsymmetrie-Bug), hier auf bereits saubere, lineare `[0,1]`-Groessen
(`engagement`/`abstraction`) - der damalige Bruch-Grund trifft hier viel
schwaecher zu, waehrend das eigentliche Problem (Blitze bei Retargeting)
strukturell geloest wird.

**Kalibrierung:** `smoothTime` ist NICHT direkt der Regler-Wert
("Zustands-Übergang: Dauer") - eine kritisch gedaempfte Feder braucht
empirisch (per Simulation ermittelt) ca. das 3.65-fache von `smoothTime`,
um auf ~1% Restfehler zu kommen (`SETTLE_TIME_FACTOR`). Ohne diese
Umrechnung waere der Regler grob falsch kalibriert gewesen (ein voller
0->1-Uebergang haette ca. 3.65x laenger gedauert als eingestellt).
`maxSpeed` ist bewusst grosszuegig (20, nicht an `duration` gekoppelt) -
dient nur als Sicherheitsnetz gegen extreme Geschwindigkeiten bei sehr
kurzen Dauern, bindet im Normalfall nicht.

**Verifiziert:**
- `tests/unit/zoomStateTween-spring.test.js` (reine `springStep()`-Logik,
  `node:test`): monotone Annaeherung ohne Ueberschwingen, Geschwindigkeit
  bleibt bei Retargeting erhalten (Regressionstest gegen die "Blitze"),
  maxSpeed-Deckel wird eingehalten, Ankunft aus der Ruhe.
- `src/lib/zoomStateTween.test.js`: neuer Regressionstest "schnelles
  Umschalten... bleibt wertstetig" + Duration-Kalibrierungstest.
- Manuell im Browser (Playwright, Pixel-Messung der Ziel-Quadrat-Breite):
  ein einzelner Uebergang (Dauer=1s) laeuft glatt ueber ca. 1.5-2s
  (Kalibrierung reicht als Naeherung); schnelles Umschalten
  (Gleichmaessig->Rand->Flaechentreu, je 150ms Abstand) zeigt eine
  durchgehend monotone Bewegung ohne Sprung/Richtungswechsel - keine
  Blitze mehr, keine Konsolenfehler.

## Status: TODO.md "Steuerung" umgesetzt (Default an + Tempo erhoeht)

Zwei passende, bereits vorgemerkte Punkte aus `TODO.md` direkt umgesetzt:

- **`edgeZoomControlMode` jetzt `true` als Default** - die 3-Zustaende-
  Radio-UI ist das, was Besucher:innen sofort sehen. Der klassische
  Regler-Modus (Aktivierung/Staerke/Abstraktion) bleibt ueber die
  Admin-Checkbox weiterhin voll erreichbar, nur nicht mehr die
  Voreinstellung.
- **`zoomStateTransitionDuration`-Default von 1,0s auf 0,2s reduziert**
  ("Beschleunigung wesentlich erhoehen... gefuehlt instantan") - macht
  sofort ersichtlich, dass ein neuer Zustand angewaehlt wurde, bleibt
  aber dank des geschwindigkeitsstetigen Treibers (siehe oben) weiterhin
  ohne Blitze, auch bei schnellem Umschalten.

Betroffene Tests (die implizit den alten Default
`edgeZoomControlMode=false` voraussetzten) in `ControlPanel.test.js`
angepasst - setzen jetzt explizit `edgeZoomControlMode: false`, bevor sie
den klassischen Regler-Modus pruefen, statt sich auf den globalen Default
zu verlassen. Verifiziert im Browser: Standardansicht zeigt sofort die 3
Radios (keine alten Regler mehr sichtbar), ein Uebergang
(Flaechentreu→Gleichmaessig) settled jetzt in ca. 300ms statt 1-2s, keine
Konsolenfehler. Tests gruen (dieselben vorbestehenden Fails).

**Korrektur (User, direkt danach):** Missverstaendnis bei der 0,2s-Aenderung
oben - "Beschleunigung wesentlich erhoehen" war NICHT als "die gesamte
Uebergangsdauer verkuerzen" gemeint. Zitat: *"Die Übergänge können ruhig
lange dauern. Die Bewegung im Parameterraum soll aber abrupter stoppen,
wenn der Zielwert erreicht ist. Das meinte ich mit Beschleunigung. Die
Geschwindigkeit kann gleich bleiben."* Der Default wurde daraufhin auf
`1.0` zurueckgesetzt - "Beschleunigung" bezieht sich auf den STOPP am Ziel,
nicht auf ein pauschal schnelleres Tempo. Siehe naechster Abschnitt fuer
die daraus resultierenden zwei weiteren Anlaeufe (Spring+Snap, dann
Trapezprofil).

## Fix-Versuch 2 (verworfen): Feder + harter Snap kurz vor dem Ziel

Um einen abrupten Stopp zu erzeugen, ohne die kritisch gedaempfte Feder
(siehe oben) komplett zu ersetzen, wurde ein Snap ergaenzt: sobald
Position/Ziel-Abstand unter einen Schwellwert (`SNAP_EPS`) fiel, wurde
Position hart auf den Zielwert und Geschwindigkeit hart auf 0 gesetzt -
gedacht als Abkuerzung des langen asymptotischen Ausklingens einer Feder
(die formal nie EXAKT ankommt).

**Symptom (User):** *"Das ging nach Hinten los. Jetzt springt die
Animation deutlich."* Der Snap selbst war wieder ein Sprung in Position
UND Geschwindigkeit - exakt dieselbe Fehlerklasse, die der
geschwindigkeitsstetige Treiber ueberhaupt erst beheben sollte (siehe
CLAUDE.md "Automatisierte Parameteränderungen: stetige Ableitung"), nur an
einer anderen Stelle (Snap-Punkt statt Retargeting-Punkt) wieder
eingefuehrt.

**Lehre:** Ein Verfahren, das "abrupter Stopp" durch einen bedingten
Sprung nahe des Ziels erzwingt, verletzt die C¹-Stetigkeit strukturell -
unabhaengig davon, wie klein der Schwellwert ist. "Abrupt" muss aus der
Bewegungsgleichung SELBST folgen (begrenzte Verzoegerung, die in endlicher
Zeit exakt auf Geschwindigkeit 0 fuehrt), nicht aus einem nachtraeglichen
Einrasten.

## Fix (final): Trapez-Geschwindigkeitsprofil statt Feder (`trapStep()`)

**Anforderung (User, praezisiert):** *"Bitte so realisieren, wie
gewünscht: quasie mechanische Bewegung im Parameterraum, mit
Geschwindigkeit und Beschleunigung."* - ein echtes Doppel-Integrator-Modell
(Position, Geschwindigkeit UND Beschleunigung als Zustand), keine
Feder-Approximation mit nachtraeglichem Snap.

**Loesung:** `trapStep(position, velocity, target, maxSpeed, maxAccel, dt)`
in `src/lib/zoomStateTween.js` ersetzt `springStep()` + `SNAP_EPS`
vollstaendig. Klassische Bang-Bang-Regelung eines Doppel-Integrators:
beschleunigt Richtung Ziel bis `maxSpeed` (danach cruisen), bremst mit
`maxAccel` ab, sobald der verbleibende Weg die Bremsweg-Formel
`v²/(2·maxAccel)` unterschreitet oder die Bewegung nicht mehr Richtung
Ziel zeigt. Dadurch:

- Kommt die Bewegung in ENDLICHER Zeit EXAKT mit Geschwindigkeit 0 am Ziel
  an (kein asymptotisches Ausklingen, kein Snap noetig) - kein Wert- oder
  Geschwindigkeitssprung an irgendeiner Stelle.
- Bleibt bei Retargeting MITTEN in der Bewegung durchgehend stetig: die
  Brems-/Beschleunigungs-ENTSCHEIDUNG wird neu getroffen, Position und
  Geschwindigkeit selbst laufen unveraendert weiter - das System bremst
  ab, kehrt ggf. um und beschleunigt Richtung neues Ziel, wie ein reales
  mechanisches System.
- Kurze Distanzen (z.B. Retargeting kurz vor dem alten Ziel) bilden
  automatisch ein Dreiecksprofil (nie `maxSpeed` erreicht, direkt von
  Beschleunigung in Verzoegerung) - folgt allein aus der Bremsweg-Regel,
  keine Sonderbehandlung noetig.

**Kalibrierung:** fuer eine volle 0→1-Bewegung (der groesstmoegliche Sprung
im Embedding) soll die Gesamtzeit ungefaehr `zoomStateTransitionDuration`
Sekunden betragen, mit Beschleunigungs-/Verzoegerungsphase von je 1/4 der
Dauer (`ACCEL_PHASE_FRACTION = 0.25`), Rest cruist bei `maxSpeed`.
Aufgeloest: `maxSpeed = 1 / (0.75 · duration)`, `maxAccel = maxSpeed /
(0.25 · duration)`.

**Verifiziert:**
- `tests/unit/zoomStateTween-trap.test.js` (reine `trapStep()`-Logik,
  `node:test`, ersetzt die fruehere `zoomStateTween-spring.test.js`):
  monotone Annaeherung ohne Ueberschwingen, EXAKTE Ankunft mit
  Geschwindigkeit 0 in endlicher Zeit, maxSpeed-Deckel, Geschwindigkeits-
  Stetigkeit bei Retargeting (Aenderung pro Schritt hoechstens
  `maxAccel·dt`), exakte Ankunft am NEUEN Ziel nach Richtungswechsel,
  automatisches Dreiecksprofil bei kurzer Distanz.
- `src/lib/zoomStateTween.test.js`: alle 8 Integrationstests weiterhin
  gruen (inkl. "kommt exakt am Zielwert an", jetzt durch die Trapez-
  Mechanik statt durch einen Snap erfuellt).
- Manuell im Browser (Playwright, `?debug=1` + `window.__debugSnapshot()`
  fuer `configStore`-Werte in Echtzeit statt Pixel-Messung): ein
  Uebergang (Dauer=1,5s) zeigt eine glatte Beschleunigungs-/Cruise-/
  Brems-Kurve und haelt exakt bei 1.0 an, ohne weiter zu "kriechen".
  Retargeting mitten in der Bewegung (Flaechentreu→Gleichmaessig, nach
  400ms auf Rand umgeschaltet) zeigt eine durchgehend stetige Kurve ohne
  Sprung (max. Aenderung pro ~30ms-Sample: 0,028 fuer engagement, 0,030
  fuer abstraction - konsistent mit `maxAccel·dt`, kein Ausreisser) - die
  Bewegung bremst sichtbar ab, kehrt um und laeuft glatt zum neuen Ziel,
  keine Konsolenfehler.
- `pnpm test`: 194/202 gruen (dieselben 7 vorbestehenden, unabhaengigen
  Fails wie am Session-Start), `pnpm check`: 0 Fehler (nur vorbestehende
  Warnings).
