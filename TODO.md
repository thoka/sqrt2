# TODO — √2-Exponat

Offene Punkte, nach Relevanz sortiert. Erledigtes wird durchgestrichen
(`~~`). Jede Stufe bekommt eigene Tests (Unit und/oder e2e) — siehe
`AGENTS.md` ("Tests für alle Stufen"). Vor Commit: `pnpm format` + `pnpm check`.

---

## Pflicht (nächste Stufen)

- [ ] **TODO.md anlegen** — diese Datei (erledigt beim Anlegen).
- [ ] **README.md auf Stand bringen**: `sqrt2.html` ist nicht mehr Haupttool
      (Svelte-Dev-Server / `dist/`), Phase 5 (Fernsteuerung) ist **umgesetzt**,
      embedded Relay einbauen. Verweis auf `docs/DEPLOYMENT.md`.
- [ ] **Phase 6 „Politur"**: Widget-Auswahl-UI im `ControlPanel` (nicht nur
      `restwidget`-URL-Param) — z.B. sanfter Umschalt-Dialog für
      Rest-Bars/Grid. Tests: Svelte-Component-Test.
- [x] **`bank-core.js` → `src/lib/` migriert** (ES-Modul-Struktur, von
       `TargetBankCanvas` importiert statt global). Tests nachgeführt.
- [x] `smoothing.js` → `src/lib/` migriert
      Import-Pfade in `TargetBankCanvas.svelte` anpassen.

## Fernsteuerung / Connection (Nachpflege)

- [ ] **`RemoteControl` als Route foldbar** machen (im Exponat ein-/ausklappbar,
      nicht nur separater Tab) — UX für „Gast-Steuerung direkt am Exponat".
- [ ] **Rate-Limit-Test** für Token-Minting (massenhaft `POST /api/token`)
      existiert als Server-Test (`test-api.mjs`); als E2E-Doku in
      `DEPLOYMENT.md` verlinken.
- [ ] **Tailscale/TLS-Setup** für echtes Handy dokumentieren + scripten
      (`infra/connection-service/setup-tailscale.sh`, `tailscale cert` →
      `TLS_CERT`/`TLS_KEY`). Aktuell nur §5 in DEPLOYMENT.md beschrieben.
- [ ] **Exponat-Key-Management**: wie kommt `API_KEYS` sicher aufs Gerät?
      (`.env`-Vorlage, kein Commit) — `infra/connection-service/.env.example`.
- [ ] **Relay-Status im Exponat** sichtbar machen (Gast-Zahl Live, Verbindungs-
      State) — aktuell nur in `RemoteControl` (`#relayStatus`).

## CODE-QUALITÄT / REFACTOR

- [ ] **Ungenutzte `GLOBAL_*` in `TargetBankCanvas.svelte`** aufräumen
      (nur ESLint-Warnungen, AGENTS.md „Stolpersteine").
- [ ] **Toter Code in `sqrt2.html`**: ausgelagerter alter SYSTEM-C-Renderblock
      (AGENTS.md) entfernen oder als Referenz extrahieren.
- [ ] **`p.html`** (verworfenes Prototyp) — löschen oder nach `docs/`-Archiv.
- [ ] **`selection_strategy_prototype.html`** — in `src/` / `docs/` ordnen,
      da kein Haupt-Tool mehr.

## DOKUMENTATION

- [ ] **`docs/DEPLOYMENT.md`** als zentrale Betriebs-Anleitung — erstellt,
      aber noch mit README/TOOLING-SPEC cross-verlinken.
- [ ] **`docs/TOOLING_SPEC.md`** Phase 8 (embedded Relay) + Phase 6-Status
      konsistent halten.
- [ ] **`docs/CONNECTION_SERVICE_SPEC.md`** §10/§12 mit DEPLOYMENT.md verknüpfen.
- [ ] **README §10 „Zukünftige Vision"** aktualisieren: Mehrbildschirm/QR als
      erledigt markieren, Phase 6 als offen.

## NICHT ZWINGEND (später)

- [ ] **Tiefe-Standardwert** Haupttool (`3`) vs Test-Tool (`10`) synchronisieren
      (offene Entscheidung, README §10).
- [ ] **Z/R-Modi neu (C¹)**: Alpha-Rampen auf Smoothstep statt linear (§7).
- [ ] **Admin-konfigurierbare Steuerungs-Komplexität** (welche Regler sichtbar)
      — baut auf Store-Architektur auf.
- [ ] **Persistente Token-Store** (RAM-only bewusst einfach) — nur bei Bedarf.
