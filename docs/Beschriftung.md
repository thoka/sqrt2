# Beschriftung

Optional werden die Seiten im Ziel beschriftet.

Da Mathjax dazu zu langsam ist, nutzen wir einen eigenen Renderer, der Mathjax optisch möglichst kopieren soll, aber schnell genug für die Animationen ist.

Die Darstellung ist noch nicht optimal. 
- [x] Tool erstellen, das Metriken aus Mathjax ausliest. 
- [x] Untersuchen, ob wir die Mathjax-Fonts ganz oder in Auszügen verwenden können.
      (Ja - `MathJax_Main-Regular.woff`, ~34 KB, Apache-2.0, deckt Ziffern/
      Klammern/Schrägstrich/lateinische Buchstaben ab. Lokal gebündelt unter
      `src/assets/fonts/`, eingebunden über `src/lib/mathFont.js`. Die
      restlichen MathJax-Fonts (kursive Variablen, Größenstufen S1-S4 für
      sehr große Klammern, Fraktur/Kalligraphie/...) werden nicht gebraucht.)
- [x] Wir bräuchten ein Tool, das die Beschriftungen optisch anpasst. Dazu soll unser Renderer das Ergebnis mit Mathjax vergleichen und die Unterschiede minimieren.
      (`scripts/mathjax-compare.mjs` gebaut + genutzt - das Ergebnis war aber
      "die Unterschiede lohnt es nicht klein zu tunen, echtes MathJax +
      Cache ist der einfachere Weg" (siehe Diskussion unten). Für die
      Achsen-Beschriftung damit erledigt/überholt; für die Zahlentafel-
      Hoch-/Tiefstellung (HUD, eigener Renderer bleibt) weiterhin nützlich.)
  - [x] Das Tool sollte zur Dokumentation das Ergebnis einer Reihe von Ausdrücken als Bilder ablegen:
    - [x] Schräger Bruch: 1/128
    - [x] Gerader Bruch mit Exponent: (1/10)^3
    - [x] Buchstabe/Zahl mit Exponent: l^2 , 2^18, 10^5
    - [x] Zahl mit Subscript: 1,41_10
Hier sind Verbesserungsvorschläge:
- [x] Farbe: sollte einfach schwarz sein.
- [x] Noch nicht gerenderte Schalen sollen nicht beschriftet werden.
- [x] kein Unterschied zwischen Zahlendarstellung im einheitsquadrat und den Schalen
- [x] linke Seite soll nicht gerade Brüche sondern schräge Brüche (einzeilig) nutzen. diese brauchen weniger Höhe.
- [x] untere Beschriftungen
  - [x] die Klammern sind viel zu fett
  - [x] die Brüche könnten etwas größer sein
  - [x] die Brüche sollen zentriert in der Klammer sein

- [x] Der Schalter "Beschriftung an/aus" soll weich animiert sein (Einblendung über alpha-Kanal). Siehe dazu auch "Alternative Zoom-Steuerung.md".

## Ergenisse / Diskussion

Die Mathjax-Ergebnisse sehen so viel besser aus. Ich frage mich, ob für die Achsenbeschriftungen wir nicht einen Mathjax-Cache implementieren sollten. Eventuell lohnt es sich nicht, wirklich alles nachzuimplementieren. Was meinst du?

> Yes — a MathJax cache is genuinely the better approach here, and probably better than continuing to hand-tune the approximation. The label set is small and finite (bounded by base/depth), so you can render each distinct expression through MathJax **once** (e.g. via its SVG output, converted to an image), cache it in a `Map`, and just `ctx.drawImage()` it every frame — that's cheap, unlike per-frame `typesetPromise`, which was the actual perf problem, not MathJax itself.
> Main tradeoff: it brings MathJax back as a dependency (bundle size, and a bit of async/cache-invalidation plumbing when base/depth changes), versus the current approach which is dependency-free but requires ongoing manual tuning to chase MathJax's exact look. Given how much fiddly centering/scaling work we just did and still didn't fully nail, I'd lean toward the cache — but happy to keep polishing the hand-built renderer instead if you'd rather avoid the MathJax dependency entirely. Which way do you want to go?

Für die Darstellung im HUD reicht kein Cache. Dafür brauchem wir unsere eigenen Renderer. 
Es spricht nichts gegen die Nutzung von Mathjax außer Performance. Wenn Caching ausreicht, ist das der einfachere Weg. 
Wir brauchen auch keinen Fallback-Renderer, solange Mathjax oder Fonts nicht geladen sind. Solange warten wir einfach. Das sollte beim zweiten Aufruf der Seite ja alles im Cache sein.

### Umsetzung: echtes, gecachtes MathJax für die Achsen-Beschriftung

- **`@mathjax/src`** (v4, Apache-2.0, Nachfolger des deprecated `mathjax-full`)
  als echte Laufzeit-Abhängigkeit, aber NUR dynamisch importiert
  (`src/lib/mathJaxRenderer.js`) - der schwere Teil (TeX-Parser + SVG-
  Renderer, ~1,3 MB minifiziert/~470 KB gzip) landet dadurch in einem
  eigenen Chunk, der nur bei einem echten Cache-Miss nachgeladen wird, NIE
  im Haupt-Bundle.
- Zwei Cache-Ebenen (`src/lib/mathJaxLabelCache.js`):
  1. In-Memory (`Map`) - sofortiger synchroner Zugriff im Render-Loop.
  2. IndexedDB (`src/lib/mathJaxImageCache.js`) - übersteht Reloads. Per
     E2E-Test verifiziert (`tests/e2e/sqrt2.e2e.test.js` "MathJax-Renderer
     lädt einmalig"): der 2. Seitenaufruf lädt den MathJax-Chunk gar nicht
     mehr, alle Beschriftungen kommen aus IndexedDB.
- Kein Fallback-Renderer: `TargetBankCanvas.svelte` zeichnet ein Label nur,
  wenn `getLabelImage()` bereits etwas liefert (synchron); sonst wird
  `requestLabelImage()` angestoßen und der Frame zeigt das Label einfach
  noch nicht - taucht dann in einem der nächsten Frames automatisch auf.
- "Schräger Bruch" als TeX: `{}^{a}/_{b}` (OHNE `\!` - das erzeugte einen
  Rendering-Defekt, siehe Testreihe im Gesprächsverlauf) - MathJax hat kein
  eingebautes Kommando dafür.
- Der alte Hand-Nachbau (`mathCanvasRenderer.js` layoutFraction/
  layoutFractionPower/layoutSlashFraction + zugehörige draw*-Funktionen)
  wurde ENTFERNT (nicht mehr gebraucht) - nur `layoutScript`/`drawScript`
  bleiben (Zahlentafel-Hoch-/Tiefstellung im HUD).
- **Bekannte Nebenwirkung:** echtes MathJax rendert manche Ausdrücke etwas
  BREITER als der alte Hand-Nachbau - bei sehr schmalen Zellen (tiefe
  Exponenten) kann eine Beschriftung dadurch knapp nicht mehr passen (der
  "wenn die Breite reicht"-Test greift dann öfter). Das ist die korrekte,
  gewollte Konsequenz des genaueren Renderings, kein Bug.
