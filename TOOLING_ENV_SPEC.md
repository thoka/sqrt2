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

## 2. Ausgangslage: diese Sandbox (Playwright lauffähig)

Diese Sandbox hat **keinen blockierenden veralteten Unterbau mehr**:
- Playwright + Chromium (Chrome for Testing) laufen via globalem Cache
  `~/.cache/ms-playwright/chromium-1228` (kein DBus/Netzwerk-Blocker).
- `pnpm test:e2e` (3 Tests) ist **grün** - visuelle/Browser-Verifikation ist möglich.

Damit entfällt die bisherige Begründung für extrastrenge Konservativität
(npm, Vite 7 gehalten, weil Risiken nicht prüfbar waren).

## 3. Tooling-Status (keine neue Instanz nötig)

Die in §2 der ursprünglichen Version geplanten Punkte sind **hier bereits erfüllt**:

1. **Playwright/Chromium lauffähig** → `pnpm test:e2e` funktioniert.
2. **Node + pnpm**: Node 22 verfügbar; `pnpm-lock.yaml` + `pnpm-workspace.yaml`
   vorhanden; `package-lock.json` ist entfernt + gitignored.
3. **Vitest (jsdom) + Playwright E2E** → beides läuft (`pnpm test` = node --test
   + vitest; `pnpm test:e2e` = Playwright).
4. **Reproduzierbarkeit**: `mise.toml` pinnt Node 22 / pnpm 11; `.envrc`
   aktiviert via `mise`/`direnv`.
5. **E2E-Smoke-Pfad** → `pnpm test:e2e` über `dist/sqrt2.html` deckt
   Canvas-Rendering + Rest-Widget + BroadcastChannel-Sync ab (3 Tests grün).

### Was das freischaltet (bereits aktiv)
- Visuelle Korrektheit (Canvas-Skalierung, Loop-Sync, Auto-Zoom, Grid-Platzierung)
  per Playwright testbar.
- Vite 8 / Rolldown kann neu bewertet werden (Risiko "kein visueller Check"
  entfällt) - aber Migration ist erledigt, Sprung nicht mehr nötig.

## 4. Tooling-Entscheidungen (aktueller Stand)

| Entscheidung | Begründung |
|---|---|
| **pnpm** als Paketmanager | Bewusste Lern-/Ausrichtungs-Entscheidung (Discourse-Stack); bessere Reproduzierbarkeit (content-addressable Lockfile, strikte `node_modules` ohne Phantom-Deps) |
| **Vite 7** (`^7.3.6`) | `@sveltejs/vite-plugin-svelte@^6.2.4` unterstützt `vite@^6.3.0 || ^7.0.0`; Vite 8s Rolldown-Umstellung ist ein unverbundener Architekturwechsel |
| **Svelte 5** (`^5.56.5`) | Neuanlage, kein Migrationsdruck; aktuelle Major-Version |
| **Plain JS** | Konsistenz mit `bank-core.js`/`smoothing.js` |
| **vitest + jsdom** | Offizielle Svelte-5-Empfehlung; keine zusätzliche Testing-Library nötig |

**Regel A (Konservativ) bleibt gültig** - Vite 7, Svelte 5, Vitest 4 sind
stabile Majors. Vite 8/Rolldown-Sprung ist **nicht mehr anstehend** (Migration
erledigt, Playwright-Gate existiert).

## 5. Nächster Schritt (Code-Hygiene)

- Toter SYSTEM-C-Renderblock in `sqrt2.html` aufräumen (Code-Hygiene, GOTCHA #1).
- `TOOLING_SPEC.md` Status auf "Abgeschlossen" setzen (Phase 0-5 erledigt).
