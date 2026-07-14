# √2-Flächenmodell-Exponat

## 1. Projektziel

Interaktive Visualisierung von √2 als Beispiel einer irrationalen Zahl, für Science-Center/Schul-Kontext. Kernidee: √2 wird ziffernweise (digit-by-digit) über ein geometrisches Flächenmodell konstruiert (Montessori-Stil: "Papier schneiden und neu zusammenlegen"). Perspektivisch als Exponat mit QR-Code-Fernsteuerung und Mehrbildschirm-Betrieb gedacht (Ziel/Rest/Steuerung auf getrennten Displays) - das ist Zukunftsmusik, noch nicht begonnen.

## 2. Dateien und ihr Zweck

| Datei | Zweck | Zustand |
|---|---|---|
| `sqrt2.html` | **Haupttool.** Volle Visualisierung: Zielquadrat (wächst ziffernweise Richtung √2) + Bank/Rest (Restflächen-Reservoir) + Steuerung (Basis, Tiefe, Modus B/C, Zoom-Schwellwert). | Funktionsfähig, nutzt jetzt `bank-core.js` (siehe Abschnitt 5) - **Kompaktierung fehlt hier noch** (nur im Test-Tool) |
| `selection_strategy_prototype.html` | **Algorithmus-Spiel-Tool.** Isolierter Prototyp nur für die Bank - zeigt Stücke an ihren echten, unveränderten Positionen, Tick-Zeitachse (1 Tick = 1 Entnahme), zum Testen von Auswahl-/Schneide-Strategien. | Funktionsfähig, im Browser getestet |
| `bank-core.js` | **Gemeinsame Bibliothek**, von beiden Tools per ES-Modul-Import eingebunden (siehe `vite.config.js`). Enthält den Bank-Algorithmus + Kompaktierung + bijektive Tick↔Zeit-Abbildung. | Fertig, in Node getestet (siehe Abschnitt 6) und ins Haupttool integriert |

## 3. Grundkonzept der Konstruktion (falls das in VS Code neu aufgesetzt wird)

- √2 wird über den klassischen "digit-by-digit"-Algorithmus berechnet (P, R = 2-P² Iteration), aber **exakt mit BigInt-Integer-Arithmetik** (nicht Float!) - sonst Präzisionsverlust ab Tiefe ~8-9 durch Auslöschung (`catastrophic cancellation`, da P² sehr nah an 2 liegt).
- Geometrisch: ein Einheitsquadrat wird rekursiv in `BASE` Streifen geschnitten (optional abwechselnd vertikal/horizontal, je nach Parität von `k`), die Ziffern bestimmen, wie viele Streifen einer Größe für die aktuelle Ziffer gebraucht werden.
- Zwei Bereiche: **Ziel** (das wachsende √2-Quadrat, baut sich aus den Schalen/Gnomonen auf) und **Bank/Rest** (übrig gebliebene, noch nicht verbrauchte Flächenstücke).
- **Modus B**: Regler für "hypothetische Basis b→1" - verzerrt nur das Ziel (nicht die Bank), macht die Stellenwert-Struktur sichtbar, indem alle Ziffern-Ebenen visuell gleich groß werden.
- Der Rand um das Ziel-Quadrat entspricht IMMER exakt der Größe der "nächsten Ziffer-Stelle" (Tiefe+1), berechnet mit derselben `b_eff`-Formel wie jede andere Stelle - dadurch automatisch "quasi-logarithmisch" sichtbar bei Modus B, aber verschwindend klein bei realer Basis (mathematisch korrekt).

## 4. Der validierte Bank-Algorithmus (das Ergebnis langen Testens)

Nach vielen Experimenten (siehe Abschnitt 7 für die verworfenen) hat sich diese Kombination als beste erwiesen (~75-86% Füllgrad, keine Kreuzungen):

