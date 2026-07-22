# Vergleich: eigener Renderer vs. echtes MathJax

Automatisch erzeugt von `scripts/mathjax-compare.mjs` (FONT_PX=60). Bilder in diesem Verzeichnis - links unser Renderer, rechts MathJax.

Neu erzeugen: `node scripts/mathjax-compare.mjs`

## Schräger Bruch: 1/128

> MathJax hat keinen eingebauten schrägen (einzeiligen) Bruch - Referenz zeigt die naheliegende TeX-Entsprechung (normaler Text "1/128"). Unser Renderer hebt/senkt Zähler/Nenner bewusst (docs/Beschriftung.md "weniger Höhe").

| Unser Renderer | MathJax |
|---|---|
| ![](01-schraeger-bruch_ours.png) | ![](01-schraeger-bruch_mathjax.png) |

## Gerader Bruch mit Exponent: (1/10)^3

| Unser Renderer | MathJax |
|---|---|
| ![](02-gerader-bruch-mit-exponent_ours.png) | ![](02-gerader-bruch-mit-exponent_mathjax.png) |

## Buchstabe mit Exponent: l^2

> MathJax italisiert einzelne Variablen (Math-Italic-Font) - unser Renderer nutzt durchgehend den (aufrechten) MathJax-Main-Font, siehe docs/MATHJAX_METRICS.md §6.

| Unser Renderer | MathJax |
|---|---|
| ![](03a-exponent-buchstabe_ours.png) | ![](03a-exponent-buchstabe_mathjax.png) |

## Zahl mit Exponent: 2^18

| Unser Renderer | MathJax |
|---|---|
| ![](03b-exponent-zahl-klein_ours.png) | ![](03b-exponent-zahl-klein_mathjax.png) |

## Zahl mit Exponent: 10^5

| Unser Renderer | MathJax |
|---|---|
| ![](03c-exponent-zahl-gross_ours.png) | ![](03c-exponent-zahl-gross_mathjax.png) |

## Zahl mit Subscript: 1,41_10

| Unser Renderer | MathJax |
|---|---|
| ![](04-subscript_ours.png) | ![](04-subscript_mathjax.png) |

