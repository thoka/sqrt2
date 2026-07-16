# √2-Flächenmodell-Exponat

## 1. Projektziel

Interaktive Visualisierung von √2 als Beispiel einer irrationalen Zahl, für
Science-Center/Schul-Kontext. Kernidee: √2 wird ziffernweise (digit-by-digit)
über ein geometrisches Flächenmodell konstruiert (Montessori-Stil: "Papier
schneiden und neu zusammenlegen"). Perspektivisch als Exponat mit
QR-Code-Fernsteuerung und Mehrbildschirm-Betrieb gedacht (Ziel/Rest/Steuerung
auf getrennten Displays) - die **Svelte-Migration** (austauschbare Rest-Widgets
+ Store-Architektur) ist umgesetzt (Phasen 0-5, siehe `TOOLING_SPEC.md`).
Die **Fernsteuerung** (Phase 5, `BroadcastChannel` + zweiter Vite-Entry) ist
umgesetzt; Phase 6 (Politur) ist offen.

## 2. Schnellstart: aktuellen Stand ausprobieren

```bash
pnpm install          # Abhängigkeiten (svelte, vite, vitest, jsdom)
pnpm dev              # Vite-Dev-Server; die gedruckte URL (meist localhost:5173)
                      # im Browser öffnen -> live-Reload beim Editieren
pnpm build            # produktiver Build -> dist/sqrt2.html (+ assets)
                      # dist/sqrt2.html direkt im Browser öffnen (kein Server nötig)
pnpm test             # node --test *.test.js (reine Logik) UND vitest run (Svelte-Komponenten)
```

- **Haupttool:** im Dev-Server (`pnpm dev`) bzw. Produktions-Build
  (`pnpm build` → `dist/sqrt2.html`). Canvas-Rendering
  (Zielquadrat + Bank/Rest) liegt in `<TargetBankCanvas>`, die Rest-Anzeige
  ist ein austauschbares Widget (Balken/Grid, Umschalter "Rest-Anzeige" im
  `ControlPanel`), Steuerung in `ControlPanel`/`PlaybackBar`. Alle drei an
  Stores (`configStore`/`playbackStore`) gebunden.
- **Fernsteuerung / QR-Handy:** siehe **`docs/DEPLOYMENT.md`** (zentrale
  Betriebsanleitung) und `docs/CONNECTION_SERVICE_SPEC.md` (Protokoll). Ein
  Server pro Exponat, embedded Relay (kein CORS), QR + PIN für Besucher-Handy.
- **URL-Parameter** (für Demo-/Test-Links, Button "Als URL kopieren"):
  `basis`, `depth` (Tiefe), `modeab` (Modus-B), `play=1` (Animation
  automatisch starten), `time`/`tick` (Wiedergabe-Position, `time` hat
  Vorrang), `restwidget=grid|bars` (Rest-Widget wählen),
  `compaction=1` (Kompaktierung statt Bank-Zoom), `transition` (Kompaktierungs-
  Dauer in Ticks), `zoomspeed` (Bank-Zoom-Trägheit).
- **Test-Tool** (Bank-Algorithmus isoliert, Stücke an echten Positionen):
  `selection_strategy_prototype.html` (über Dev-Server oder als statische Datei).
- **Visuelle Verifikation** via Playwright (`pnpm test:e2e`), aber nur mit
  frischem Build - siehe `AGENTS.md` (stale-dist-Falle). Korrektheits-Gate:
  `pnpm build` + `pnpm test` + `pnpm test:e2e`.

## 3. Dateien und ihr Zweck

| Datei | Zweck | Zustand |
|---|---|---|
| `sqrt2.html` | **Haupttool-Shell.** Mountet die Svelte-Komponenten und hält nur noch die Zahlentafel (`updateHUD`, l/l²/R), das `SETTINGS`-Array (URL-Sync) und die Playback-Brücke für die Zahlentafel. Das Canvas-Rendering selbst liegt seit Phase 4a in `TargetBankCanvas.svelte`. Enthält den *ausgelagerten* alten SYSTEM-C-Renderblock noch als toten Code (siehe `AGENTS.md`). | Funktionsfähig |
| `selection_strategy_prototype.html` | **Algorithmus-Spiel-Tool.** Bank isoliert an echten Positionen, Tick-Zeitachse (1 Tick = 1 Entnahme), zum Testen von Auswahl-/Schneide-Strategien. | Funktionsfähig, im Browser getestet |
| `p.html` | Referenz-Prototyp (Slot-basiertes Repacking, **verworfen**, nur als Vergleich). | historisch |
| `src/lib/bank-core.js` | **Gemeinsame Bibliothek** (ES-Modul), von beiden HTML-Tools importiert: Bank-Algorithmus + Kompaktierung + bijektive Tick↔Zeit-Abbildung. | Fertig, in Node getestet |
| `src/lib/smoothing.js` | **Gemeinsame Glättungs-Bibliothek** (3 Bausteine, siehe §6.1). | Fertig, persistent getestet |
| `src/lib/compiler.js` | `compileSystem()` als reine Funktion (Config rein, kompilierter Zustand raus). | Fertig, `compiler.test.js` |
| `src/lib/stores.js` | `configStore`/`playbackStore` (writable) + `compiledStore` (derived) + `displayStore` (lokaler UI-State, **nicht** synchronisiert). | Fertig |
| `src/lib/urlState.js` | `parseConfigFromUrl`/`parsePlaybackFromUrl`/`buildStateParams`. | Fertig, `url-state.test.js` |
| `src/components/TargetBankCanvas.svelte` | Canvas-Rendering + rAF-Loop + Auto-Zoom/Kompaktierung (Port von `renderFrame()`). | Fertig (Phase 4a) |
| `src/components/RestCounterBars.svelte` / `RestCounterGrid.svelte` | Austauschbare Rest-Widgets (Balken / 4×4-Grid), nur lesend auf Stores. | Fertig (Phase 4b/c) |
| `src/components/ControlPanel.svelte` / `PlaybackBar.svelte` | UI, an Stores gebunden (Basis, Tiefe, Modus, Rest-Widget-Wahl, Play/Pause, Zeitstrahl). | Fertig (Phase 3) |
| `TOOLING_SPEC.md` | **Lebendige Migrations-Spezifikation** (Phasen 0-5 + 8, Stand je Step). Bei jeder Änderung aktualisieren. | gepflegt |
| `docs/DEPLOYMENT.md` | **Zentrale Betriebsanleitung**: ein Server pro Exponat, embedded Relay, QR-Fernsteuerung, Tailscale. | gepflegt |
| `docs/CONNECTION_SERVICE_SPEC.md` | Relay-Protokoll (Token/PIN/WS, embedded Betriebsmodell). | gepflegt |
| `CLAUDE.md` | Agentenregeln (stetige Ableitung, Layout-Masse, SETTINGS-EIN-Objekt, Tooling-Updates, Svelte-Tests). | gepflegt |
| `AGENTS.md` | Kurzübersicht + Gotchas für Agents (Build/Test, toter Code, Store-Pitfalls, npm-blockiert). | gepflegt |
| `TODO.md` | Offene Punkte / Checkliste (nächste Stufen + Politur). | lebendig |

**Tests:** `pnpm test` = `node --test *.test.js` (reine Logik:
`smoothing.test.js`, `auto-zoom-visibility.test.js`, `bank-core-compaction.test.js`,
`compiler.test.js`, `url-state.test.js`, `stores.test.js`) **+** `vitest run`
(Svelte-Komponenten in `src/**/*.test.js`, jsdom). Beide Runner bewusst
nebeneinander (siehe `CLAUDE.md` "Svelte-Komponenten-Tests").

## 4. Grundkonzept der Konstruktion

- √2 über den klassischen digit-by-digit-Algorithmus (P, R = 2-P² Iteration),
  **exakt mit BigInt-Integer-Arithmetik** (nicht Float!) - sonst
  Präzisionsverlust ab Tiefe ~8-9 durch `catastrophic cancellation`
  (P² liegt sehr nah an 2).
- Ein Einheitsquadrat wird rekursiv in `BASE` Streifen geschnitten (optional
  abwechselnd vertikal/horizontal je nach Parität von `k`); die Ziffern
  bestimmen, wie viele Streifen einer Größe verbraucht werden.
- Zwei Bereiche: **Ziel** (wachsende √2-Quadrat aus Schalen/Gnomonen) und
  **Bank/Rest** (übrig gebliebene Stücke).
- **Modus B:** Regler für "hypothetische Basis b→1" - verzerrt NUR das Ziel
  (nicht die Bank), macht Stellenwert-Struktur sichtbar.

## 5. Der validierte Bank-Algorithmus (Ergebnis langen Testens)

Beste Kombination (~75-86% Füllgrad, keine Kreuzungen):

1. **Auswahl "isolation":** bei Entnahme zuerst das Stück mit den **wenigsten
   direkt berührenden Nachbarn** (Einzelgänger aktiv abbauen).
2. **Schneiden "centroid_far":** Kandidat = der, dessen **nächster Rand**
   (nicht Mittelpunkt!) am **weitesten** vom Schwerpunkt aller sichtbaren
   Stücke entfernt ist (Gegenteil "centroid-nah" ist nachweislich schlechter).
3. **Streifen-Enden-Filter:** nie aus der **Mitte** eines zusammenhängenden
   Streifens wählen (weder Schneiden noch Entnehmen), nur von den Enden.
4. **Quadrat-Schnittrichtung:** bei geradem `k` frei wählbar, **kein
   Effektivitätsunterschied** (nur ästhetisch).

## 6. Gemeinsame Code-Basis & wichtige mathematische Erkenntnisse

### 6.1 Glättung (`smoothing.js`) - drei Bausteine, klar getrennt

Alle automatisierten Bewegungen (Zoom, Position, Blend, Kamera) sind C¹-stetig
(kein Sprung in Wert ODER Steigung) - siehe `CLAUDE.md` "Automatisierte
Parameteränderungen". Drei bewusst unterschiedliche Bausteine:

- **`buildMonotoneSpline()`/`buildMonotoneSplineBundle()`** - ein Wert (oder
  mehrere UNABHÄNGIGE), der an jedem Stützpunkt **exakt/getreu** getroffen
  werden MUSS (Sicherheitsgarantie, z.B. Auto-Zoom-Exponent). C¹, trifft
  jeden Stützpunkt exakt und ohne Verzögerung - reagiert aber SOFORT auf
  jeden Stützpunkt (bei Dutzenden dichten Wegpunkten "zappelig").
- **`computeSegmentBlend()`** - MEHRERE voneinander abhängige Werte, deren
  relative Lage eine Invariante einhält (z.B. "Stück A überlappt B nie").
  Liefert EIN geteiltes Blend-Gewicht `s(t)` für alle Werte. **Zusätzlich**
  bei zeitlicher Verzögerungs-Garantie: ein zweiter, "pinnender" Wegpunkt mit
  IDENTISCHEM Zustand (Segment zwischen zwei gleichen Werten bleibt exakt
  flach). Beweis über Konvexkombinations-Argument.
- **`buildDampedFilter()`/`buildDampedFilterBundle()`** - Werte, die nur
  träge/asymptotisch folgen müssen, OHNE exakte Treffer (z.B. Bank-Zoom-
  Kamera). Kritisch gedämpfte Sprungantwort 2. Ordnung, C¹, bewusst TRÄGE
  mit Zeitkonstante `TAU`. Sicherheit (Nichtüberlappung) gilt für JEDE TAU.

Zoom: pro **Checkpoint** (jede Zeit, an der sich die sichtbare Menge ändert)
Zustand `{z, cx, cy}` mit festem Sicherheitsrand berechnen; Überblendung der
**fertig transformierten Positionen** (`offset = 0.5 - cx*z`), NICHT der
Parameter - garantiert Sicherheit durch Konvexität. `ZOOM_MARGIN = 0`,
minimaler Zoom exakt 1.0.

**Verworfene/fehlerhafte Zwischenstände (nicht wiederholen):** kausaler
Exponentialkern (C⁰, hinkt hinterher → Sichtbarkeits-Bug beim Auto-Zoom);
`buildMonotoneSpline()` fälschlich für Bank-Zoom (zappelig bei hunderten
Wegpunkten) und fälschlich für Kompaktierung (bricht Ordnungstreue zwischen
Stücken); Bewegungs-Schwellwert für Kompaktierungs-Wegpunkte (Einfrier-Bug).

### 6.2 Kompaktierung ("Zeilen/Spalten ausblenden")

Pro Achse (x,y): belegte Intervalle finden, Lücken auf 0 komprimieren;
Stückgrößen bleiben exakt. Füllgrad ~75% → ~84-86%.

- **Masse/Anker statt Förderband:** `buildCompactionMap()` wählt die
  zusammenhängende Gruppe mit der **größten Gesamtfläche** als Anker (bleibt
  an roher Koordinate), alle anderen Gruppen rücken lückenlos heran. Große
  Flächen bewegen sich kaum (sie sind meist der Anker) - "Trägheits"-Effekt
  gewollt. Zustandslos gelöst (Anker frisch aus rohen Koordinaten je Wegpunkt).
- **Ordnungstreue:** `computeSegmentBlend()` (geteiltes Gewicht) statt
  unabhängiger Splines - sonst rutscht ein Stück in den Platz eines Nachbarn,
  bevor dieser verschwunden ist. JEDER relevante Tick ist Wegpunkt (kein
  Filter), `GAP_CLOSE_DELAY_TICKS` + Pinning-Wegpunkt verhindern zu frühes
  Schließen. `transitionTicks` (Default im Haupttool `3`) steuert die
  Überblendungs-Dauer.
- **Content/Kamera-Split:** `compactedLogicalRectAt()` liefert nur Position im
  kompaktierten Raum (exakt/schnell), `computeCompactionFitStates()` getrennt
  den Fit-Zoom (eigenständig dämpfbar, z.B. `buildDampedFilterBundle()`).
  `applyCompactionFit()` kombiniert beim Rendern. Beliebig träge/schnell,
  Nichtüberlappung bleibt erhalten.
- **Performance:** `makeCompactedLogicalRectLookup(waypoints)` leitet
  `times` EINMAL vorab ab (nicht pro Frame) - bei ~17000 Wegpunkten
  16.4ms → 0.075ms/Frame.

### 6.3 Bijektive Tick↔Zeit-Abbildung

`buildTickTimeMapping(tickTimePairs)` baut `tickToTimeArr` (linear interpoliert,
beide Richtungen). 0 Rundtrip-Fehler bei 510 Prüfungen. `CUT_BORN_LEAD = 0.1`
(war `-0.4`): kleiner als minimaler Tick-Abstand `0.15`, schließt
Umsortierung von Schnitt- vor Entnahme-Ereignissen mathematisch aus.

### 6.4 Bekannte, aber harmlose Alt-Bugs

- **Timing-Anomalie bei sehr kleiner Basis** (Basis 2): `action_time` nicht
  strikt monoton innerhalb einer Schale - Vorfahre + Nachkomme kurz gleichzeitig
  sichtbar. Schon in rohen Original-Positionen vorhanden, nicht blockierend.
- **Gleitkomma-Präzision bei sehr tiefer Rekursion** (Basis 10, Tiefe 9+,
  Kantenlängen ~10⁻⁸): vereinzelt Ordnungsverletzungen durch Float-Rauschen.
  Bei Normal-Tiefen (3-8) irrelevant.

## 7. Z/R-Transformationsmodi (Z wählbar, Demo; R deaktiviert)

Drei Flug-Modi für die Ziel-Seite: **Z** (Zerschneiden/Montessori,
`cellMode:'subdivide'`), **R** (Rotieren, **deaktiviert** - separater Bug),
**S** (Strecken/Morphing, Default, `cellMode:'morph'`). Z ist **bewusst nur
Demo-Modus für kleine Tiefen** (Rand-Zelle nimmt immer exakt `BASE` Stücke der
nächsten Ebene - bei tieferer Rekursion mathematisch unehrlich). Anforderung:
alle Übergänge C¹ - Alpha-Rampen (Z_source/Z_micro/Z_ghost) sollten auf
Smoothstep statt linear umgestellt werden (noch nicht umgesetzt).

## 8. Auto-Zoom-Modus (Mindestbreite in Pixeln)

Regler "Auto-Zoom: Mindestbreite feinste Stelle (Pixel, 0 = aus)".
`getSmoothedAutoZoomExp(time)` via `buildMonotoneSpline()` durch die
Schalen-Checkpoints (exakt, keine Verzögerung - behob ein echtes
Sichtbarkeits-Problem). `computeAutoZoomTAB(thresholdPx, scale, targetExp)`:
linearer Suchlauf über 200 Stützstellen (KEINE Bisektion - `widthAt(t_AB)`
bildet bei kleinem `targetExp` einen Höcker, nicht nur eine Rampe).
`effective_t_AB = Math.max(u_mode_AB, autoZoomTAB)` - "größerer Wert gewinnt",
Modus-B-Regler selbst bleibt unter Nutzerkontrolle. Bekannte Rest-Einschränkung:
ein winziger Ableitungsknick am exakten Einschalt-Moment (`t_AB=0` ist harte
Domänen-Grenze).

## 9. Einstellungen & URL-Zustand (`SETTINGS`)

**EIN `SETTINGS`-Array** (`sqrt2.html`): jede Einstellung = ein Eintrag
`{ key, phase, get(), set(v) }`. `applyPhase(phase)` liest URL-Parameter,
`buildStateParams()` exportiert sie ("Als URL kopieren"). Neue Einstellung →
EIN neuer Eintrag (keine vier parallelen Listen mehr). `bindEl()` für
`<input>`/`<select>`/Checkbox. `phase:'pre'` (Compiler-Eingaben, vor
`compileSystem()`) vs `phase:'post'` (Wiedergabe-Position, `modeab`, **`play`** -
neu, schließt die Lücke "geteilter Link startet Animation nicht automatisch").
Sonderfälle als `resolveFromUrl()`-Hook auf dem Eintrag, nicht als
Extra-`if`-Zweig. Zwei neue Regler: `transition` (Kompaktierungs-Dauer,
Default `3`) und `zoomspeed` (Bank-Zoom-Trägheit, Default `0.012`, ersetzt
hartkodiertes `0.03`).

## 10. Zukünftige Vision & Status

- **Svelte-Architektur + austauschbare Rest-Widgets:** **umgesetzt** (Phasen
  0-4). `TargetBankCanvas`, `RestCounterBars`, `RestCounterGrid`,
  `ControlPanel`, `PlaybackBar`; Rest-Widget-Umschaltung über `displayStore`.
- **Mehrbildschirm-/Fernsteuerung (`BroadcastChannel` + WebSocket-Relay):**
  **umgesetzt** (Phase 5 + embedded Relay). Zweiter Vite-Entry
  `RemoteControl.svelte`, Sync über `src/lib/syncedStore.js` (BroadcastChannel
  Fast-Path + WS-Relay). Siehe `docs/DEPLOYMENT.md`.
- **QR-Code-Verbindung (Besucher-Handy):** **umgesetzt** — Token/PIN-Minting
  im `ControlPanel`, Gast joint per QR-Link über embedded Relay
  (`src/lib/connection.js`). Details in `docs/DEPLOYMENT.md` §4.
- **Admin-konfigurierbare Steuerungs-Komplexität:** offen (Konfigurations-
  objekt, welche Regler sichtbar sind) - baut auf der Store-Architektur auf.
- **Z/R-Modi vollständig neu (C¹):** eigenständiges Thema (§7).
- **Tiefe-Standardwert** im Haupttool (`3`) vs Test-Tool (`10`): weiterhin
  nicht synchronisiert (offene Entscheidung).

## 11. Empfohlene nächste Schritte (Priorität)

1. ~~Test-Tool verifizieren~~ erledigt. 2. ~~Haupttool auf `bank-core.js`~~
   erledigt. 3. ~~Kompaktierung ergänzen~~ erledigt (§6.2). 4. **Tiefe-
   Standardwert klären** (offen). 5. ~~Gemeinsame Schalen-Orchestrierung
   (`buildSystem(..., cellMode)`)~~ erledigt. 6. ~~Rück-Verschmelzung Z-Modus~~
   nicht mehr reproduziert (Demo-Modus, §7). 7. **Z/R-Modi neu (C¹)** - eigenes
   Thema. 8. ~~Auto-Zoom~~ erledigt (§8). 9. ~~Gemeinsame Glättungs-Bibliothek~~
   erledigt (§6.1). 10. ~~Svelte-Migration + austauschbare Widgets~~ erledigt
   (Phasen 0-4, `TOOLING_SPEC.md`). 11. ~~Fernsteuerung/Mehrbildschirm~~
    erledigt (Phase 5 + embedded Relay, `docs/DEPLOYMENT.md`). 12. **Phase 6
    „Politur"** (Widget-Auswahl-UI, `bank-core.js`/`smoothing.js` → `src/lib/`)
    + **Tailscale/TLS** für echtes Handy — siehe `TODO.md`.