1. **Auswahl-Strategie "isolation"**: Bei der Entnahme wird das Stück mit den **wenigsten direkt berührenden Nachbarn** zuerst verbraucht (aktiv Einzelgänger abbauen).
2. **Schneide-Strategie "centroid_far" (Schwerpunkt entfernt)**: Beim Zerschneiden wird der Kandidat gewählt, dessen **nächster Rand** (nicht Mittelpunkt!) am **weitesten** vom Schwerpunkt aller sichtbaren Stücke entfernt ist. (Gegenteil - "Schwerpunkt-nah" - ist nachweislich schlechter, da die Konstruktion eine natürliche Aktivität an der Peripherie hat.)
3. **Streifen-Enden-Filter**: Nie aus der **Mitte** eines zusammenhängenden Streifens wählen (weder zum Schneiden noch zum Entnehmen) - nur von den beiden Enden. Verhindert unnötige Löcher in sonst zusammenhängenden Blöcken.
4. **Quadrat-Schnittrichtung**: Bei exakten Quadraten (gerades `k`) ist die Schnittrichtung mathematisch frei wählbar (keine Auswirkung auf die Stellenwert-Größen). Zwei Optionen getestet: "immer gleich" (senkrecht) und "alternierend" (wechselt je Quadrat-Ebene, gekoppelt an `k`, NICHT an die zeitliche Reihenfolge). **Kein Effektivitätsunterschied**, nur ästhetisch verschieden.

## 5. Haupttool und Test-Tool: gemeinsame Code-Basis (größtenteils gelöst)

Ursprünglich lief das Verhalten des Rests im Haupttool "komplett anders" als im Test-Tool. Ursachen (alle bestätigt):

1. ~~**Der Algorithmus-Code war separat kopiert**~~ in beiden Dateien und ist auseinandergedriftet (z.B. ein `born_time <= action_time`-Filter, der im Haupttool nötig war, im Test-Tool aber fehlte - empirisch aber ohne Auswirkung). **Gelöst:** beide Tools importieren jetzt denselben `bank-core.js`-Code (`createBankSimulation`/`buildSystem` per ES-Modul, siehe `vite.config.js`). Dabei kam auch eine reale Divergenz ans Licht: das Haupttool schnitt Quadrate bisher nach `k`-Parität statt nach der (validierten) Form-/`squareSplit`-Regel aus `bank-core.js` - mit der Umstellung stimmt das jetzt überein.
2. **Kompaktierung existiert weiterhin nur im Test-Tool**, nicht im Haupttool - offener Punkt, siehe Abschnitt 11.
3. **Tiefe-Standardwert war unterschiedlich**: Haupttool hatte `Tiefe=3`, Test-Tool `Tiefe=10` - weiterhin nicht synchronisiert (offene Entscheidung, siehe Abschnitt 11).
4. Haupttool hat **keine Auswahlmöglichkeit** für den Algorithmus (bewusst - Best-Kombination `squareSplit='fixed'` fest einprogrammiert, um die Haupt-UI schlank zu halten).

### Wie die Anbindung funktioniert

`bank-core.js` wird per ES-Modul-Import in beide HTML-Dateien eingebunden (kein Kopier-Build-Schritt mehr nötig, siehe `vite.config.js`). Beide Tools nutzen jetzt dieselbe Schalen-Orchestrierung `buildSystem(BASE, N_MAX, squareSplit, cellMode)` aus `bank-core.js` - keine eigene Kopie der Schalen-Schleife mehr in einem der beiden Tools. `cellMode` steuert, WIE VIELE Stücke pro Rand-Zelle (`is_top`) geholt werden:

- `'morph'` (Default im Haupttool, Flug-Modus **S: Strecken**): ein einzelnes, passendes Stück der Ebene `k` direkt aus der Bank, das in die Zielzelle gemorpht/gestreckt wird.
- `'subdivide'` (Default beim Aufruf ohne 4. Parameter, damit abwärtskompatibel zum Test-Tool; Haupttool-Flug-Modus **Z: Zerschneiden**): `BASE` Stücke der nächsten, feineren Ebene `k+1` - der Rand einer Schale entspricht der nächsten Ziffern-Stelle (siehe Abschnitt 6).

`buildSystem()` liefert dafür zusätzlich zu `sim`/`local_max_time` ein `events`-Array (ein Eintrag pro `getPieceFromBank()`-Aufruf, mit Gitterposition `u`/`v`, `is_top`, `k`, `piece`, `tick`, sowie `i`/`count` für Zerschneiden-Gruppen) - genug Information, damit ein Aufrufer daraus seine eigene Render-Pipeline bauen kann, ohne die Schalen-Konstruktion selbst zu duplizieren. Das Haupttool durchläuft `events` linear, vergibt dabei seine eigene kontinuierliche Animationszeit (`global_time`/`t_fly`, `SHELL_GAP` zwischen Schalen) und sammelt `(tick, t_fly)`-Paare; `buildTickTimeMapping()` übersetzt daraus am Ende alle `born_time`/`cut_time`/`taken_time`-Felder der Bank-Stücke (die `bank-core.js` nur als Integer-Tick führt) zurück in diese Zeitachse. Das Test-Tool braucht das nicht (seine Zeitachse ist der Tick selbst) und ignoriert `events`.

