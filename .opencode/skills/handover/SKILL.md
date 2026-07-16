---
name: handover
description: Führt eine saubere Sitzungsübergabe durch - aktualisiert die Projektdokumentation (TOOLING_SPEC.md Status, ggf. README/CLAUDE.md/CI) und kompaktiert die Agentenregeln in AGENTS.md. Nutzen am Ende einer abgeschlossenen Arbeitsphase oder vor einem Kontextwechsel/neuen Thread.
license: MIT
compatibility: opencode
metadata:
  audience: maintainers
  workflow: handover
---

# Handover (Sitzungsübergabe)

Wiederholbarer Workflow, damit ein neuer Agent den Stand ohne Wissensverlust
aufnehmen kann. Zwei Bestandteile: **Doku updaten** + **Agentenregeln
kompaktieren**.

## Wann

- Am Ende einer abgeschlossenen Arbeitsphase (siehe Commit-Regel in AGENTS.md).
- Vor einem Kontextwechsel / neuem Thread (z.B. Risiko- oder Architektur-
  wechsel wie Vite 8).
- Wenn AGENTS.md / TOOLING_SPEC.md ausufern oder veraltete Notizen enthalten.

## 1. Dokumentation updaten

- **TOOLING_SPEC.md** (lebendiges Migrations-Doc): bei JEDEM erledigten Schritt
  den Status + "Nächster Schritt" aktualisieren; die Phasen-Tabelle auf
  "erledigt" setzen. Neue Erkenntnisse / Entscheidungen (z.B. Sync-Design,
  Vite-Version) dort festhalten, nicht nur im Chat.
- Falls betroffen: **README.md** / **CLAUDE.md**, **.github/workflows/**
  (CI-Schritte), **scripts/**.
- Commits im Repo-Stil kurz halten; `git log` als Vorbild.

## 2. Agentenregeln kompaktieren (AGENTS.md)

- **Redundanzen entfernen:** gleiche Info nicht mehrfach (z.B. Paketmanager,
  PATH nur einmal).
- **Strahler formulieren:** GOTCHAS/Regeln auf das Nötigste, Signal erhalten.
- **Neue Stolpersteine** als eigene Sektion ("Frischer Start") ablegen - vor
  allem Dinge, die beim nächsten Start Zeit kosten (z.B. `mise trust` einmalig,
  E2E-stale-dist durch `reuseExistingServer`, offene Reste wie toter Code).
- **Veraltete Notizen korrigieren** (z.B. Branch-Status: Arbeit findet auf
  Feature-Branches statt, nicht auf `main`).
- **Nichts Neues erfinden:** nur existierendes Wissen kondensieren, keine
  neuen Konventionen einführen.

## 3. Lessons-learned kompakt ablegen

Während der Iteration aufkommen: welche Erkenntnis hätte den Start / das
Vorankommen **beschleunigt**? Diese kompakt an den passenden Ort schreiben,
damit der nächste Agent sie nicht neu erarbeiten muss.

- **Umgebungs-/Setup-Fallen** (once-only Trust, stale E2E-dist, pnpm-only,
  mise/PATH) → AGENTS.md, Sektion „Frischer Start" bzw. GOTCHAS.
- **Architektur-/Migrations-Entscheidungen** (Sync-Design, Vite-Version,
  Store-Grenzen) → TOOLING_SPEC.md an der zugehörigen Phase.
- **Lokal zum Code gehörige Hinweise** (warum ein Workaround nötig, wo ein
  Port unvollständig ist) → sparsamer Kommentar direkt am Betroffenen Code
  oder GOTCHAS.
- **Regel:** ein bis zwei Sätze reichen; nicht ausufernd. Keine Secrets/Keys.
  Lieber eine präzise GOTCHA-Zeile als ein langer Essay.

## 4. Abschluss

- Pro Phase **committen** (Commit-Regel beachten): nur die phasen-zugehörigen
  Dateien (`git add` einzeln, NICHT `git add -A`); Message kurz im Repo-Stil.
  Nicht pushen/amenden, keine leeren Commits, keine Secrets.
- **Qualitäts-Gate grün:** `pnpm check` (svelte-check + eslint + knip) plus
  `pnpm test` + `pnpm test:e2e` falls sich Verhalten geändert hat.
- Dem nächsten Agenten eine **kurze Zusammenfassung** mitgeben: was erledigt
  ist, was offen ist (Phase 6 / Risiko-Themen), und welche Stolpersteine warten.
