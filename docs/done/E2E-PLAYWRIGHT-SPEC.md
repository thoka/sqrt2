# E2E Playwright Problem-Spec

## Status: GELÖST

Root Cause gefunden und gefixt. `pnpm test:e2e` läuft jetzt vollständig durch
(kein Hang mehr) - siehe "Root Cause" und "Fix" unten.

## Root Cause

Diese Sandbox läuft unter **WSL2 mit gespiegeltem Networking** (erkennbar an
einem zusätzlichen `loopback0`-Interface neben `lo` sowie einer
Tailscale-Adresse auf `eth2`). In dieser Konfiguration liefert der Kernel für
TCP-Verbindungen zu **geschlossenen Loopback-Ports kein RST/ECONNREFUSED**,
sondern die Verbindung hängt dauerhaft im Zustand `SYN-SENT` (verifiziert
mit `ss -tap` während des Hangs sowie mit einem rohen `/dev/tcp`-Verbindungsversuch
gegen einen garantiert geschlossenen Port - beide hängen unbegrenzt, obwohl ein
normaler Linux-Kernel hier sofort "connection refused" liefern würde).

Playwrights `config.webServer`-Logik (`playwright-core/lib/coreBundle.js`,
Funktion `httpStatusCode` bzw. `isURLAvailable`) prüft vor dem Start des
Server-Prozesses per rohem `http.request`, ob die Ziel-URL schon erreichbar
ist (`WebServerPlugin._startProcess`, `playwright/lib/runner/index.js`):

```js
const isAlreadyAvailable = await this._isAvailableCallback?.();
```

Dieser Aufruf setzt **keinen `socketTimeout`** (das Options-Objekt für
`httpRequest` enthält nur `url`, `headers`, `rejectUnauthorized` - kein
`socketTimeout`, obwohl `httpRequest` das Feld unterstützen würde). Der
Request wartet daher ausschließlich auf die Events `'response'` oder
`'error'` des Sockets. Da in dieser Umgebung nie ein `'error'`
(ECONNREFUSED) kommt, hängt genau dieser `await` für immer - **noch bevor**
der eigentliche `webServer.command`-Prozess überhaupt gestartet wird. Das
erklärt exakt das beobachtete Symptom: kein Output, kein Kindprozess, kein
Port-Listener, kein Timeout-Fehler (der 15s-`timeout` aus der Config greift
erst in `_waitForProcess`, das nie erreicht wird) - nur SIGTERM/SIGKILL von
außen beendet den Prozess.

Das ist also **kein Bug in Playwright, pnpm, Chromium oder dem Projekt**,
sondern eine Eigenheit dieser WSL2-Sandbox: geschlossene Loopback-Ports
verhalten sich wie ein Blackhole statt wie "connection refused".

## Fix

`playwright.config.js` verwendet kein `config.webServer` mehr (dessen
Verfügbarkeits-Check ist der hängende Codepfad). Stattdessen startet
`globalSetup` (`tests/e2e/global-setup.js`) den Vite-Preview-Server manuell
per `child_process.spawn` und pollt die Erreichbarkeit mit
`fetch(url, { signal: AbortSignal.timeout(1000) })`. `AbortSignal.timeout`
bricht den Verbindungsversuch nach Ablauf der Frist selbst ab (der lokale
Socket wird zerstört, unabhängig davon, ob der Kernel je ein
TCP-Antwortpaket schickt) - das Promise settled also zuverlässig, im
Gegensatz zu Playwrights ungebremstem `http.request`. Verifiziert per
Mini-Skript: `fetch` mit `AbortSignal.timeout(1000)` gegen einen
geschlossenen Port rejected zuverlässig nach ~1000ms.

Playwright selbst beendet den Prozess am Ende eines Runs ohnehin über
`gracefullyProcessExitDoNotHang` (`playwright/lib/runner/index.js`), wartet
also nicht auf ein natürliches Drainen der Event-Loop - liegen gebliebene
halb-offene Sockets aus fehlgeschlagenen Poll-Versuchen verhindern daher
keinen sauberen Exit am Ende des Runs.

`globalSetup` gibt eine Teardown-Funktion zurück (`() => server.kill()`),
die Playwright automatisch nach dem Run aufruft (Standard-Verhalten bei
Function-Return aus `globalSetup`).

## Alternative: WSL2 Mirrored Mode abschalten (verworfen, für später notiert)

Statt (oder zusätzlich zu) dem Repo-Fix könnte man den Root Cause direkt an
der Quelle beheben: `networkingMode=mirrored` in `%UserProfile%\.wslconfig`
(Windows-Seite) auf NAT umstellen + `wsl --shutdown`. Das würde echtes
ECONNREFUSED für alle Tools zurückbringen, nicht nur für Playwright.

**Bewusst nicht umgesetzt:**

- Mirrored Mode ist auf dieser Maschine sehr wahrscheinlich bewusst *für
  Tailscale* aktiviert (gemeinsame IP-Sicht Windows/WSL2, Subnet-Routing,
  MagicDNS) - ein Wechsel auf NAT riskiert, Tailscale-Konnektivität aus WSL2
  heraus zu brechen.
- Die Änderung liegt außerhalb dieses Repos (Windows-Host-Config) und
  betrifft die ganze Maschine (alle WSL-Distros), nicht nur dieses Projekt -
  von der Sandbox aus weder einsehbar noch verifizierbar.
- Der Repo-Fix (`globalSetup` + `fetch`/`AbortSignal.timeout`) behebt das
  Symptom bereits vollständig für `pnpm test:e2e`, unabhängig vom
  Host-Networking - macht den riskanteren, maschinenweiten Eingriff für
  dieses Projekt unnötig.

Falls zukünftig andere Tools (nicht nur Playwright) unter demselben
Blackhole-Verhalten leiden, ist das der Punkt, an dem sich der
NAT-Wechsel trotz des Tailscale-Risikos neu abwägen lässt - dann aber
bewusst und geprüft auf der Windows-Seite, nicht aus dieser Sandbox heraus.

## Verifiziert

```
pnpm build
node node_modules/@playwright/test/cli.js test --reporter=line
# → 14 Tests, läuft in ~40s durch (vorher: unbegrenzter Hang)
```

## Nebenbefund

Mit funktionierendem E2E sind bei diesem Lauf 2 echte Testfehler sichtbar
geworden (reproduzierbar auch mit `--workers=1`, also keine
Parallelitäts-Flakiness):

- `async-compile.e2e.test.js:109` "Kriterium 8: alte Darstellung bleibt
  sichtbar bis zum fertigen Ergebnis" - Canvas wird während Kompilierung blank.
- `sqrt2.e2e.test.js:49` "Canvas zeigt zwei weisse Quadrate nach
  Initialisierung" - Timeout, Canvas rendert nie.

Beide betreffen den Compaction-Renderpfad in `TargetBankCanvas.svelte` /
`compiler.js`, passend zum letzten Commit vor diesem Fix
(`3e6daf8 kein Nicht-Kompaktierungs-Modus: Kompaktierung immer aktiv,
Renderer nutzt compacted rects`) und genau der in AGENTS.md dokumentierten
Gefahr ("Änderungen am Renderer... können kaputt gehen ohne dass ein Test es
meldet"). Das ist ein separates, inhaltliches Problem - nicht Teil dieser
E2E-Infrastruktur-Spec.
