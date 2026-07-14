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
2. **Kompaktierung existiert weiterhin nur im Test-Tool**, nicht im Haupttool - offener Punkt, siehe Abschnitt 10.
3. **Tiefe-Standardwert war unterschiedlich**: Haupttool hatte `Tiefe=3`, Test-Tool `Tiefe=10` - weiterhin nicht synchronisiert (offene Entscheidung, siehe Abschnitt 10).
4. Haupttool hat **keine Auswahlmöglichkeit** für den Algorithmus (bewusst - Best-Kombination `squareSplit='fixed'` fest einprogrammiert, um die Haupt-UI schlank zu halten).

### Wie die Anbindung funktioniert

`bank-core.js` wird per ES-Modul-Import in beide HTML-Dateien eingebunden (kein Kopier-Build-Schritt mehr nötig, siehe `vite.config.js`). Das Haupttool nutzt das low-level `createBankSimulation(BASE, N_MAX, squareSplit)` (statt des höheren `buildSystem()`), weil es die Schalen-Konstruktion selbst durchläuft, um dabei parallel seine eigene kontinuierliche Animationszeit (`global_time`/`t_fly`) mitzuführen. Aus jedem `sim.getPieceFromBank(k)`-Aufruf wird `(tick, t_fly)` gesammelt; nach dem vollständigen Durchlauf übersetzt `buildTickTimeMapping()` alle `born_time`/`cut_time`/`taken_time`-Felder der Bank-Stücke (die `bank-core.js` nur als Integer-Tick führt) zurück in die kontinuierliche Zeitachse.

### Tick-Vergleich mit dem Test-Tool (Zeitstrahl-Regler "Tick")

Unterhalb des normalen Zeitstrahl-Reglers zeigt das Haupttool zusätzlich den zum aktuellen Zeitpunkt passenden **Tick** an (und lässt ihn direkt eintippen) - für den Zustandsvergleich mit dem Test-Tool. Zwei Dinge dabei, eines behoben, eines bewusst NICHT (mehr):

1. **Rand-Zellen: EIN Stück (Morphing), nicht BASE Stücke.** Kurzzeitig wurde hier probeweise auf dieselbe BASE-Stücke-Anforderung wie `buildSystem()` (Test-Tool, Zerschneiden-Modus) umgestellt, um Tick-genaue Vergleichbarkeit zu erreichen. Das war ein Fehler in die falsche Richtung: das Haupttool wurde damit an einen im Test-Tool selbst noch unfertigen Modus angepasst - die Rück-Verschmelzung beim Zurückspulen (`b` Teile der Ebene `n+1` fusionieren zu einem Teil der Ebene `n`) ist dort noch gar nicht animiert, das Ergebnis war sichtbar buggy. **Zurückgesetzt:** Rand-Zellen nehmen im Haupttool wieder EIN passendes Stück der Ebene `k` direkt aus der Bank und morphen/strecken es in die Zielzelle - genau wie vor der bank-core.js-Migration. Damit sind Haupttool und Test-Tool (im Zerschneiden-Modus) wieder NICHT Tick-für-Tick identisch - der Tick-Regler im Haupttool bleibt trotzdem nützlich (exaktes Ansteuern von Entnahme-Zeitpunkten), zeigt aber nicht mehr zwangsläufig denselben Bank-Zustand wie das Test-Tool bei gleichem Tick.
   - **Beobachtung, die dabei hängen geblieben ist:** die BASE-Stücke-Zerlegung hält den Rest sichtbar kompakter (weniger verstreute Einzelstücke) als die Ein-Stück-Variante - das ist vermutlich ein echter Vorteil des Zerschneiden-Ansatzes, aber getrennt vom eigentlichen Bug (fehlende Rück-Animation) zu bewerten. Gehört zum offenen Thema "Z/R-Modi neu aufbauen" (Abschnitt 8), **nicht** hier vorschnell mit übernehmen.
2. **Der visuelle Vorlauf von `cut_time`/`born_time` konnte die Tick-Reihenfolge verfälschen** (unabhängig von Punkt 1, weiterhin behoben). Der alte Versatz war `-0.4` Zeiteinheiten; da Ticks nur `0.15` Zeiteinheiten auseinanderliegen, konnte ein Schnitt-Ereignis aus einem *späteren* Tick durch den `-0.4`-Versatz vor die Entnahme eines *nahen, aber früheren* Ticks rutschen. Fix: Versatz auf `0.1` verkleinert (nachweislich kleiner als der minimal mögliche Tick-Abstand von `0.15`, siehe Kommentar `CUT_BORN_LEAD` in `compileSystem()`) - eine solche Umsortierung ist damit mathematisch ausgeschlossen, unabhängig von Punkt 1.

### Offene Frage: eine gemeinsame Schalen-Orchestrierung in bank-core.js?

