# Agentenregeln für dieses Projekt

## Automatisierte Parameteränderungen: stetige Ableitung

Parameter, die sich automatisiert (also nicht durch direkte, kontinuierliche
Nutzerinteraktion wie Maus-Drag) über die Zeit ändern - Zoom, Position,
Größe, Blendwerte, Kamerafahrten, o.ä. - werden grundsätzlich mit stetiger
Ableitung geändert (mindestens C¹: kein Sprung in Wert ODER Steigung).

**Warum:** Ein reiner Wert-Sprung (C⁰) sieht ruckartig aus; ein Kink in der
Steigung (Wert stetig, aber Ableitung springt) wirkt subtiler, ist aber im
bewegten Bild trotzdem als Ruckeln wahrnehmbar - beides in diesem Projekt
mehrfach konkret aufgetreten (Auto-Zoom-Exponent, Bank-Zoom, Play/Pause-
Resume-Sprung durch veraltetes `lastTime`).

**Wie anwenden:** Bevor für eine neue automatisierte Bewegung eine Ad-hoc-
Lösung gebaut wird (neuer Dämpfungs-Kernel, neue Sprungantwort-Formel, …):
erst prüfen, ob `smoothing.js` (siehe unten) das schon abdeckt, statt das
Rad erneut zu erfinden. Historie zur Erinnerung, warum diese Regel existiert:
in diesem Projekt gab es zeitweise mehrere unabhängig voneinander erfundene
Glättungs-Ansätze nebeneinander (kausaler Exponentialkern, kritisch gedämpfte
Sprungantwort 2. Ordnung, unabhängige monotone Splines pro Feld) - das hat
Wartung/Konsistenz erschwert UND direkt zu drei echten Bugs geführt (siehe
die drei Punkte unten). Mittlerweile vereinheitlicht in `smoothing.js`,
mit drei bewusst unterschiedlichen Bausteinen je nach Anforderung:

- **`buildMonotoneSpline()`/`buildMonotoneSplineBundle()`** - für EINEN in
  sich geschlossenen Wert (oder mehrere UNABHÄNGIGE Werte wie Zoom-Faktor +
  Offset, die keine Ordnungsbeziehung ZUEINANDER einhalten müssen), WENN der
  Wert an jedem Stützpunkt exakt getroffen werden MUSS (z.B. für eine
  Sichtbarkeits-Garantie). Monotone kubische Hermite-Interpolation, C¹-stetig,
  trifft jeden Stützpunkt exakt und ohne Verzögerung - reagiert aber auch
  SOFORT auf jeden noch so kleinen Stützpunkt, was bei vielen dicht
  getakteten Stützpunkten unruhig/zappelig wirken kann (siehe `buildDampedFilter()`).
