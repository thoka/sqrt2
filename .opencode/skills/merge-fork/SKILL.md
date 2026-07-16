---
name: merge-fork
description: Merge die Arbeit aus einem Fork dieses Repos (Pull hierher ODER Push dorthin) und vereinheitliche im Anschluss die Doku (CLAUDE.md/AGENTS.md/TOOLING_SPEC.md) mit sqrt2 als Kanon. Nutzen, wenn Änderungen zwischen diesem Repo und einem Fork bidirektional synchronisiert werden sollen.
license: MIT
compatibility: opencode
metadata:
  audience: maintainers
  workflow: merge-fork
---

# Merge-Fork (Arbeit aus einem Fork synchronisieren + Doku vereinheitlichen)

Wiederholbarer Bidirektionaler-Workflow: Code aus einem Fork von `sqrt2`
zurückführen (Pull) oder dorthin spiegeln (Push) und danach die
Projektdokumentation vereinheitlichen. `sqrt2` gilt dabei als **Kanon** für
`CLAUDE.md` / `AGENTS.md` / `TOOLING_SPEC.md` — Fork-Doku wird daran
angeglichen, nicht umgekehrt.

## Wann

- Ein Fork enthält Arbeit, die in `sqrt2` fehlt (Pull) oder umgekehrt (Push).
- Nach dem Code-Merge ist die Doku im Fork/Quell-Repo gegen den sqrt2-Kanon
  zu vereinheitlichen (Regeln, GOTCHAS, Phasen-Status).
- Vor einem Commit/PR, damit beide Repos konsistente Agentenregeln haben.

## 0. Vorbereitung

- Arbeitsverzeichnis ist dieses Repo (`sqrt2`). Fork-Pfad/-Remote ermitteln:
  - Lokal: `<fork-pfad>` (z.B. `/home/toka/dv/sqrt2-fork`)
  - Oder Remote: `git remote -v` prüfen, ggf. `git remote add fork <url>`.
- Ziel-Branch kenntlich machen (meist `main`/`master` auf beiden Seiten).
- **Immer `pnpm`, nie npm** (siehe AGENTS.md). Build/Check erst am Ende.

## 1. Fork als Quelle einbinden (idempotent)

Falls noch kein Remote/local-Link:

```bash
# Remote-Variante
git remote add fork <fork-url>      # einmalig
git fetch fork

# ODER lokale Variante (kein Remote nötig)
# Fork wird direkt via Pfad gemergt (siehe Schritt 2)
```

## 2. Merge — bidirektional

### Variante A: PULL (Fork-Arbeit hierher holen)

```bash
git fetch fork
git checkout main                  # Ziel = sqrt2 main
git merge fork/<branch> --no-ff -m "merge: Fork-Arbeit <thema> einfügen"
```

### Variante B: PUSH (hiesige Arbeit in den Fork spiegeln)

```bash
git fetch fork
git checkout <branch>              # z.B. main im Fork
git merge main --no-ff -m "merge: sqrt2-Stand <thema> spiegeln"
git push fork <branch>
```

- Bei Konflikten: auflösen, `git add`, `git commit --no-edit` (oder
  `--no-verify` nur bei pre-commit-Blockade, sonst vermeiden — siehe AGENTS.md).
- **Nie force-push** auf geteilte Branches. Push nur auf Fork, nie auf
  upstream/main ohne expliziten Auftrag.

## 3. Doku vereinheitlichen (sqrt2 = Kanon)

Nach dem Code-Merge die Dokumentation angleichen. Kanon-Quelle in sqrt2:
`CLAUDE.md`, `AGENTS.md`, `TOOLING_SPEC.md`.

- Fork-/Quell-Doku (`<fork-pfad>/AGENTS.md` etc.) gegen sqrt2-Kanon lesen:
  - **Regeln** (Commit-Pflicht, Tests pro Stufe, Thread-Ökonomie, C¹-Smoothing,
    Layout-Regeln, Zahlentafel-aus-Simulation) müssen identisch sein.
  - **GOTCHAS** (compiledStore hat kein depth, derived-Caching, SETTINGS als
    EIN Array, vite@7, Connection-Service embedded, E2E stale dist,
    compiler-split.test.js Timeout) übernehmen.
  - **Phasen-Status** in `TOOLING_SPEC.md` synchronisieren (Phasen 0-5 erledigt,
    Phase 6 Politur offen).
- Fork-spezifische Ergänzungen (eigene Themen des Forks) als separater
  Abschnitt "Fork-spezifisch" belassen — Kanon nicht dadurch verwässern.
- README/CLAUDE.md/AGENTS.md sind laut skills.sh-Konvention wohldefinierte
  Repo-Dateien; Markdown-Linter für diese überspringen.

## 4. Verifikation (Gate)

```bash
pnpm build        # Canvas/DOM-Mount-Pfade nur via Build+E2E verifizierbar
pnpm check        # svelte-check && eslint . && knip && prettier --check .
pnpm test         # node --test (tests/unit/compiler-split.test.js wegen
                  # Timeout 124 AUSSCHLIESSEN: node --test $(ls tests/unit/*.test.js | grep -v compiler-split))
pnpm test:e2e     # nur nach Rebuild + scripts/serve.sh stop (stale dist!)
```

- Vor Commit `pnpm format` (sonst blockt pre-commit-Hook).
- Commit ist Pflicht (siehe AGENTS.md): nur phasen-zugehörige Dateien
  (`git add` einzeln), Message im Repo-Stil, kurz.
- **Nicht** pushen/amenden, keine leeren Commits, keine Secrets.

## 5. Abschluss-Hinweis

Kurz melden: Pull oder Push erfolgt, welche Doku angeglichen, ob gleicher oder
neuer Thread ökonomischer ist (langer Verlauf + andere Domäne → neuer Thread).
