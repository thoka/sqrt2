# Tooling & Coding-Environment-Spezifikation

Stand: 2026-07-15. Ergänzt `TOOLING_SPEC.md` (Migrations-Phasen 0-5) um die
übergeordnete **Tooling-Philosophie** und die **Planung für die neue
Coding-Instanz**. Lebendiges Doc - bei Änderungen den Stand oben aktualisieren.

## 1. Tooling-Philosophie (zwei sich ergänzende Regeln)

### Regel A - Konservativ / tief eingesunken (Default)
Bei API-lastigem Zeug (Build-Tools, Frameworks, Test-Runner, Sprachsyntax)
bevorzugen wir die **gereifte, gut dokumentierte stabile Major** - idealerweise
den `previous`-Dist-Tag oder ein spätes Minor einer etablierten Major, NICHT
die frisch geshippte. Grund: je älter/verbreiteter, desto dichter das
Trainingswissen eines Modells -> weniger halluzinierte falsche APIs (siehe
`CLAUDE.md` "Tooling-Updates"). **Untergrenze:** noch gepflegt/secure, nicht
„uralt/unmaintained".

### Regel B - Lern-Horizont des Users (Antagonist, bewusst)
Es ist **ebenso legitim, das zu nutzen, was der User lernen möchte**. Nord-Stern
ist hier die Tooling-Welt von **Discourse** (der Forum-Software, die der User
nutzt/kennt): Discourse ist selbst sehr konservativ, ist aber vor einiger Zeit
auf **pnpm** umgestiegen. Daraus abgeleitet:
- **pnpm ist der Paketmanager der Wahl**, auch wo npm nach Regel A „am
  eingesunkensten" wäre. Begründung: bewusste Lern-/Ausrichtungs-Entscheidung
  des Users, nicht technische Notwendigkeit; pnpm ist zudem gereift und bringt
  bessere Reproduzierbarkeit (content-addressable Lockfile, strikte
  `node_modules` ohne Phantom-Deps).
- Andere Discourse-Stack-Bestandteile (Ember, Rails, PostgreSQL, Redis) werden
  NICHT auf dieses Svelte-Projekt portiert - es zählt nur die *Haltung*
  (konservativ + bereit, pnpm als Modernisierung mitzunehmen).

**Spannung / Anwendung:** Regel A ist Default für reine Codegen-Sicherheit;
Regel B darf sie überschreiben, SOBALD der User ein Lernziel nennt (hier:
pnpm/Discourse-Welt). Bei unklarem Lernziel gilt A.

## 2. Ausgangslage: veralteter Unterbau (dieser Sandbox)

Die aktuelle Coding-Umgebung hat einen **sehr veralteten System-Unterbau**;
moderne Tooling-Ketten laufen hier kaum/gar nicht:
- headless chromium hängt an DBus/Netzwerk -> **keine visuelle/Browser-
  Verifikation möglich** (bisher nur `npm run build` + `npm test` als Gate).
- Playwright/Browser-Mode daher hier nicht aufsetzbar.
Dadurch war die Tooling-Haltung *de facto* extrastreng (npm, Vite 7 gehalten),
weil Risiken nicht hätten geprüft werden können.

## 3. Neue Coding-Instanz (Basis: arch / cachedos)

Ziel: eine frische Instanz, auf der modernes Tooling leichter lauffähig ist,
damit die Einschränkungen aus §2 wegfallen.

### Was ich mir dafür wünsche (Konkretisierung)
1. **Lauffähiger Browser für Playwright:** installiertes `chromium` (inkl.
   System-Dependencies: libnss3, libatk, libgbm, fonts, …) UND
   `playwright` installierbar (`npx playwright install chromium` erfolgreich).
   -> hebt die „kein Browser"-Blockade; visuelle + E2E-Smoke-Tests werden
   möglich.
2. **Aktuelle Node + pnpm:** Node (Current/LTS) und pnpm global verfügbar;
   das Projekt nutzt künftig pnpm (`pnpm install`, `pnpm dev`, `pnpm build`,
   `pnpm test`).
3. **Vitest + echtes Browser-Env:** `environment: 'jsdom'` bleibt für
   Komponententests, plus Playwright-basierte E2E (`*.e2e.test.js`) als
   zweiter Runner - ersetzt den bisherigen Verzicht auf Browser-Mode.
4. **Reproduzierbare Baseline:** arch/cachedos mit gepinnten Packages
   (Container/Image), damit die Instanz nicht wieder „von allein" veraltet.
5. **E2E-Smoke-Pfad:** ein `pnpm test:e2e` (Playwright) über `dist/sqrt2.html`,
   der Canvas-Rendering + Rest-Widget + Playback zumindest per
   Screenshot/DOM-Assertions prüft - schließt die Lücke, die hier (ohne
   Browser) offen blieb.

### Was das freischaltet
- Die bisher **nicht verifizierbare visuelle Korrektheit** (Canvas-Skalierung,
  Loop-Sync mit playbackStore, Auto-Zoom, Grid-Platzierung) lässt sich endlich
  testen.
- Der **Vite-8-Halt** (Rolldown) kann neu bewertet werden: der Hauptrisiko-
  grund (kein visueller Check) entfällt, sofern Playwright den Build abdeckt.

## 4. Neubewertung der bisherigen Tooling-Schlüsse

Die im Gespräch getroffenen Aussagen waren an den **veralteten Unterbau**
gekoppelt. Auf der neuen Instanz:

| Bisher (veralteter Sandbox) | Neu (arch/cachedos + Playwright) |
|---|---|
| npm („am eingesunkensten") | **pnpm** (Regel B / Discourse-Lernziel) |
| Vite 7 gehalten (Rolldown-Risiko nicht prüfbar) | Vite 8 *möglich*, sofern Playwright den Build absichert - bewusster, gekoppelter Sprung (Vite 8 + passendes `vite-plugin-svelte` + Vitest 5), nicht blind |
| Keine Browser-/Visuelle-Verifikation | Playwright-E2E + Screenshots möglich -> visuelles Gate vorhanden |
| `npm test` = node --test + vitest | `pnpm test` + zusätzlich `pnpm test:e2e` (Playwright) |

**Regel A (Konservativ) bleibt gültig** als Default für reine
Codegen-Sicherheit - sie rechtfertigt z.B. weiterhin, nicht auf die
allernächste Major jedes Tools zu springen. Aber die *Härte* der Haltung war
umgebungsbedingt; auf der modernen Instanz darf (und soll) modernisiert werden,
solange Playwright die Korrektheit absichert.

## 5. Nächster Schritt
- Neue Instanz (arch/cachedos) aufsetzen, Punkt 1-5 aus §3 erfüllen.
- Sobald Playwright grün ist: Vite-8-Sprung als gekoppelten Bump planen
  (eigenes Spec/Commit) und per `pnpm test:e2e` absichern.