Der Hin-und-Her oben zeigt: nicht nur der Auswahl-/Schneide-Algorithmus (`createBankSimulation`, bereits geteilt) driftet auseinander, sondern auch die SCHALEN-ORCHESTRIERUNG (welche/wie viele Stücke pro Gitterzelle angefordert werden - `buildSystem()` im Test-Tool vs. die eigene Schleife im Haupttool) ist zwei separate Implementierungen, die genau dieselbe Art von Verwechslung wieder ermöglichen. Denkbare Lösung: `buildSystem()` in `bank-core.js` um einen Modus-Parameter erweitern (z.B. `cellMode: 'morph' | 'subdivide'`), sodass beide Tools dieselbe Orchestrierungs-Funktion mit unterschiedlicher Einstellung nutzen, statt eigener Kopien. Noch nicht umgesetzt - offene Entscheidung, siehe Abschnitt 10.

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

## 8. Z/R-Transformationsmodi (separates, noch offenes Thema)

Im Haupttool gibt es historisch drei Flug-Animationsmodi für die Ziel-Seite: **Z** (Zerschneiden/Montessori-Stil), **R** (Rotieren/Festkörper), **S** (Strecken/Morphing). Z und R hatten Bugs (teilweise gefixt: Doppel-Zeichnung bei Z_source, falsche Zielgröße bei R_macro), wurden aber auf Wunsch des Nutzers **komplett deaktiviert** (nur noch S in der UI wählbar), da nur noch mit S getestet wurde. Der Code für Z/R ist im Haupttool als Kommentar erhalten (nicht gelöscht), für eine spätere Neuimplementierung.

**Anforderung für die Neuimplementierung (vom Nutzer explizit genannt):** Alle Übergänge müssen **C¹-stetig** sein (Ableitung stetig, kein "Stop-and-Go"). Erkenntnis dazu: Die Positions-Interpolation nutzte bereits Smoothstep (gut), aber die Alpha-Ein-/Ausblendungen bei Z (Z_source ausblenden, Z_micro ein-/ausblenden, Z_ghost einblenden) nutzten **lineare** Rampen (`Math.min`/`Math.max`) - das erzeugt Geschwindigkeitssprünge an den Rändern. Lösung (angedacht, noch nicht umgesetzt): alle Alpha-Übergänge auf Smoothstep umstellen, mit überlappenden Crossfade-Fenstern (z.B. 0.3 Zeiteinheiten) zwischen Z_source→Z_micro und Z_micro→Z_ghost, statt harter Cutoffs.

**Zusätzlich gefundener Bug (Zerschneiden-Modus, Test-Tool):** beim Zurückspulen wird die Rück-Verschmelzung von `BASE` Stücken der Ebene `n+1` zurück in ein Stück der Ebene `n` nicht animiert - sichtbar buggy. Vor einer Neuimplementierung im Haupttool zuerst hier debuggen (siehe Abschnitt 5, Tick-Vergleich).

## 9. Zukünftige Vision (noch nicht begonnen)

- QR-Code-Verbindung: Besucher scannt Code am Exponat, öffnet Steuerung auf eigenem Gerät (Handy). Braucht echte Backend-Infrastruktur (WebSocket-Relay oder Realtime-Dienst wie Firebase/Supabase/Ably) - nicht mit einer reinen HTML-Datei machbar.
- Mehrbildschirm-Betrieb: Ziel/Rest/Steuerung auf getrennten physischen Displays. Innerhalb eines Rechners mit mehreren Fenstern schon heute simulierbar über die `BroadcastChannel`-API (kein Server nötig) - noch nicht umgesetzt. Würde ein gemeinsames Layout-Konfigurationsobjekt brauchen (z.B. `{ziel: {x,y,breite}, rest: {x,y,breite}, ...}`), damit jedes Fenster seine Position im gemeinsamen Koordinatenraum kennt.
- Admin-konfigurierbare Steuerungs-Komplexität: sobald die Grundarchitektur (siehe oben) steht, "nur" ein Konfigurationsobjekt, welche Regler für Besucher sichtbar sind.

## 10. Empfohlene nächste Schritte (Priorität)

1. ~~Test-Tool im Browser verifizieren~~ - erledigt.
2. ~~Haupttool auf `bank-core.js` umstellen~~ - erledigt (Kompaktierung dabei bewusst ausgeklammert, siehe Punkt 3 unten; Schalen-Orchestrierung bleibt Morphing/Ein-Stück, siehe Punkt 6).
3. Haupttool: Kompaktierung ergänzen (analog zum Test-Tool, verbunden mit der bijektiven Tick↔Zeit-Abbildung, die das Haupttool jetzt schon nutzt).
4. Tiefe-Standardwert im Haupttool klären/synchronisieren.
5. Test-Tool: Rück-Verschmelzung im Zerschneiden-Modus debuggen (fehlende Animation beim Zurückspulen, siehe Abschnitt 8) - **davor** keine weitere Angleichung des Haupttools an diesen Modus versuchen.
6. Offene Architekturfrage klären: gemeinsame Schalen-Orchestrierung (`buildSystem()` mit Modus-Parameter) in `bank-core.js`, statt eigener Kopien in beiden Tools? (siehe Abschnitt 5)
7. Erst danach: Z/R-Transformationsmodi neu aufbauen (C¹-stetig, siehe Abschnitt 8) - eigenständiges Thema, nicht mit den Punkten oben vermischen.