### Zerschneiden-Modus im Haupttool (Z) - bewusst nur Demo-Modus

Der Flug-Modus **Z: Zerschneiden** ist im Haupttool jetzt wählbar (Dropdown "Transformation") und nutzt denselben `subdivide`-Pfad wie das Test-Tool. Die Rück-Verschmelzung beim Zurückspulen (`BASE` Stücke der Ebene `n+1` fusionieren visuell zurück zu einem Stück der Ebene `n`, `Z_ghost`) wird nicht mehr als Bug reproduziert. Z bleibt trotzdem bewusst nur ein Demo-Modus für kleine Tiefen (nicht für die vollständig korrekte Konstruktion) - Details siehe Abschnitt 8.

**Beobachtung am Rande:** die `BASE`-Stücke-Zerlegung (Zerschneiden) hält den Rest sichtbar kompakter (weniger verstreute Einzelstücke) als die Ein-Stück-Variante (Morphing) - vermutlich ein echter Vorteil, aber getrennt von der Demo-Modus-Einordnung zu bewerten.

### Tick-Vergleich mit dem Test-Tool (Zeitstrahl-Regler "Tick")

Unterhalb des normalen Zeitstrahl-Reglers zeigt das Haupttool zusätzlich den zum aktuellen Zeitpunkt passenden **Tick** an (und lässt ihn direkt eintippen). Im Zerschneiden-Modus (`cellMode: 'subdivide'`, identisch zum Test-Tool) zeigt derselbe Tick in beiden Tools denselben Bank-Zustand. Im Morphing-Modus (Haupttool-Default) ist die Tick-Zählung dagegen bewusst anders als im Test-Tool (weniger, dafür größere Entnahmen) - der Regler bleibt trotzdem nützlich zum exakten Ansteuern von Entnahme-Zeitpunkten innerhalb des Haupttools selbst.

Ein subtiler, unabhängig davon behobener Fehler bei der Tick→Zeit-Umrechnung: der visuelle Vorlauf von `cut_time`/`born_time` konnte die Tick-Reihenfolge verfälschen. Der alte Versatz war `-0.4` Zeiteinheiten; da Ticks nur `0.15` Zeiteinheiten auseinanderliegen, konnte ein Schnitt-Ereignis aus einem *späteren* Tick durch den `-0.4`-Versatz vor die Entnahme eines *nahen, aber früheren* Ticks rutschen. Fix: Versatz auf `0.1` verkleinert (nachweislich kleiner als der minimal mögliche Tick-Abstand von `0.15`, siehe Kommentar `CUT_BORN_LEAD` in `compileSystem()`) - eine solche Umsortierung ist damit mathematisch ausgeschlossen.

## 6. Wichtige mathematische Erkenntnisse (nicht neu herleiten müssen!)

### 6.1 Gedämpfter, sicherer, monotoner Zoom
Problem: Naive Bounding-Box-Zoom-Berechnung "springt" oder bleibt stecken. Lösung (bewiesen, nicht nur getestet):
- Zoom-Zustand `{z, cx, cy}` wird pro **Checkpoint** (jeder Zeitpunkt, an dem sich die sichtbare Stückmenge ändert) berechnet, mit **festem Sicherheitsrand** (aktuell 0%, war mal 20%, siehe unten).
- Überblendung zwischen Checkpoints NICHT durch Interpolation der Parameter (z, cx, cy direkt), sondern durch **kausalen Exponentialkern** (`F(t) = exp(-k*(time-t))`) angewendet auf die fertig transformierten Positionen - das garantiert Sicherheit durch Konvexität von [0,1], unabhängig davon, wie stark sich das Zentrum zwischen Checkpoints verschiebt.
- Kritischer Fehler, der einmal gemacht und behoben wurde: Bei der Herleitung der affinen Form `T(x) = x*z + offset` muss `offset = 0.5 - cx*z` sein (NICHT `cx*(1-z)` - das war ein Vorzeichenfehler, der zu realen Überlappungen führte, erst bei Basis 2 entdeckt).
- Minimaler Zoom ist exakt 1.0 (kein Sicherheitsrand mehr, `ZOOM_MARGIN = 0`).

