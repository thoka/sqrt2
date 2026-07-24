# MathJax-Metriken: Brüche/Exponenten ohne MathJax nachbauen

> **Update (docs/Beschriftung.md):** Die Achsen-Beschriftung der Ziel-
> Quadrate nutzt inzwischen NICHT mehr den in diesem Dokument beschriebenen
> Hand-Nachbau, sondern echtes, gecachtes MathJax
> (`src/lib/mathJaxRenderer.js` + `mathJaxLabelCache.js` +
> `mathJaxImageCache.js`, dynamisch geladen, IndexedDB-persistiert) - der
> Hand-Nachbau lieferte trotz dieser Vermessung sichtbare Abweichungen
> (Klammern zu fett, falsche Zentrierung), die sich als Cache-Problem
> herausstellten, nicht als Metrik-Problem. Dieses Dokument (Methodik +
> Konstanten) bleibt gültig für den verbleibenden Anwendungsfall: die
> Zahlentafel-Hoch-/Tiefstellung im HUD (`renderHud()`, `layoutScript`/
> `drawScript` in `mathCanvasRenderer.js`) - dort ändert sich der Wert bei
> JEDEM Frame, ein MathJax-Cache hilft dort nicht, siehe docs/Beschriftung.md.
> Die `layoutFraction`/`layoutFractionPower`/`layoutSlashFraction`-Funktionen
> (Brüche/Exponenten in Klammern) wurden entfernt.

**Anlass:** Die Achsen-Beschriftung der Ziel-Quadrate (TODO.md "Darstellung")
soll Brüche/Exponenten zeigen, die **optisch wie MathJax** aussehen ("(1/2)²",
"1/8" als echte, gestrichene Brüche statt Klartext) - **aber MathJax selbst
darf zur Laufzeit nicht laufen**. Grund (Commit `b3adf99`): MathJax' pro-Frame
`typesetPromise` blockierte den `rAF`-Loop und war die Hauptursache des
Flug-Stotterns; die Zahlentafel (l/l²/R) wurde deshalb bereits auf einen
eigenen, MathJax-freien Canvas-Renderer umgestellt (`numberRenderer.js`).

**Lösung:** MathJax **einmalig offline** untersuchen (Node/Playwright,
`scripts/mathjax-metrics.mjs`), seine CHTML-Ausgabe geometrisch vermessen,
die wenigen Verhältniszahlen extrahieren, die ein Bruch/Exponent tatsächlich
braucht, und diese Zahlen in einem eigenen, sehr einfachen Canvas-Renderer
(`src/lib/mathCanvasRenderer.js`) nachbauen. MathJax bleibt ein reines
Analyse-Werkzeug, komplett getrennt vom Produkt-Bundle.

## 1. Methodik (`scripts/mathjax-metrics.mjs`)

1. Eine In-Memory-HTML-Seite lädt MathJax 3 von der öffentlichen CDN
   (`tex-mml-chtml.js`), mit **derselben Config**, die dieses Projekt vor der
   Entfernung nutzte (`{ chtml: { displayAlign: 'left' } }`, siehe
   `git show b3adf99^:index.html`).
2. Mehrere Test-Ausdrücke werden bei einer **großen, festen Schriftgröße**
   (`FONT_PX = 200px`, minimiert Rundungsfehler) inline (`\(...\)`, "Textstyle"
   - passend zu unserem Anwendungsfall: kompakte Beschriftung neben kleinen
   Rechtecken, kein `\displaystyle`) gerendert: `\frac{1}{8}`,
   `\left(\frac{1}{2}\right)^{3}`, `x^{3}`, `1.4142_{10}` (letzteres identisch
   zur früheren HUD-Formel) sowie eine einzelne Ziffer `0` als Referenz.
3. Playwright liest den kompletten DOM-Teilbaum jedes gerenderten Ausdrucks
   aus (Tag, Klasse, `getBoundingClientRect()` relativ zum `<mjx-container>`,
   `getComputedStyle().fontSize`) und leitet daraus **Verhältniszahlen** ab
   (siehe Abschnitt 3).
4. `node scripts/mathjax-metrics.mjs --json <datei>` schreibt den vollen
   Rohbericht; `--screenshot <verzeichnis>` zusätzlich PNG-Referenzbilder
   pro Test-Ausdruck (visueller Abgleich, siehe Abschnitt 5).

**Wichtige Falle (im Gespräch gefunden, jetzt im Skript dokumentiert):**
MathJax platziert in Zähler/Nenner-Boxen zuerst einen unsichtbaren
`mjx-nstrut`/`mjx-dstrut` (Grundlinien-Abstandshalter) VOR dem eigentlichen
Zeichen-Element - ein naiver "erstes Kind, dann rekursiv das jeweils erste
Kind"-Abstieg (`firstLeaf()`) griff zunächst den Strut statt der Ziffer und
lieferte eine falsche Schriftgrößen-Skalierung (0.85 statt 0.707). Fix:
gezielt nach dem Tag `mjx-c` (echtes Zeichen-Glyph) suchen (`findGlyph()`).

