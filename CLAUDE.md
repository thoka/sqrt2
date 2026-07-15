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

## Layout-Umordnungen mehrerer Objekte: Masse/Trägheit statt Förderband

Wenn ein automatisierter Vorgang MEHRERE Objekte gleichzeitig neu anordnet
(Lücken schließen, Umsortieren, o.ä.), NICHT alle gleich behandeln oder
"alles nach einer festen Regel verschieben" (z.B. "alles ab hier rutscht um
X" - ein reines Förderband/Prefix-Sum-Verfahren). Stattdessen wie ein
physikalisches System denken: die Transformation wird über den
GRÖSSEN-/MASSE-GEWICHTETEN Schwerpunkt definiert. Große (schwere) Objekte
bekommen dadurch am wenigsten Beschleunigung - sie bleiben nahezu fix,
kleine/leichte Objekte übernehmen den Großteil der Bewegung. Das Ergebnis
muss sich so anfühlen, als hätten die Objekte Gewicht, nicht als würden sie
willkürlich/mit roher Gewalt durch die Gegend geschoben.

**Warum:** In der Kompaktierung (`buildCompactionMap()` in `bank-core.js`)
verschob das ursprüngliche Prefix-Sum-Verfahren (Gruppe 0 fix bei Koordinate
0, jede Lücke schließt sich, indem ALLES danach nachrückt) beliebig GROSSE
Flächen, nur weil irgendwo weit VOR ihnen ein winziges Stück verschwand -
sichtbar als "große Elemente werden sehr schnell bewegt". Fix: die
zusammenhängende Gruppe mit der größten Gesamtfläche ist der Anker und
bleibt an ihrer eigenen (unveränderten) Koordinate; alle anderen Gruppen
werden lückenlos an sie herangerückt.

**Wie anwenden:** Bewusst zustandslos lösbar (wie der Rest von
`bank-core.js`) - der Anker wird bei jedem Aufruf frisch aus den aktuell
sichtbaren/relevanten Objekten bestimmt, keine über die Zeit mitgeführte
Position pro Objekt nötig. Der Anker bleibt zwischen benachbarten
Zeitpunkten "for free" stabil, solange sich seine Mitgliedschaft nicht
ändert (Regelfall) - wechselt der schwerste Teil doch einmal, ist das
einfach ein weiterer, ganz normal weich überblendeter Übergang.

## Einstellungen & URL-Zustand: EIN Objekt statt mehrerer Listen

Jede einstellbare Größe (Compiler-Input, Checkbox, Laufzeit-Zustand wie
"spielt gerade ab") gehört in EIN einziges Array (`SETTINGS` in
`sqrt2.html`) mit `{ key, phase, get(), set(v) }` - NICHT in mehrere parallel
gepflegte Listen (eine für `<input>`-Felder, eine für Checkboxen, eine für
den URL-Export, ein eigener Init-Block für alles, was erst nach dem
Kompilieren gültig ist). Zwei generische Funktionen (`applyPhase(phase)` zum
Einlesen, `buildStateParams()` zum Exportieren) laufen über dieselbe Liste.

**Warum:** vier von Hand synchron gehaltene Stellen für dieselbe
Einstellung sind fehleranfällig (eine neue Einstellung wird leicht in einer
Liste ergänzt, in einer anderen vergessen) und genau das ist passiert - der
Wiedergabe-Zustand ("läuft die Animation") hatte gar keine URL-Anbindung,
ein geteilter Link fror zwar die Zeitposition ein, startete sie aber nie.

**Wie anwenden:** neue Einstellung → ein neuer `SETTINGS`-Eintrag, fertig.
Reine `<input>`/`<select>`/Checkbox-Bindungen über die `bindEl()`-Hilfsfunktion
abkürzen. Alles, was von einer erst noch zu berechnenden Simulation abhängt
(oder reiner Laufzeit-Zustand ist), bekommt `phase: 'post'` und wird NACH
dem Kompilieren angewendet; alles andere `phase: 'pre'`, GANZ am Anfang.
Sonderfälle (z.B. ein alternativer URL-Parameter wie `tick` statt `time`)
gehören als `resolveFromUrl()`-Hook AUF den jeweiligen Eintrag, nicht als
Extra-`if`-Zweig außerhalb der generischen Schleife - sonst wächst dieselbe
Zersplitterung an anderer Stelle einfach nach.

## Tooling-Updates: kleinstmöglicher sicherer Versionssprung, nicht blind "latest"

Beim Hinzufügen/Aktualisieren von Build-Tooling (Vite, Bundler, Test-Runner,
…) NICHT automatisch die `latest`-Version nehmen, wenn eine ältere,
noch aktuelle Major-Version die eigentliche Anforderung genauso erfüllt und
dabei einen Architekturwechsel vermeidet.

**Warum:** Beim Svelte-Tooling-Umbau (siehe `TOOLING_SPEC.md`) war
`vite@8` (Rolldown-Bundler statt Rollup/esbuild) bereits `latest` auf npm,
`vite@7.3.6` nur `previous` - obwohl 7.x zum Umsetzungszeitpunkt (Juli 2026)
noch eine aktuelle, unter aktiver Pflege stehende Major-Version war. Der
eigentliche Bedarf (Svelte-Plugin ergänzen) hatte mit dem Rolldown-Wechsel
nichts zu tun; ein Bundler-Architekturwechsel am bestehenden,
funktionierenden Zwei-Seiten-Build wäre unnötiges Risiko für den eigentlichen
Task gewesen.

**Wie anwenden:** Vor einem Versions-Bump (insbesondere über eine
Major-Grenze) kurz prüfen: (1) `npm view <pkg> dist-tags` - gibt es eine
`previous`/vorletzte Major-Version, die noch aktuell ist? (2) Ändert der
Sprung auf `latest` die zugrundeliegende Architektur (Bundler-Engine,
Rendering-Modell, o.ä.) oder nur Features/Fixes? Bei (2) = Architekturwechsel
UND der Task braucht das nicht: die kleinere, noch aktuelle Version wählen
und die Abwägung im jeweiligen Spec-Dokument festhalten (siehe
`TOOLING_SPEC.md` Abschnitt 6 als Beispiel), damit eine spätere bewusste
  Aktualisierung nicht als vergessen wirkt.

## Tooling: Lern-Horizont des Users (Antagonist zur Konservativ-Regel)

Die Konservativ-Regel (oben) ist der Default für reine Codegen-Sicherheit,
aber es ist **ebenso legitim, das zu nutzen, was der User lernen möchte**.
Nord-Stern dafür ist die Tooling-Welt von **Discourse** (Forum-Software, die
der User nutzt/kennt): Discourse ist selbst sehr konservativ, ist aber vor
einiger Zeit auf **pnpm** umgestiegen. Daraus abgeleitet:

- **pnpm ist der Paketmanager der Wahl**, auch wo npm nach der
  Konservativ-Regel „am eingesunkensten" wäre. Begründung: bewusste
  Lern-/Ausrichtungs-Entscheidung des Users, nicht technische Notwendigkeit;
  pnpm ist zudem gereift und bringt bessere Reproduzierbarkeit
  (content-addressable Lockfile, strikte `node_modules` ohne Phantom-Deps).
- Andere Discourse-Stack-Bestandteile (Ember, Rails, PostgreSQL, Redis) werden
  NICHT auf dieses Svelte-Projekt portiert - es zählt nur die *Haltung*
  (konservativ + bereit, pnpm als Modernisierung mitzunehmen).

**Anwendung:** Regel A gilt, bis der User ein Lernziel nennt (hier: pnpm/
Discourse-Welt) - dann darf Regel B sie überschreiben. Siehe
`TOOLING_ENV_SPEC.md` für die vollständige Philosophie + die Planung der neuen
Coding-Instanz.

**Umgebungs-Bedingtheit:** Der bisherige Vite-7-Halt (kein Rolldown-Risiko)
war an den **veralteten System-Unterbau** dieser Sandbox gekoppelt, auf dem
kein Browser/Playwright lauffähig ist (keine visuelle Verifikation möglich).
Auf einer modernen Instanz (siehe `TOOLING_ENV_SPEC.md`, Basis arch/cachedos)
entfällt dieser Grund, sofern Playwright den Build absichert - dort ist ein
bewusster Vite-8-Sprung (gekoppelt mit passendem `vite-plugin-svelte` + Vitest
5) vertretbar.

## Svelte-Komponenten-Tests: vitest + jsdom, keine zusätzliche Testing-Library

Für Svelte-5-Komponenten (`src/**/*.svelte`) werden Tests mit `vitest` +
`environment: 'jsdom'` geschrieben, direkt mit Sveltes eigenen
`mount()`/`unmount()`/`flushSync()`-APIs (siehe `src/App.test.js`) - NICHT
mit `@testing-library/svelte` oder Playwright/Browser-Mode.

**Warum:** Das ist die offizielle Svelte-5-Empfehlung (svelte.dev/docs/svelte/testing)
und kommt ohne zusätzliche Abhängigkeit aus. Passt außerdem zum bestehenden
Projekt-Grundsatz, keine schwergewichtigen Browser-Test-Harnesses
(Playwright o.ä.) unaufgefordert aufzusetzen.

**Wie anwenden:** Reine Logik-Module (`bank-core.js`, `smoothing.js`,
`src/lib/compiler.js`, …) bleiben bei `node --test` mit Test-Dateien auf
Root-Ebene (`*.test.js`, per `pnpm test`). Svelte-Komponenten-Tests laufen
separat über `vitest run` (ebenfalls Teil von `pnpm test`), Dateien unter
`src/**/*.test.js` (siehe `vite.config.js` `test.include`). Beide Runner
bewusst nebeneinander, nicht vereinheitlicht - unterschiedliche Aufgabe
(reine Funktionen vs. Komponenten mit DOM-Mounting).
