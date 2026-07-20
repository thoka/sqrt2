# MathJax_Main-Regular.woff

Herkunft: [MathJax](https://www.mathjax.org/) v3.2.2, CHTML-Output-Font
(`output/chtml/fonts/woff-v2/MathJax_Main-Regular.woff`, bezogen via
`https://cdn.jsdelivr.net/npm/mathjax@3/...`, siehe
`scripts/mathjax-metrics.mjs` + `docs/MATHJAX_METRICS.md`).

**Lizenz:** Apache License 2.0 (siehe `LICENSE-Apache-2.0.txt` in diesem
Verzeichnis bzw. <https://github.com/mathjax/MathJax-src/blob/master/LICENSE>).
Copyright © The MathJax Consortium.

**Warum hier committet statt von der CDN geladen:** das Exponat läuft ohne
verlässliche Internetverbindung (Ausstellungs-Kontext, siehe
`docs/DEPLOYMENT.md`) - Fonts müssen lokal verfügbar sein. Nur DIESE eine
Datei (Ziffern/Klammern/Schrägstrich/lateinische Buchstaben, ~34 KB) wird
gebraucht, nicht das komplette MathJax-Font-Set (`MJXTEX-I`, `-S1..S4`,
`-A`, `-C`, ... bleiben ungenutzt) - siehe `src/lib/mathFont.js` für die
Einbindung.