### 6.2 Kompaktierung ("Zeilen/Spalten ausblenden")
Idee des Nutzers: wie in einer Tabellenkalkulation leere Zeilen/Spalten ausblenden. Für jede Achse (x, y) unabhängig: finde die **belegten Intervalle** (Vereinigung aller Stück-Ausdehnungen), komprimiere die **Lücken** dazwischen auf 0. Stückgrößen bleiben exakt erhalten (jedes Stück liegt per Definition in einem belegten Intervall).

**Bewiesene Eigenschaften:**
- Monotone Abbildung pro Achse → Ordnungstreue und Nichtüberlappung bleiben automatisch erhalten.
- Füllgrad-Verbesserung: von ~75% (beste Auswahl-Heuristik) auf ~84-86%.

**Kritischer Fehler, der gemacht und behoben wurde:** Bei der gedämpften Überblendung MUSS jedes Stück über **alle** globalen Wegpunkte bewertet werden (auch außerhalb seiner eigenen Sichtbarkeit, mit seiner echten fixen Position durch die jeweilige Kompaktierungs-Abbildung geschickt) - NICHT nur über die Wegpunkte, an denen es selbst sichtbar ist. Sonst nutzen verschiedene Stücke unterschiedliche Gewichte, und die Ordnungstreue bricht zusammen (führte zu tausenden Überlappungen in einem fehlerhaften Zwischenstand).

**Ein Bewegungs-Schwellwert-Regler ("nur bei lohnender Verbesserung bewegen") wurde probiert und wieder verworfen** - bei extremen Werten (z.B. 1) "friert" das erste Intervall ein (die Überblendungsformel reduziert sich mathematisch auf einen konstanten Wert, wenn nur Start- und Endwegpunkt akzeptiert werden). Schwellwert=0 (jede Verbesserung wird Wegpunkt) funktioniert bereits ausgezeichnet - kein Regler nötig.

### 6.3 Bijektive Tick↔Zeit-Abbildung
Für das Haupttool: `buildTickTimeMapping(tickTimePairs)` nimmt eine Liste `{tick, time}`-Paare (in der Reihenfolge, in der der Algorithmus sie liefert) und baut ein Array `tickToTimeArr`, das per linearer Interpolation in beide Richtungen abgefragt werden kann (`tickToTime`, `timeToTick`). Getestet: 0 Rundtrip-Fehler bei 510 Prüfungen, auch für gebrochene Werte konsistent.

### 6.4 Bekannte, aber harmlose Alt-Bugs
- **Timing-Anomalie bei sehr kleiner Basis** (z.B. Basis 2): Innerhalb einer Schale ist `action_time` nicht streng monoton (mischt `t_fly` und `t_cut` für verschiedene Positionen). Führt in seltenen Fällen dazu, dass ein Vorfahre und einer seiner eigenen Nachkommen kurzzeitig gleichzeitig "sichtbar" sind. Empirisch bestätigt: **bereits in den rohen Original-Positionen vorhanden**, nicht durch spätere Fixes verursacht. Nicht blockierend, aber bekannt.
- **Gleitkomma-Präzisionsgrenze bei sehr tiefer Rekursion** (Basis 10, Tiefe 9+, Stücke ab k≈16-17 mit Kantenlänge ~10⁻⁸): vereinzelte "Ordnungsverletzungen" durch Gleitkomma-Rauschen, keine echten Logikfehler. Bei normalen Ausstellungs-Tiefen (3-8) nicht relevant.

## 7. Verworfene Ansätze (NICHT erneut versuchen, alle empirisch widerlegt)

Auswahl-/Schneide-Heuristiken, die getestet, aber **keine** Verbesserung brachten (bzw. schlechter waren als die validierte Kombination):
- Boustrophedon (Richtung alternierend je nach k-Parität)
- Nächste-Nähe-Heuristik (klar schlechter)
- Konsistente Richtung (Schneiden UND Entnehmen an derselben Ecke)
- LIFO/FIFO Batch-Konsum
- Gestufter Faktor-Schnitt (z.B. Basis 10 erst durch 2, dann durch 5 statt direkt durch 10) - erzeugt MEHR Fragmentierung, nicht weniger
- "Schwerpunkt-nah" Schneiden (Gegenteil von centroid_far) - klar schlechter
- Slot-basiertes Repacking (Left-Edge-Algorithmus) - technisch sauber (0 Kollisionen), aber der Nutzer wollte KEINE Neuanordnung, sondern nur Auswahl unter Beibehaltung der echten Positionen (siehe `stable_slots_prototype.html` als Referenz, verworfen)
- Rollout/Lookahead mit fixierter Fortsetzungs-Politik - als "Kaninchenbau" identifiziert und bewusst NICHT umgesetzt (zu rechenintensiv für den Nutzen)
- Bewegungs-Schwellwert für Kompaktierungs-Wegpunkte (siehe 6.2) - verursacht Einfrier-Bug bei extremen Werten, wieder entfernt

