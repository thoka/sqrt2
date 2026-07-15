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
   vorhanden (aber `package-lock.json` existiert auch → npm derzeit genutzt).
3. **Vitest (jsdom) + Playwright E2E** → beides läuft (`npm test` = node --test
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

## 4. Neubewertung der Tooling-Schlüsse (Realität vs. Dokumentation)

| Dokumentiert (Regel B: pnpm) | Real genutzt (package.json scripts) |
|---|---|
| `pnpm install` / `pnpm dev` / `pnpm build` / `pnpm test` | `npm install` / `npm run dev` / `npm run build` / `npm test` |
| `pnpm test:e2e` | `pnpm test:e2e` (funktioniert, da Playwright global) |

**Diskrepanz:** `package.json` Scripts nutzen `npm`/`vite` direkt, aber
`pnpm-lock.yaml` + `pnpm-workspace.yaml` + `mise.toml` (pnpm 11) existieren.
Entweder Scripts auf `pnpm` umstellen **oder** pnpm-Artefakte entfernen.

**Regel A (Konservativ) bleibt gültig** - Vite 7, Svelte 5, Vitest 4 sind
stabile Majors. Vite 8/Rolldown-Sprung ist **nicht mehr anstehend** (Migration
erledigt, Playwright-Gate existiert).

## 5. Nächster Schritt (Dokumentation/Code-Hygiene)

- Package-Manager-Entscheidung treffen: `npm` (Scripts anpassen, pnpm-Lockfiles
  löschen) **oder** `pnpm` (Scripts auf `pnpm` umstellen, `package-lock.json`
  löschen) - aktuell inkonsistent.
- Toter SYSTEM-C-Renderblock in `sqrt2.html` aufräumen (Code-Hygiene, GOTCHA #1).
- `TOOLING_SPEC.md` Status auf "Abgeschlossen" setzen (Phase 0-5 erledigt).