- **`computeSegmentBlend()`** - für MEHRERE, voneinander abhängige Werte,
  deren RELATIVE Lage zueinander eine Invariante einhalten muss (klassisch:
  "Objekt A überlappt Objekt B nie"). Liefert EIN geteiltes Blend-Gewicht
  `s(t)`, das alle beteiligten Werte gleich behandelt - siehe Punkt 2 unten
  für die Begründung, warum das zwingend nötig ist. **Zusätzlich**: reicht
  bei einer Sicherheitsgarantie über die Zeit hinweg (z.B. "Stück A darf nie
  in den Platz von Stück B rutschen, bevor B verschwunden ist") allein NICHT
  aus - siehe Punkt 3 unten (Wegpunkte müssen die Verzögerung selbst tragen).
- **`buildDampedFilter()`/`buildDampedFilterBundle()`** - für Werte, die NUR
  träge/asymptotisch dem Zielwert folgen müssen, OHNE Garantie auf exaktes
  Treffen einzelner Stützpunkte (z.B. eine Kamera-Zoomstufe, deren
  Sicherheitsbeweis für JEDE Zeitkonstante TAU gilt, siehe README Abschnitt
  6.1). Kritisch gedämpfte Sprungantwort 2. Ordnung, C¹-stetig, aber bewusst
  TRÄGE mit fester Zeitkonstante TAU - genau richtig, wenn viele dicht
  getaktete Stützpunkte (z.B. ein Wegpunkt pro Bank-Entnahme) sonst mit
  `buildMonotoneSpline()` unruhig/zappelig wirken würden.

**Drei konkrete, in diesem Projekt tatsächlich aufgetretene Fehlerklassen:**

1. **Verzögerte Sicherheitsgarantie durch die Glättung selbst:** Wenn der
   geglättete Wert eine Sicherheits-/Korrektheitsgarantie trägt (z.B. "eine
   einmal sichtbare Ziffernstelle bleibt sichtbar"), reicht C¹-Glättung
   allein nicht, wenn die Stützpunkte selbst schon verzögert/geglättet in
   die Berechnung eingehen (verzögerter Checkpoint ⇒ verzögerte Garantie).
   Fix: `buildMonotoneSpline()` trifft jeden Stützpunkt exakt und ohne
   Verzögerung - das allein reicht bereits als Garantie, sofern die
   Stützpunkt-Werte selbst monoton sind (kein zusätzlicher "harter"
   Parallel-Wert mehr nötig, siehe `sqrt2.html` Auto-Zoom-Historie). **NICHT
   für Werte verwenden, die nur asymptotisch folgen müssen** - dafür
   `buildDampedFilter()`, siehe Punkt 4.
2. **Gebrochene Ordnungstreue zwischen mehreren Werten:** Wenn MEHRERE Werte
   (z.B. die Positionen mehrerer Objekte) unabhängig voneinander optimiert
   geglättet werden (`buildMonotoneSpline()` pro Objekt/Feld), können sie
   zum selben Zeitpunkt unterschiedlich weit "fortgeschritten" sein - eine
   an den Stützpunkten korrekte (z.B. nicht überlappende) Anordnung kann
   ZWISCHEN den Stützpunkten trotzdem kollidieren. Passiert real bei der
   Kompaktierung (`getSmoothedCompactedRect()` in `bank-core.js`): ein
   Stück rutschte sichtbar in den Platz eines Nachbarn, bevor dieser
   tatsächlich verschwunden war. Fix: `computeSegmentBlend()` statt
   unabhängiger Splines, sobald mehrere Werte eine Ordnungsbeziehung
   zueinander einhalten müssen.
3. **Verzögerungs-Garantie braucht eigene Wegpunkte, nicht nur die richtige
   Blend-Methode:** Selbst mit `computeSegmentBlend()` reicht EIN Wegpunkt
   "N Ticks nach dem Ereignis" nicht, um JEDE Bewegung bis dahin zu
   verhindern - ein Segment blendet STETIG, die Steigung ist nur GENAU am
   Segment-Start exakt null. Für "keinerlei Bewegung, bis mindestens N Ticks
   vergangen sind" braucht es einen ZWEITEN Wegpunkt mit IDENTISCHEM Zustand
   bei genau N Ticks - ein Segment zwischen zwei GLEICHEN Werten bleibt
   exakt flach, unabhängig von seiner Breite; die eigentliche Überblendung
   findet erst im ANSCHLIESSENDEN Segment statt. Passiert real bei der
   Kompaktierungs-Verzögerung (`GAP_CLOSE_DELAY_TICKS` in `bank-core.js`).
   Beim Verifizieren Vorsicht: ein naiver "bewegt sich irgendein Nachbar in
   diesem Zeitfenster"-Test erzeugt bei dicht getakteten, überlappenden
   Ereignissen leicht falsche Alarme (siehe `bank-core-compaction.test.js`
   für den korrekten, isolierten Test-Aufbau).
4. **Falsche Wahl zwischen exakt und gedämpft:** `getBankTransform()` wurde
   zunächst (fälschlich) auf `buildMonotoneSpline()` umgestellt - bei
   hunderten dicht getakteten Checkpoints (ein Wegpunkt pro Bank-Entnahme)
   wirkte das unruhig/zappelig, weil die Kurve auf JEDEN einzelnen Wegpunkt
   sofort reagierte. Der Bank-Zoom BRAUCHT diese Exaktheit nicht (sein
   Sicherheitsbeweis gilt für jede Zeitkonstante TAU) - Fix: `buildDampedFilter()`.

**Faustregel:** Muss der Wert an jedem Stützpunkt exakt/ohne Verzögerung
stimmen (Sicherheitsgarantie hängt daran) UND bewegt sich nur EIN Ding (oder
mehrere UNABHÄNGIGE) → `buildMonotoneSpline()`. Bewegen sich MEHRERE
voneinander abhängige Dinge, deren relative Anordnung eine Garantie tragen
muss → `computeSegmentBlend()` (UND bei einer zeitlichen Verzögerungs-
Garantie zusätzlich einen zweiten, "pinnenden" Wegpunkt einplanen, siehe
Punkt 3 oben). Muss der Wert nur träge/asymptotisch folgen, ohne exakte
Treffer nötig (z.B. reine Kamera-/Zoom-Bewegung) → `buildDampedFilter()`
für spürbar ruhigere, langsamere Bewegung bei vielen dicht getakteten
Stützpunkten. Im Zweifel bei Sicherheitsfragen: eher `computeSegmentBlend()`
- und bei Bedarf mit dem Nutzer klären.
