Ich habe einen Vorschlag für eine Struktur für den Rest, der selbst als kompaktierende Funktion dient.

Die Berechnung der Positionen erfolgt rekursiv durch ein Box in Boxes Modell.

Boxen leben in einem Array, mit id = pos im Array

Jede Box hat folgende Eigenschaften:
- start-time: ts
- divided-time: td
- end-time: te
- box-id: id
- direction: dir 
  0: horizontal
  1: vertical
- designed_width: wd
- designed_height: hd
- children:
  array aus [id, ts, te]
- exponent: k

der Status einer Box ergibt sich aus der Simulationszeit:
t < ts: nicht gestartet
ts <= t < td: gestartet, nicht geteilt
td <= t < te: geteilt, nicht beendet
t + ausblenddauer < te <= t < : wird ausgeblendet
t >= te, beendet

je nach Status ergeben sich unterschiedliche Ergebnis für die effektive Größe.
im Fall gestartet: designte Werte 
im Fall geteilt: effektive Größe wird durch die Kinder berechnet 
im Fall "wird ausgeblendet" : interpolation der Größe zwischen designter Größe und 0
im Fall "beendet": 0

sie berechnet ihre effektive Größe im Fall dir==0 (horizontal):
- effective_width: summe der effective_width der Kinder
- effective_height: maximum der effective_height der Kinder
und äquivalent für dir==1 (vertikal):
- effective_width: maximum der effective_width der Kinder
- effective_height: summe der effective_height der Kinder

Sie berechnen ein Moment und eine Masse in Einheitskoordinaten äquivalent zur physikalischen Schwerpuntsberechnung.

Die Scale wird weich zwischen 1 / base und 1 interpoliert, entsprechend dem Minimum des Verhältnisses zwischen effektiver und designter Größe.
Positionen werden durch increment in der Laufrichtung an die Rekursive Zeichenfunktion übergeben.

Damit sollte automatische Kompaktierung und Vermeidung von Limitierung der Zahlenauflösung vermeidbar sein und eventuell normale floats zur Berechnung ausreichen.
