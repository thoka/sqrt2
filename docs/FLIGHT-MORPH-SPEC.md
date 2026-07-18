# SPEC: Flug-Morph — Flächenkonstanz + optionale Drehung

Stand: 2026-07-18. Status: **Plan**, noch nicht implementiert. Jede Stufe
bekommt eigene Tests (Unit und/oder e2e) — siehe "Test-Kriterien" unten.

## 1. Problemstellung

Beim Flug (Render-Pipeline in `TargetBankCanvas.svelte`,
`render_pipeline`-Schleife) wird ein Rest-Stück von seiner
Bank-Herkunftsform (`start_w × start_h`) zur Ziel-Zelle
(`target_w × target_h`) überblendet. Heute geschieht das als **linearer
Lerp beider Kanten unabhängig** (Zeilen ~508–509):

```
pw = start_w * (1 - fly_t) + end_w * fly_t;
ph = start_h * (1 - fly_t) + end_h * fly_t;
```

Dadurch ist die Fläche `pw * ph` während des Flugs **nicht konstant**:
sie pulsiert (z.B. Start 1×0.1 = 0.1, Ziel 0.5×0.5 = 0.25, Mitte
0.75×0.3 = 0.225). Das Auge liest "die Fläche atmet", statt
gleichbleibend zu wirken. Zudem erzwingt der lineare Kanten-Lerp bei
Format-Wechseln wie `1:b → b:1` eine starke Verzerrung (Mitte wird
quadratisch), obwohl eine **90°-Drehung** das gleiche Ziel ohne jede
Verzerrung erreichen würde.

Zeitliche Glättung gibt es schon: `fly_t = smoothstep(fly_t_raw)`
(Zeile ~475). Die **Form** wird aber unabhängig davon linear lerpiert.

## 2. Ziel

- Die Fläche des fliegenden Stücks soll **während des Flugs möglichst
  konstant wirken** (nicht mathematisch exakt, aber im unverzerrten Fall
  — noch kein Zoom — in diese Richtung).
- Format-Wechsel dürfen **optional über Drehung** (statt/zu-samt
  Streckung) erfolgen, damit `1:b → b:1` ohne Flächenverzerrung gelöst
  wird.
- **Mischfälle** (`1:b → 1/b : b²` u.ä.) werden kontinuierlich in
  Drehung + Streckung aufgeteilt (keine harte Entscheidung).
- **Urspüngliche Quadrate werden nicht gedreht** (Drehung sinnfrei bei
  `sw == sh`).
- **Alles konfigurierbar** (`morphRotWeight`), Vorgabe sichtbar erst
  nach Fertigstellung.

## 3. Nicht-Ziel / Ausklammerung

- `Z_micro` (Zeilen ~487–492): bewusster **Streckmodus** (ein Stück der
  Ebene k+1 wird auf die Zelle der Ebene k gestreckt, `target_w = tw /
  b_eff`). Dieser Modus bleibt **unverändert** — hier soll keine
  Flächenkonstanz/Drehung greifen. Die neue Morph-Logik gilt für
  `Z_direct`, `S_macro`, `R_macro`, `Z_source`, `Z_ghost`.

## 4. Modell (Mix aus Drehung + Streckung)

Reine, testbare Funktion `morphRect(sw, sh, ew, eh, t, rotWeight)`:

```
A0 = sw * sh;  A1 = ew * eh
// Seitenverhaeltnis (als log, damit Multiplikation->Addition)
rs = sw / sh;           rt = ew / eh;          rtRot = eh / ew   // 90° gedreht
e_s = |log(rs) - log(rt)|        // Verzerrung bei reiner Streckung
e_r = |log(rs) - log(rtRot)|     // Verzerrung bei 90°-Dreh-Ziel
g   = max(0, e_s - e_r)          // wieviel Verzerrung Drehung spart
// effektiver Dreh-Anteil (0..1); bei Quadrat-Start (rs=1) ist g=0 -> keine Drehung
rho = e_s > 1e-9 ? clamp(rotWeight * g / e_s, 0, 1) : 0
// Ziel-Seitenverhaeltnis gemischt: rein gestreckt (rt) <-> gedreht (rtRot)
rTarget = exp( lerp(log(rt), log(rtRot), rho) )
// Flaeche folgt glatt A0 -> A1 (monoton, kein Pulsieren)
A = A0 * (1 - ts) + A1 * ts            // ts = smoothstep(t)
rMix = exp( lerp(log(rs), log(rTarget), ts) )
ph = sqrt(A / rMix);  pw = A / ph      // pw*ph == A exakt (invariant)
// Drehwinkel nur, wenn rho > 0; kurzer Weg (max 90°), smoothstep-ein/aus
rot = rho > 0 ? (90° * sign(log(rtRot)-log(rs)) * ts) : 0
return { pw, ph, rot }
```

Invariante: **`pw * ph == A`** zu jedem `t` (Fläche exakt konstant
*innerhalb* des Übergangs A0→A1; bei A0==A1 also exakt konstant). Kein
Pulsieren mehr.

`rotWeight` (Default 0.5):
- `0` → reine Streckung wie bisher (nur Form-Morph mit Flächenkonstanz,
  keine Drehung).
