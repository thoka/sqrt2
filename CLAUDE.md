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
Wartung/Konsistenz erschwert UND direkt zu zwei echten Bugs geführt (siehe
die beiden Punkte unten). Mittlerweile vereinheitlicht in `smoothing.js`,
mit zwei bewusst unterschiedlichen Bausteinen je nach Anforderung:

- **`buildMonotoneSpline()`/`buildMonotoneSplineBundle()`** - für EINEN in
  sich geschlossenen Wert (oder mehrere UNABHÄNGIGE Werte wie Zoom-Faktor +
  Offset, die keine Ordnungsbeziehung ZUEINANDER einhalten müssen). Monotone
  kubische Hermite-Interpolation, C¹-stetig, trifft jeden Stützpunkt exakt.
- **`computeSegmentBlend()`** - für MEHRERE, voneinander abhängige Werte,
  deren RELATIVE Lage zueinander eine Invariante einhalten muss (klassisch:
  "Objekt A überlappt Objekt B nie"). Liefert EIN geteiltes Blend-Gewicht
  `s(t)`, das alle beteiligten Werte gleich behandelt - siehe nächster
  Punkt für die Begründung, warum das hier zwingend nötig ist.

**Zwei konkrete, in diesem Projekt tatsächlich aufgetretene Fehlerklassen:**

1. **Verzögerte Sicherheitsgarantie:** Wenn der geglättete Wert eine
   Sicherheits-/Korrektheitsgarantie trägt (z.B. "eine einmal sichtbare
   Ziffernstelle bleibt sichtbar"), reicht C¹-Glättung allein nicht, wenn
   die Stützpunkte selbst schon verzögert/geglättet in die Berechnung
   eingehen (verzögerter Checkpoint ⇒ verzögerte Garantie). Fix in diesem
   Projekt: `buildMonotoneSpline()` trifft jeden Stützpunkt exakt und ohne
   Verzögerung (siehe `smoothing.js`) - das allein reicht bereits als
   Garantie, sofern die Stützpunkt-Werte selbst monoton sind (kein
   zusätzlicher "harter" Parallel-Wert mehr nötig, siehe `sqrt2.html`
   Auto-Zoom-Historie).
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
   zueinander einhalten müssen - Beweis und Regressionstest siehe README
   Abschnitt 6.2 und `bank-core-compaction.test.js`.

**Faustregel:** Bewegt sich nur EIN Ding, oder mehrere Dinge OHNE
Beziehung zueinander → `buildMonotoneSpline()`. Bewegen sich MEHRERE
voneinander abhängige Dinge, deren relative Anordnung eine Garantie tragen
muss → `computeSegmentBlend()`. Im Zweifel: eher `computeSegmentBlend()`
(sicherer, aber etwas "steifer" durch garantierte Nulltangente an jedem
Wegpunkt) - und bei Bedarf mit dem Nutzer klären.