## 8. Z/R-Transformationsmodi (Z wählbar, aber bewusst nur Demo-Modus; R weiterhin deaktiviert)

Im Haupttool gibt es historisch drei Flug-Animationsmodi für die Ziel-Seite: **Z** (Zerschneiden/Montessori-Stil), **R** (Rotieren/Festkörper), **S** (Strecken/Morphing). Z und R hatten Bugs (teilweise gefixt: Doppel-Zeichnung bei Z_source, falsche Zielgröße bei R_macro) und wurden zwischenzeitlich komplett deaktiviert (nur S in der UI wählbar). **Z ist jetzt wieder wählbar** (nutzt die gemeinsame `buildSystem(..., 'subdivide')` aus `bank-core.js`, siehe Abschnitt 5) - **R bleibt deaktiviert**, das ist ein separater, unabhängiger Bug.

~~Bekannter Bug: Rück-Verschmelzung beim Zurückspulen nicht animiert~~ - **wird nicht mehr reproduziert** (Stand nach der gemeinsamen `buildSystem()`-Orchestrierung, Playwright-Scrub vorwärts/rückwärts über den vollen Tick-Bereich sowie Abspielen inkl. Zeitumkehr ohne Fehler/Auffälligkeiten).

**Z ist bewusst weiterhin nur ein Demo-Modus für kleine Tiefen, nicht "ehrlich" für die vollständige Konstruktion:** eine Rand-Zelle nimmt immer genau `BASE` Stücke der nächsten Ebene, unabhängig davon, wie weit die betroffene Seitenlänge von den bereits vorhandenen Stellen entfernt ist. Für eine wirklich korrekte Darstellung der Transformation weiter entfernter Seitenlängen müsste deutlich öfter geschnitten werden (mehrstufig, nicht nur einen Schritt tief). Für kleine Iterationstiefen fällt das nicht auf, wird aber bei tieferer Rekursion zunehmend unehrlich. Kein aktueller Handlungsbedarf, nur zur Einordnung.

**Anforderung für die Neuimplementierung (vom Nutzer explizit genannt):** Alle Übergänge müssen **C¹-stetig** sein (Ableitung stetig, kein "Stop-and-Go"). Erkenntnis dazu: Die Positions-Interpolation nutzte bereits Smoothstep (gut), aber die Alpha-Ein-/Ausblendungen bei Z (Z_source ausblenden, Z_micro ein-/ausblenden, Z_ghost einblenden) nutzten **lineare** Rampen (`Math.min`/`Math.max`) - das erzeugt Geschwindigkeitssprünge an den Rändern. Lösung (angedacht, noch nicht umgesetzt): alle Alpha-Übergänge auf Smoothstep umstellen, mit überlappenden Crossfade-Fenstern (z.B. 0.3 Zeiteinheiten) zwischen Z_source→Z_micro und Z_micro→Z_ghost, statt harter Cutoffs.

**Idee für später (noch nicht umgesetzt):** ein eigener, dedizierter Demo-Modus für die Konstanz der Fläche bei Variation von `b^-n * b^-m` für `n+m = const` - zeigt anschaulich, dass alle Zerlegungen derselben Gesamt-Exponentensumme dieselbe Fläche ergeben, unabhängig davon, wie sie auf die beiden Achsen verteilt ist. Getrennt vom Z-Modus zu behandeln (andere Fragestellung: Flächenkonstanz statt Bank-Konstruktion).

## 9. Auto-Zoom-Modus (Mindestbreite in Pixeln, umgesetzt)

Zusätzlicher Regler "Auto-Zoom: Mindestbreite feinste Stelle (Pixel, 0 = aus)" im Haupttool. Idee: die tiefste gerade **sichtbare** Ziffern-Stelle soll nie kleiner als `AUTO_ZOOM_MIN_PX` Canvas-Pixel dargestellt werden, auch wenn der Modus-B-Regler das nicht hergibt.