- `1` → maximale Drehung wo sinnvoll (`1:4 → 1:4` + 90° statt `1:4 → 4:1`).
- Quadrate (`sw==sh`): `g==0` ⇒ `rho==0` ⇒ keine Drehung, egal Weight.

`sign(log(rtRot)-log(rs))` wählt den **kürzesten Drehweg** (max ±90°).

## 5. Einbindung in den Render-Pfad

- Neue Datei `src/lib/morphRect.js` (reine Funktion, Unit-getestet).
- In `render_pipeline`-Schleife (ab Zeile ~477): statt `target_w/target_h`
  linear zu lerpen, `morphRect(start_w, start_h, end_w, end_h, fly_t,
  morphRotWeight)` aufrufen → liefert `pw, ph, rot`.
  - `start_w/h` aus `bankOriginState` (bereits da, `start_x/y/w/h`).
  - `end_w/h` aus den `dyn_prefA`/`dyn_axes_w` (bereits da, `tx/ty/tw/th`).
- **Rotation anwenden für ALLE Flug-Typen**, nicht nur `R_macro`:
  heute dreht nur `R_macro` (Zeile ~516). Die neuen `pw/ph/rot` werden
  für jeden sichtbaren Typ genutzt; `rot` wird (wie bei R_macro) via
  `translate(center) + rotate(rot) + fillRect(-pw/2,-ph/2,pw,ph)`
  gezeichnet. Das vermeidet den bisherigen Sonderpfad und vereinheitlicht
  das Zeichnen.
- `Z_micro` bleibt Sonderfall (Streckmodus, unverändert).

## 6. Konfiguration

- Neues Feld `morphRotWeight` in `configStore` (Default 0.5, Laufzeit-
  Feld, **kein Recompile** — GOTCHA #10: nicht in `compileRelevantKey`).
- URL-Parameter (urlState.js, analog zu `speed`/`linewidth`):
  `morphrot` (0…1, parse float, Default 0.5).
- SETTINGS-Eintrag in `sqrt2.html` (AGENTS.md GOTCHA #4: ein Eintrag
  `{key, phase, get, set}`).
- Regler im ControlPanel (Animations-Optionen), dezent wie die anderen.

## 7. Test-Kriterien

### Unit (`tests/unit/morph-rect.test.js`)
1. **Flächen-Invariante:** für beliebige `(sw,sh,ew,eh)` und `t∈[0,1]`
   gilt `|pw*ph - A| < 1e-9` mit `A = A0*(1-ts)+A1*ts`.
2. **Kein Pulsieren:** `pw*ph` ist monoton in `t` (folgt glatt A0→A1),
   nicht größer als `max(A0,A1)` und nicht kleiner als `min(A0,A1)`
   (außer bei exaktem A0==A1: exakt konstant).
3. **Reine Drehung bei `1:4 → 4:1`, weight=1:** `rho==1`, `rot==90°`
   (bzw. smoothstep-skaliert), Zielform == Startform gedreht
   (`pw≈sh_Start, ph≈sw_Start` bei t=1), Fläche exakt konstant (A0==A1).
4. **Quadrat nicht gedreht:** `(1,1) → (3,7)` mit weight=1 → `rot==0`,
   reine Streckung.
5. **Mischfall `1:b → 1/b : b²`** (b=3 ⇒ `1:3 → 1/3:9`): `0 < rho < 1`
   bei weight∈(0,1) — kontinuierlicher Mix, keine harte 0/1-Kante.
6. **weight=0 ⇒ keine Drehung** für alle Fälle (`rot==0`), Verhalten ==
   reine Flächenkonstanz-Streckung.
7. **Endpunkte exakt:** `t=0` ⇒ `(pw,ph)==(sw,sh)`, `rot==0`;
   `t=1` ⇒ `(pw,ph)==(ew,eh)` (bzw. gedrehte Zielform), korrekter Winkel.
8. **C¹-Stetigkeit:** `morphRect` ist stetig in `t` (kein Sprung bei
   t=0/1), passend zur bestehenden smoothstep-Zeitglättung.

### E2E (optional, visuell)
- Canvas zeigt zwei weiße Quadrate am Anfang (Regression aus Skalierung-
  TODO) — Morph-Änderung darf das nicht brechen.
- (Manuell/visuell im Browser): Flug eines `1:4`-Stücks nach `4:1` bei
  weight=1 dreht sauber um 90°, keine Flächenpulsierung.

## 8. Offen / Risiken

- **R_macro-Rotation:** bisher drehte nur `R_macro` (mit eigenem
  `p.rot`). Die neue `rot` aus `morphRect` ersetzt/ergänzt das — klären,
  ob `p.rot` (vorhandene Rotation des Makro-Stücks) erhalten bleibt oder
  durch die Morph-Drehung ersetzt wird. Vorschlag: Morph-`rot` additiv zu
  `p.rot` (beide drehen dasselbe Stück).
- **gridPath / Kanten:** `R_macro` nutzt `gridPath.rect` nur bei
  `alpha>=0.999`; bei gedrehten Stücken passt das (Achsen-aligned) nicht —
  hier ggf. nur `fillRect` (gedreht), kein `gridPath`-Beitrag.
- **Performance:** 1× `sqrt` + wenige `log/exp` pro Stück/Frame —
  vernachlässigbar ggü. `project()`/Layout.
