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
erst prüfen, ob eine bereits vorhandene, gemeinsame Interpolationslösung
das abdeckt, statt das Rad erneut zu erfinden. Falls keine passende
gemeinsame Lösung existiert, das mit dem Nutzer klären, bevor eine weitere
bespoke Variante entsteht - in diesem Projekt gibt es bereits mehrere
verschiedene, unabhängig entwickelte Glättungs-Ansätze nebeneinander
(kausaler Exponentialkern in `getBankTransform()`/`getSmoothedCompactedRect()`,
kritisch gedämpfte Sprungantwort 2. Ordnung in `getSmoothedAutoZoomExp()`),
was Wartung und Konsistenz erschwert.

**Zusätzliche Anforderung, wo relevant:** Wenn der geglättete Wert eine
Sicherheits- oder Korrektheitsgarantie tragen muss (z.B. "Zoom bleibt
innerhalb [0,1]", "eine einmal sichtbare Ziffernstelle bleibt sichtbar"),
reicht die alleinige C¹-Glättung NICHT aus - die Glättung darf diese
Garantie nicht verzögern oder verletzen (siehe den mit "harte Garantie"
gefixten Bug in `renderFrame()`/Auto-Zoom in `sqrt2.html`: der geglättete
Wert allein kam der Garantie zeitweise zu spät nach). In solchen Fällen
zusätzlich einen ungeglätteten "harten" Wert parallel berechnen und die
Garantie darüber absichern, die Glättung nur für die Optik nutzen.