**Auto-Zoom macht nur dynamisch Sinn:** welche Ziffern-Stelle gerade "die tiefste sichtbare" ist, wächst mit der Animation - am Anfang ist nur das Basisquadrat (Exponent 0) sichtbar, am Ende bis zu Exponent `N_MAX`. Ein fix auf `N_MAX` eingestelltes Ziel würde von der ersten Sekunde an maximale Verzerrung erzwingen, obwohl die tiefen Stellen noch gar nicht gebaut sind. Deshalb:

- `getSmoothedAutoZoomExp(time)` liefert den (gedämpft geglätteten) Ziel-Exponenten für den aktuellen Zeitpunkt - exakt dasselbe Checkpoint+Exponentialkern-Muster wie `getBankTransform()` (siehe Abschnitt 6.1), nur für einen Skalar statt `{z,cx,cy}`. Checkpoints: ein Eintrag pro Schale `S` (`{t: Schalen-Startzeit, exp: axes[S].exp}`), gebaut in `compileSystem()` direkt nach `GLOBAL_SHELL_START`. Anders als beim Bank-Zoom ist hier **keine** Monotonie gewünscht/erzwungen - beim Zurückspulen/Scrubben rückwärts soll sich das Ziel genauso glatt wieder verkleinern (verifiziert: Playwright-Test zeigt symmetrisches Hoch- und Runterfahren vorwärts/rückwärts durch die Zeit).
- `computeAutoZoomTAB(thresholdPx, scale, targetExp)` sucht den kleinsten `t_AB` (Modus-B-Wert, [0,1]), bei dem eine Stelle vom Exponenten `targetExp` mindestens `thresholdPx` breit ist - reine Funktion, keine Seiteneffekte auf den Layout-Cache von `updateDynamicLayout()`. **Kein Bisektions-Suchlauf** (wie in einer ersten Version): `widthAt(t_AB)` ist nur für `targetExp` nahe `N_MAX` monoton wachsend - für kleine `targetExp` (frühe Schalen) schrumpft die Stelle anfangs sogar (das Basisquadrat wird optisch "verdrängt", wenn feinere Stellen aufgeblasen werden), die Kurve bildet dann einen Höcker statt einer Rampe (empirisch mit Node nachgewiesen). Bisektion würde dabei falsche/unruhige Ergebnisse liefern. Stattdessen ein linearer Suchlauf über 100 Stützstellen - robust unabhängig von der Kurvenform, Performance unkritisch (<0.2ms selbst bei `TOTAL_STEPS~500`, weit unter dem Frame-Budget).
- Effektiv gerendert wird `effective_t_AB = Math.max(u_mode_AB, autoZoomTAB)` - **"größerer Wert gewinnt"**: der Regler kann die Verzerrung erhöhen, Auto-Zoom kann sie ebenfalls erhöhen, aber keiner von beiden kann sie verringern. Der Modus-B-Regler selbst (`u_mode_AB`, seine sichtbare Position) bleibt dabei **unverändert** unter Nutzerkontrolle - nur der tatsächlich fürs Rendering benutzte Wert wird ggf. übersteuert.
- Ist die Mindestbreite im gesamten `[0,1]`-Bereich nicht erreichbar (z.B. sehr hohe Tiefe mit sehr vielen Ziffern-Stellen), wird der beste gefundene Kompromiss zurückgegeben statt hart auf `1` zu klammern (relevant, weil `widthAt(1)` bei kleinem `targetExp` nicht zwingend das Maximum ist - siehe Höcker-Hinweis oben).

**Visualisierung "welcher Wert gilt gerade":** eine Markierung (`#autoZoomMarker`, oranger Strich) wird bei `AUTO_ZOOM_MIN_PX > 0` über dem Modus-B-Regler an der Position `autoZoomTAB` eingeblendet (rein positionale Näherung, `left: X%` - nicht pixelgenau an die native Slider-Thumb-Breite angepasst, aber ausreichend als visueller Hinweis) und wandert während der Animation mit. Zusätzlich erscheint ein Text-Hinweis ("Auto-Zoom aktiv - übersteuert den Regler nach oben") NUR, wenn Auto-Zoom den Regler tatsächlich gerade übersteuert (`autoZoomTAB > u_mode_AB`) - bewegt der Nutzer den Regler manuell über die Marke hinaus, verschwindet der Hinweis wieder, obwohl die Marke sichtbar bleibt.