**Zweite Falle:** `getComputedStyle(el).fontSize` einer Box wie `mjx-num`
bleibt oft bei der VOLLEN Schriftgröße (MathJax skaliert dort per
CSS-`transform`, nicht per `font-size`) - die tatsächliche visuelle Größe
steckt erst im `fontSize` des **inneren Zeichen-Glyphs** (`mjx-c`). Deshalb
misst das Skript IMMER am Glyph, nie an der Box.

## 2. Normalisierung: "Referenz-Textgröße" statt CSS-`font-size`

Die CSS-`font-size` des umgebenden Containers (200px) entspricht NICHT der
Schriftgröße, die MathJax intern einer normalen Ziffer zuweist (hier
gemessen: 242.6px - MathJax rechnet mit eigenen `em`-Stufen). Referenz ist
daher die **gemessene Glyph-Schriftgröße einer einzeln gerenderten Ziffer**
(Testfall `digit_reference`, "0"), nicht der CSS-Wert. Alle Verhältniszahlen
unten sind relativ zu dieser Referenz.

## 3. Rohmessung (Stand 2026-07-20, MathJax 3, `tex-mml-chtml.js`)

Bei `FONT_PX(CSS) = 200`: Referenz-Glyphgröße (Ziffer "0") = **242.60px**.

| Größe | Fundstelle im DOM | gemessen | Verhältnis zur Referenz |
|---|---|---|---|
| Zähler-/Nenner-Schriftgröße (`\frac`) | `mjx-num`/`mjx-den` → `mjx-c` | 171.52px | **0.7070** |
| Exponent-Schriftgröße (`x^{3}`) | `mjx-script` → `mjx-c` | 171.52px | **0.7070** (identisch zu Zähler/Nenner) |
| Bruchstrich-Dicke | `mjx-line`, Höhe | 14.55px | **0.0600** |
| Abstand Zähler→Strich | `mjx-num`-Unterkante bis `mjx-line`-Oberkante | 14.55px | **0.0600** (≈ Strichdicke) |
| Abstand Strich→Nenner | `mjx-line`-Unterkante bis `mjx-den`-Oberkante | 14.55px | **0.0600** (≈ Strichdicke) |
| Exponent-Anhebung (`x^{3}`) | Grundlinie Basis "x" minus Grundlinie Exponent | 86.95px | **0.3584** |
| Index-Absenkung (`1.4142_{10}`) | Grundlinie Index minus Grundlinie Haupttext | 31.05px | **0.1280** |

Zusatzbeobachtung (`paren_frac_pow_inline`, `(1/2)^3`): die vertikale MITTE
des Exponenten liegt sehr nah an der vertikalen MITTE des Zählers (91.4–139.4
vs. 46.8–174.1, Mittelpunkte 115.4 vs. 110.5) - daraus die Vereinfachung in
`layoutFractionPower()`: der Exponent wird auf **Zähler-Grundlinienhöhe**
gesetzt (siehe Abschnitt 4), statt eine eigene TeX-Regel für "Exponent auf
geklammertem Bruch" nachzubilden.

Neu vermessen: `node scripts/mathjax-metrics.mjs --json /tmp/report.json`
(Netzwerk zur MathJax-CDN nötig, nur ein einmaliges Analyse-Tool - siehe
Warnhinweis im Skript-Kopf).

## 4. Abgeleitete Konstanten (`src/lib/mathMetrics.js`)

```js
{
  SCRIPT_SCALE: 0.707,    // Zähler/Nenner/Exponent/Index-Schriftgröße
  RULE_THICKNESS: 0.06,   // Bruchstrich-Dicke
  RULE_GAP: 0.06,         // Abstand Zähler→Strich / Strich→Nenner
  SUP_SHIFT: 0.358,       // Exponent-Grundlinie über der normalen Grundlinie
  SUB_SHIFT: 0.128,       // Index-Grundlinie unter der normalen Grundlinie
}
```

Alle Werte sind Vielfache der "Grundschriftgröße" (`fontPx`) - der Größe, in
der ein normales Zeichen an der jeweiligen Stelle gezeichnet würde (TeX
"textstyle"/Scriptlevel 0).

## 5. Umsetzung (`src/lib/mathCanvasRenderer.js`)