## 10. Zukünftige Vision (teils noch nicht begonnen)

- QR-Code-Verbindung: Besucher scannt Code am Exponat, öffnet Steuerung auf eigenem Gerät (Handy). Braucht echte Backend-Infrastruktur (WebSocket-Relay oder Realtime-Dienst wie Firebase/Supabase/Ably) - nicht mit einer reinen HTML-Datei machbar.
- Mehrbildschirm-Betrieb: Ziel/Rest/Steuerung auf getrennten physischen Displays. Innerhalb eines Rechners mit mehreren Fenstern schon heute simulierbar über die `BroadcastChannel`-API (kein Server nötig) - noch nicht umgesetzt. Würde ein gemeinsames Layout-Konfigurationsobjekt brauchen (z.B. `{ziel: {x,y,breite}, rest: {x,y,breite}, ...}`), damit jedes Fenster seine Position im gemeinsamen Koordinatenraum kennt.
- Admin-konfigurierbare Steuerungs-Komplexität: sobald die Grundarchitektur (siehe oben) steht, "nur" ein Konfigurationsobjekt, welche Regler für Besucher sichtbar sind.
- **Rest-Anzeige als austauschbare Widgets** (neuer Wunsch): die Bank/Rest-Visualisierung als Zähler soll unabhängig von den übrigen Einstellungen (Basis, Tiefe, Flug-Modus, ...) verfügbar sein, mit mehreren austauschbaren Darstellungs-Modi zum Ausprobieren - u.a. vertikale Anzeige aller Ziffern-Stellen als Balken (ähnlich der heutigen HUD-Inventory-Liste, aber als eigenständiges, austauschbares Widget) und horizontale Anzeige als bis zu 4×4-Grid (abhängig von der Basis). Noch nicht spezifiziert, welche weiteren Modi geplant sind - siehe Diskussion unten zu Svelte/Architektur.
- **Fernsteuerung über ein zweites Fenster/einen separat verbundenen Browser** - baut auf denselben Baustein wie Mehrbildschirm-Betrieb (`BroadcastChannel` lokal, später ein echter Realtime-Dienst für getrennte Geräte) und sollte dieselbe Architektur nutzen wie die austauschbaren Rest-Widgets (siehe Diskussion unten).

## 11. Empfohlene nächste Schritte (Priorität)

1. ~~Test-Tool im Browser verifizieren~~ - erledigt.
2. ~~Haupttool auf `bank-core.js` umstellen~~ - erledigt (Kompaktierung dabei bewusst ausgeklammert, siehe Punkt 3 unten).
3. Haupttool: Kompaktierung ergänzen (analog zum Test-Tool, verbunden mit der bijektiven Tick↔Zeit-Abbildung, die das Haupttool jetzt schon nutzt).
4. Tiefe-Standardwert im Haupttool klären/synchronisieren.
5. ~~Gemeinsame Schalen-Orchestrierung in `bank-core.js`~~ - erledigt: `buildSystem()` hat jetzt einen `cellMode`-Parameter (`'morph'`/`'subdivide'`), beide Tools nutzen dieselbe Funktion (siehe Abschnitt 5).
6. ~~Rück-Verschmelzung im Zerschneiden-Modus debuggen~~ - wird nicht mehr reproduziert (siehe Abschnitt 8). Z bleibt bewusst nur Demo-Modus für kleine Tiefen (siehe Abschnitt 8), kein Ausbau zur vollständig korrekten Konstruktion geplant.
7. Z/R-Transformationsmodi vollständig neu aufbauen (C¹-stetig, siehe Abschnitt 8) - eigenständiges Thema.
8. ~~Auto-Zoom-Modus~~ - erledigt, siehe Abschnitt 9.
9. Architektur-Entscheidung klären: Svelte (oder ähnliches Komponenten-Framework) für austauschbare Rest-Widgets + Fernsteuerungs-Architektur? Noch offen, siehe Konversationsverlauf - nichts umgesetzt, bis Grundsatzentscheidung steht.
10. Danach: Rest-Anzeige als austauschbare Widgets (Abschnitt 10) und Mehrbildschirm-/Fernsteuerungs-Architektur (Abschnitt 10) - beide auf derselben Architektur-Entscheidung (Punkt 9) aufbauend, nicht unabhängig voneinander umsetzen.