Zwei Schichten (siehe AGENTS.md "Canvas/DOM nie nur per Unit-Test
verifizieren"):

- **`layoutFraction()`/`layoutFractionPower()`** - reine Geometrie, bekommen
  eine `measure(text, fontPx) -> {width, ascent, descent}`-Funktion
  injiziert statt selbst auf `ctx` zuzugreifen. Mit einem deterministischen
  Fake-Measurer per `node --test` geprüft
  (`tests/unit/mathCanvasRenderer.test.js`): Zähler oberhalb/Nenner
  unterhalb des Ankerpunkts, Breite deckt den breiteren Teil ab, Segmente
  von links nach rechts geordnet, Exponent auf Zähler-Grundlinienhöhe,
  Klammer-Schriftgröße skaliert linear mit `fontPx`.
- **`drawFraction()`/`drawFractionPower()`** - dünne Canvas-Schicht, nutzt
  `ctx.measureText(...).actualBoundingBoxAscent/Descent` als echten
  Measurer (statt geschätzter Werte) und führt die eigentlichen
  `fillText()`/`fillRect()`-Aufrufe aus. Unterstützen `opts.dryRun: true`
  (nur Geometrie/Breite berechnen, nichts zeichnen) - damit
  `TargetBankCanvas.svelte` VOR dem Zeichnen prüfen kann, ob der Bruch in
  die verfügbare Zellbreite passt (TODO.md-Vorgabe "wenn die Breite
  ausreicht"), ohne die Layout-Logik zu duplizieren.

Verwendet für:
- Achsen-Beschriftung der Ziel-Quadrate (`drawTargetLabels()` in
  `TargetBankCanvas.svelte`): unten `(1/basis)^exponent` als geklammerter
  Bruch mit Exponent, links der ausgerechnete Wert als reiner Bruch.
- Zahlentafel-Subscript (`renderHud()`, Basis-Angabe nach l/l²/R, z.B.
  "1.4142₁₀") - vorher ein Ad-hoc-Wert (Skalierung 0.7, Absenkung
  `fontSize - subFont` = 0.3·fontSize), jetzt `MATH_METRICS.SCRIPT_SCALE`/
  `SUB_SHIFT` (0.128·fontSize) - sitzt dadurch näher an MathJax' eigener
  Index-Position als die vorherige Schätzung.

## 6. Bewusste Vereinfachungen (kein Anspruch auf Pixel-Genauigkeit)

- **Schriftart:** eigener Renderer nutzt `ui-monospace, monospace` (Konsole-
  taugliche Systemschrift, Performance/Konsistenz mit dem Rest der
  Zahlentafel), MathJax rendert mit einer eigenen, serifen-artigen
  Mathe-Schrift (STIX-artig). Die LAYOUT-Verhältnisse (Skalierung, Abstände,
  Positionen) sind übernommen, die Glyphen-Form selbst nicht.
- **Klammerhöhe:** MathJax skaliert `\left(\right)` über eigene, gestreckte
  Klammer-Glyphen (mehrere Segmente). Der eigene Renderer approximiert das
  simpler: EINE normale `(`/`)`-Glyphe, deren Schriftgröße so gewählt wird,
  dass ihre Ascent+Descent ungefähr der Bruch-Gesamthöhe entspricht (+5%
  Sicherheitszuschlag). Sieht bei den kleinen Label-Größen dieses Projekts
  (≤14px) visuell überzeugend aus (siehe Vergleichs-Screenshots), ist aber
  keine echte "\left(\right)"-Streckung.
- **Bruchstrich-Breite:** MathJax lässt den Strich sichtbar über Zähler/
  Nenner hinausragen (in der Messung: 134px Strich vs. 86px Zähler/Nenner,
  ~56% Überstand) - vermutlich eine feste Mindestbreite/zusätzlicher
  TeX-Randwert, der hier nicht separat nachgebildet wurde. Der eigene
  Renderer nutzt einen deutlich kleineren, festen Überstand (`fontPx * 0.15`
  gesamt) - passender für die kompakten Achsen-Beschriftungen, sieht bei
  MathJax-Größenordnungen ggf. schmaler aus.
- **Exponent-auf-Bruch-Position:** siehe Abschnitt 3, "Zusatzbeobachtung" -
  eine empirische Näherung (Exponent auf Zähler-Grundlinienhöhe), keine
  hergeleitete TeX-Regel.

## 7. Visueller Abgleich

`node scripts/mathjax-metrics.mjs --screenshot /tmp/mathjax-shots` erzeugt
PNG-Referenzbilder jedes Testausdrucks (z.B. `paren_frac_pow_inline.png` =
"(1/2)³" in echtem MathJax bei 200px) - direkter Soll/Ist-Vergleich zu einem
per Playwright aufgenommenen Screenshot der App (`?labels=1`, siehe
`docs/DONE.md`-Eintrag "MathJax-Metriken"). Ergebnis: gleiche Struktur
(Klammern umschließen den Bruch, Exponent oben rechts, Bruchstrich mittig),
unterschiedliche Schriftart wie unter Abschnitt 6 beschrieben.
