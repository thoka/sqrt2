# Übergabeprotokoll: √2-Flächenmodell-Exponat

Stand: Ende der Chat-Session, Übergang nach VS Code / Claude Code.

## 1. Projektziel

Interaktive Visualisierung von √2 als Beispiel einer irrationalen Zahl, für Science-Center/Schul-Kontext. Kernidee: √2 wird ziffernweise (digit-by-digit) über ein geometrisches Flächenmodell konstruiert (Montessori-Stil: "Papier schneiden und neu zusammenlegen"). Perspektivisch als Exponat mit QR-Code-Fernsteuerung und Mehrbildschirm-Betrieb gedacht (Ziel/Rest/Steuerung auf getrennten Displays) - das ist Zukunftsmusik, noch nicht begonnen.

## 2. Dateien und ihr Zweck

| Datei | Zweck | Zustand |
|---|---|---|
| `wurzel2_v28.html` | **Haupttool.** Volle Visualisierung: Zielquadrat (wächst ziffernweise Richtung √2) + Bank/Rest (Restflächen-Reservoir) + Steuerung (Basis, Tiefe, Modus B/C, Zoom-Schwellwert). | Funktionsfähig, aber **Bank-Algorithmus ist NICHT mehr synchron mit dem Test-Tool** (siehe Abschnitt 5) |
| `selection_strategy_prototype.html` | **Algorithmus-Spiel-Tool.** Isolierter Prototyp nur für die Bank - zeigt Stücke an ihren echten, unveränderten Positionen, Tick-Zeitachse (1 Tick = 1 Entnahme), zum Testen von Auswahl-/Schneide-Strategien. | **Gerade mitten im Umbau** auf gemeinsame Code-Basis - Kernlogik verifiziert (Node-Test läuft durch), aber **im Browser noch nicht getestet** (DOM/Rendering/UI-Interaktion offen) |
| `shared/bank-core.js` | **Neue gemeinsame Bibliothek** (nur lokal in der Sandbox, `/home/claude/shared/bank-core.js` - liegt NICHT in den Outputs, muss separat gesichert werden!). Enthält den fertigen Bank-Algorithmus + Kompaktierung + bijektive Tick↔Zeit-Abbildung. | Fertig geschrieben, in Node getestet (siehe Abschnitt 6), **noch nicht ins Haupttool integriert** |
| `stable_slots_prototype.html` | Früherer Versuch (Slot-basiertes Repacking) - **verworfen**, da Kreuzungsprobleme bei der Überblendung. Nur noch als Referenz/Lernbeispiel interessant. | Abgeschlossen, nicht weiterverfolgen |

**Wichtig:** `shared/bank-core.js` liegt aktuell nur in der Chat-Sandbox unter `/home/claude/shared/bank-core.js`, nicht in `/mnt/user-data/outputs/`. Der Inhalt ist unten in Abschnitt 8 komplett abgedruckt, damit er nicht verloren geht.

## 3. Grundkonzept der Konstruktion (falls das in VS Code neu aufgesetzt wird)

- √2 wird über den klassischen "digit-by-digit"-Algorithmus berechnet (P, R = 2-P² Iteration), aber **exakt mit BigInt-Integer-Arithmetik** (nicht Float!) - sonst Präzisionsverlust ab Tiefe ~8-9 durch Auslöschung (`catastrophic cancellation`, da P² sehr nah an 2 liegt).
- Geometrisch: ein Einheitsquadrat wird rekursiv in `BASE` Streifen geschnitten (abwechselnd vertikal/horizontal, je nach Parität von `k`), die Ziffern bestimmen, wie viele Streifen einer Größe für die aktuelle Ziffer gebraucht werden.
- Zwei Bereiche: **Ziel** (das wachsende √2-Quadrat, baut sich aus den Schalen/Gnomonen auf) und **Bank/Rest** (übrig gebliebene, noch nicht verbrauchte Flächenstücke).
- **Modus B**: Regler für "hypothetische Basis b→1" - verzerrt nur das Ziel (nicht die Bank), macht die Stellenwert-Struktur sichtbar, indem alle Ziffern-Ebenen visuell gleich groß werden.
- Der Rand um das Ziel-Quadrat entspricht IMMER exakt der Größe der "nächsten Ziffer-Stelle" (Tiefe+1), berechnet mit derselben `b_eff`-Formel wie jede andere Stelle - dadurch automatisch "quasi-logarithmisch" sichtbar bei Modus B, aber verschwindend klein bei realer Basis (mathematisch korrekt).

## 4. Der validierte Bank-Algorithmus (das Ergebnis wochenlangen Testens)

Nach sehr vielen Experimenten (siehe Abschnitt 7 für die verworfenen) hat sich diese Kombination als beste erwiesen (~75-86% Füllgrad, keine Kreuzungen):

1. **Auswahl-Strategie "isolation"**: Bei der Entnahme wird das Stück mit den **wenigsten direkt berührenden Nachbarn** zuerst verbraucht (aktiv Einzelgänger abbauen).
2. **Schneide-Strategie "centroid_far" (Schwerpunkt entfernt)**: Beim Zerschneiden wird der Kandidat gewählt, dessen **nächster Rand** (nicht Mittelpunkt!) am **weitesten** vom Schwerpunkt aller sichtbaren Stücke entfernt ist. (Gegenteil - "Schwerpunkt-nah" - ist nachweislich schlechter, da die Konstruktion eine natürliche Aktivität an der Peripherie hat.)
3. **Streifen-Enden-Filter**: Nie aus der **Mitte** eines zusammenhängenden Streifens wählen (weder zum Schneiden noch zum Entnehmen) - nur von den beiden Enden. Verhindert unnötige Löcher in sonst zusammenhängenden Blöcken.
4. **Quadrat-Schnittrichtung**: Bei exakten Quadraten (gerades `k`) ist die Schnittrichtung mathematisch frei wählbar (keine Auswirkung auf die Stellenwert-Größen). Zwei Optionen getestet: "immer gleich" (senkrecht) und "alternierend" (wechselt je Quadrat-Ebene, gekoppelt an `k`, NICHT an die zeitliche Reihenfolge). **Kein Effektivitätsunterschied**, nur ästhetisch verschieden.

## 5. DAS OFFENE HAUPTPROBLEM: Haupttool und Test-Tool sind nicht synchron

Der Nutzer hat zu Recht bemängelt: das Verhalten des Rests sieht im Haupttool "komplett anders" aus als im Test-Tool. Ursachen (alle bestätigt):

1. **Der Algorithmus-Code war separat kopiert** in beiden Dateien und ist auseinandergedriftet (z.B. ein `born_time <= action_time`-Filter, der im Haupttool nötig ist, im Test-Tool aber fehlte - empirisch aber ohne Auswirkung, siehe unten).
2. **Kompaktierung existiert nur im Test-Tool**, nicht im Haupttool - das ist der Hauptgrund für den optischen Unterschied.
3. **Tiefe-Standardwert war unterschiedlich**: Haupttool hatte `Tiefe=3`, Test-Tool `Tiefe=10` - war nie synchronisiert worden.
4. Haupttool hat **keine Auswahlmöglichkeit** für den Algorithmus (bewusst - Best-Kombination fest einprogrammiert, um die Haupt-UI schlank zu halten).

### Lösung (in Arbeit, siehe Abschnitt 6): gemeinsame Code-Basis

`shared/bank-core.js` wurde geschrieben, um GENAU DAS zu lösen: ein einziger Algorithmus-Code, den beide Tools einbinden. Zusätzlich wurde eine **bijektive Tick↔Zeit-Abbildung** gebaut, da das Haupttool eine kontinuierliche Animationszeit (für Flug-Animationen) braucht, während der Algorithmus selbst nur einen monotonen Tick-Zähler nutzt (1 Tick = 1 tatsächliche Entnahme, Schneiden allein kostet keinen Tick).

**Noch zu tun:**
- [ ] Test-Tool: Browser-seitig testen (im Node-Test funktioniert die Kernlogik, DOM/Rendering/UI noch nicht verifiziert)
- [ ] Haupttool: `bank-core.js` einbinden, eigene Kopie des Algorithmus entfernen
- [ ] Haupttool: Kompaktierung einbauen (analog zum Test-Tool, aber mit der bijektiven Zeit-Abbildung verbunden)
- [ ] Haupttool: Tiefe-Standardwert auf 10 setzen (aktuell noch 3) - offene Entscheidung, ob gewünscht
- [ ] Build-Prozess etablieren (Python-Skript, das `bank-core.js` in beide HTML-Dateien einfügt) - Ansatz mit Platzhalter `__BANK_CORE_JS__` in einer Template-Datei wurde begonnen (`/home/claude/prototype_template.html`), aber noch nicht für das Haupttool wiederholt

## 6. Wichtige mathematische Erkenntnisse (nicht neu herleiten müssen!)

### 6.1 Gedämpfter, sicherer, monotoner Zoom
Problem: Naive Bounding-Box-Zoom-Berechnung "springt" oder bleibt stecken. Lösung (bewiesen, nicht nur getestet):
- Zoom-Zustand `{z, cx, cy}` wird pro **Checkpoint** (jeder Zeitpunkt, an dem sich die sichtbare Stückmenge ändert) berechnet, mit **festem Sicherheitsrand** (aktuell 0%, war mal 20%, siehe unten).
- Überblendung zwischen Checkpoints NICHT durch Interpolation der Parameter (z, cx, cy direkt), sondern durch **kausalen Exponentialkern** (`F(t) = exp(-k*(time-t))`) angewendet auf die fertig transformierten Positionen - das garantiert Sicherheit durch Konvexität von [0,1], unabhängig davon, wie stark sich das Zentrum zwischen Checkpoints verschiebt.
- Kritischer Fehler, der einmal gemacht und behoben wurde: Bei der Herleitung der affinen Form `T(x) = x*z + offset` muss `offset = 0.5 - cx*z` sein (NICHT `cx*(1-z)` - das war ein Vorzeichenfehler, der zu realen Überlappungen führte, erst bei Basis 2 entdeckt).
- Minimaler Zoom ist exakt 1.0 (kein Sicherheitsrand mehr, `ZOOM_MARGIN = 0`).

### 6.2 Kompaktierung ("Zeilen/Spalten ausblenden")
Idee des Nutzers: wie in einer Tabellenkalkulation leere Zeilen/Spalten ausblenden. Für jede Achse (x, y) unabhängig: finde die **belegten Intervalle** (Vereinigung aller Stück-Ausdehnungen), komprimiere die **Lücken** dazwischen auf 0. Stückgrößen bleiben exakt erhalten (jedes Stück liegt per Definition in einem belegten Intervall).

**Bewiesene Eigenschaften:**
- Monotone Abbildung pro Achse → Ordnungstreue und Nichtüberlappung bleiben automatisch erhalten.
- Füllgrad-Verbesserung: von ~75% (beste Auswahl-Heuristik) auf ~84-86%.

**Kritischer Fehler, der gemacht und behoben wurde:** Bei der gedämpften Überblendung MUSS jedes Stück über **alle** globalen Wegpunkte bewertet werden (auch außerhalb seiner eigenen Sichtbarkeit, mit seiner echten fixen Position durch die jeweilige Kompaktierungs-Abbildung geschickt) - NICHT nur über die Wegpunkte, an denen es selbst sichtbar ist. Sonst nutzen verschiedene Stücke unterschiedliche Gewichte, und die Ordnungstreue bricht zusammen (führte zu tausenden Überlappungen in einem fehlerhaften Zwischenstand).

**Ein Bewegungs-Schwellwert-Regler ("nur bei lohnender Verbesserung bewegen") wurde probiert und wieder verworfen** - bei extremen Werten (z.B. 1) "friert" das erste Intervall ein (die Überblendungsformel reduziert sich mathematisch auf einen konstanten Wert, wenn nur Start- und Endwegpunkt akzeptiert werden). Schwellwert=0 (jede Verbesserung wird Wegpunkt) funktioniert bereits ausgezeichnet - kein Regler nötig.

### 6.3 Bijektive Tick↔Zeit-Abbildung
Für das Haupttool: `buildTickTimeMapping(tickTimePairs)` nimmt eine Liste `{tick, time}`-Paare (in der Reihenfolge, in der der Algorithmus sie liefert) und baut ein Array `tickToTimeArr`, das per linearer Interpolation in beide Richtungen abgefragt werden kann (`tickToTime`, `timeToTick`). Getestet: 0 Rundtrip-Fehler bei 510 Prüfungen, auch für gebrochene Werte konsistent.

### 6.4 Bekannte, aber harmlose Alt-Bugs
- **Timing-Anomalie bei sehr kleiner Basis** (z.B. Basis 2): Innerhalb einer Schale ist `action_time` nicht streng monoton (mischt `t_fly` und `t_cut` für verschiedene Positionen). Führt in seltenen Fällen dazu, dass ein Vorfahre und einer seiner eigenen Nachkommen kurzzeitig gleichzeitig "sichtbar" sind. Empirisch bestätigt: **bereits in den rohen Original-Positionen vorhanden**, nicht durch spätere Fixes verursacht. Nicht blockierend, aber bekannt.
- **Gleitkomma-Präzisionsgrenze bei sehr tiefer Rekursion** (Basis 10, Tiefe 9+, Stücke ab k≈16-17 mit Kantenlänge ~10⁻⁸): vereinzelte "Ordnungsverletzungen" durch Gleitkomma-Rauschen, keine echten Logikfehler. Bei normalen Ausstellungs-Tiefen (3-8) nicht relevant.

## 7. Verworfene Ansätze (NICHT erneut versuchen, alle empirisch widerlegt)

Auswahl-/Schneide-Heuristiken, die getestet, aber **keine** Verbesserung brachten (bzw. schlechter waren als die validierte Kombination):
- Boustrophedon (Richtung alternierend je nach k-Parität)
- Nächste-Nähe-Heuristik (klar schlechter)
- Konsistente Richtung (Schneiden UND Entnehmen an derselben Ecke)
- LIFO/FIFO Batch-Konsum
- Gestufter Faktor-Schnitt (z.B. Basis 10 erst durch 2, dann durch 5 statt direkt durch 10) - erzeugt MEHR Fragmentierung, nicht weniger
- "Schwerpunkt-nah" Schneiden (Gegenteil von centroid_far) - klar schlechter
- Slot-basiertes Repacking (Left-Edge-Algorithmus) - technisch sauber (0 Kollisionen), aber der Nutzer wollte KEINE Neuanordnung, sondern nur Auswahl unter Beibehaltung der echten Positionen (siehe `stable_slots_prototype.html` als Referenz, verworfen)
- Rollout/Lookahead mit fixierter Fortsetzungs-Politik - als "Kaninchenbau" identifiziert und bewusst NICHT umgesetzt (zu rechenintensiv für den Nutzen)
- Bewegungs-Schwellwert für Kompaktierungs-Wegpunkte (siehe 6.2) - verursacht Einfrier-Bug bei extremen Werten, wieder entfernt

## 8. Der vollständige Code von `shared/bank-core.js`

Falls die Datei beim Umgebungswechsel nicht mitkommt, hier der komplette Inhalt zum Wiederherstellen:

```javascript
// ============================================================================
// BANK-CORE.JS - Gemeinsame Quelle für den Bank-Algorithmus
// ============================================================================
// Diese Datei ist die EINZIGE Quelle der Wahrheit für:
//   1. Den Auswahl-/Schneide-Algorithmus der Bank (createBankSimulation)
//   2. Die Kompaktierung ("Zeilen/Spalten ausblenden")
//
// Sowohl das Haupttool (wurzel2_v28.html) als auch das Algorithmus-Spiel-Tool
// (selection_strategy_prototype.html) binden GENAU DIESEN Code ein (per
// Build-Schritt einkopiert, siehe build.py). Aenderungen hier gelten
// automatisch fuer beide - keine manuelle Synchronisation mehr noetig.
//
// Bewusst OHNE globale Variablen: alles ist entweder in der von
// createBankSimulation() zurueckgegebenen, gekapselten Instanz, oder als
// reine Funktion mit expliziten Parametern - dadurch koennen mehrere
// Instanzen (z.B. verschiedene Zoom-Stufen zum Vergleich) nebeneinander
// existieren, ohne sich gegenseitig zu stoeren.
// ============================================================================

// ---------------------------------------------------------------------------
// TEIL 1: Bank-Algorithmus (Auswahl-Strategie "isolation" + Schneide-Strategie
// "centroid_far" + Streifen-Enden-Filter - die im Algorithmus-Spiel-Tool
// gefundene beste Kombination, siehe Gespraechsverlauf).
// ---------------------------------------------------------------------------
//
// WICHTIG zur Zeitachse: Der Algorithmus arbeitet intern ausschliesslich mit
// einem monoton wachsenden Integer-"Tick" (jede tatsaechliche ENTNAHME ist
// ein Tick; Schneiden allein verbraucht keinen eigenen Tick). Das ist die
// gleiche Zeitachse wie im Algorithmus-Spiel-Tool.
//
// Das Haupttool hat ZUSAETZLICH eine kontinuierliche Animationszeit fuer die
// Flug-Animation. Die Bruecke zwischen beiden ist eine bijektive Abbildung
// (siehe TEIL 3: buildTickTimeMapping) - der Algorithmus selbst muss davon
// nichts wissen, er liefert nur die Tick-Nummer jeder Entnahme mit zurueck.

function createBankSimulation(BASE, N_MAX, squareSplit) {
    squareSplit = squareSplit || 'fixed'; // 'fixed' oder 'alternating' - rein stilistisch, kein Effektivitätsunterschied (siehe Gespraechsverlauf)
    let baseBig = BigInt(BASE);
    let n_arr = [1]; let P_int = 1n;
    for (let m = 1; m <= N_MAX; m++) {
        let target = 2n * (baseBig ** BigInt(2 * m));
        let best_n = 0n;
        for (let t = baseBig - 1n; t >= 0n; t--) {
            let c = P_int * baseBig + t;
            if (c * c <= target) { best_n = t; break; }
        }
        n_arr.push(Number(best_n));
        P_int = P_int * baseBig + best_n;
    }
    let axes = [{ exp: 0 }];
    for (let m = 1; m <= N_MAX; m++) for (let c = 0; c < n_arr[m]; c++) axes.push({ exp: m });
    let TOTAL_STEPS = axes.length;

    let global_id = 0;
    let bank_pieces = [{ id: global_id++, parent_id: null, k: 0, x: 0, y: 0, w: 1, h: 1, born_time: 0, cut_time: Infinity, taken_time: Infinity, children: [] }];
    let tick = 1; // Tick 0 = Zustand vor der ersten Entnahme (siehe compileSystem-Aufrufer)
    let lastEndPerParent = new Map();

    // Nie aus der Mitte eines zusammenhaengenden Streifens waehlen - nur von
    // den Enden (siehe Gespraechsverlauf: verhindert unnoetige Loecher).
    function filterToStripEnds(candidates) {
        let byParent = new Map();
        for (let p of candidates) {
            if (!byParent.has(p.parent_id)) byParent.set(p.parent_id, []);
            byParent.get(p.parent_id).push(p);
        }
        let result = [];
        for (let [pid, group] of byParent) {
            if (group.length <= 2) { result.push(...group); continue; }
            let varyX = group.some(p => p.x !== group[0].x);
            group.sort((a, b) => varyX ? (a.x - b.x) : (a.y - b.y));
            result.push(group[0], group[group.length - 1]);
        }
        return result;
    }

    // Anzahl direkt beruehrender, zur gleichen Zeit sichtbarer Nachbarn.
    function isolationScore(p, atTick) {
        let touch = 0;
        const EPS = 1e-9;
        for (let q of bank_pieces) {
            if (q.id === p.id) continue;
            if (!(atTick >= q.born_time && atTick < q.cut_time && atTick < q.taken_time)) continue;
            let touchX = (Math.abs(p.x + p.w - q.x) < EPS || Math.abs(q.x + q.w - p.x) < EPS) && !(p.y + p.h <= q.y + EPS || q.y + q.h <= p.y + EPS);
            let touchY = (Math.abs(p.y + p.h - q.y) < EPS || Math.abs(q.y + q.h - p.y) < EPS) && !(p.x + p.w <= q.x + EPS || q.x + q.w <= p.x + EPS);
            if (touchX || touchY) touch++;
        }
        return touch;
    }

    // Liefert das naechste zu entnehmende/schneidende Stueck fuer Groesse
    // target_k. Gibt {piece, tick, wasCut} zurueck - "tick" ist der Tick,
    // bei dem die ENTNAHME (nicht das Schneiden) stattfand.
    function getPieceFromBank(target_k) {
        let available = filterToStripEnds(bank_pieces.filter(p => p.k === target_k && p.taken_time === Infinity && p.cut_time === Infinity));
        if (available.length > 0) {
            available.sort((a, b) => isolationScore(a, tick) - isolationScore(b, tick));
            let chosen = available[0];
            chosen.taken_time = tick;
            if (chosen.__stripEnd) lastEndPerParent.set(chosen.parent_id, chosen.__stripEnd);
            let usedTick = tick;
            tick++;
            return { piece: chosen, tick: usedTick };
        }

        let parents = filterToStripEnds(bank_pieces.filter(p => p.k < target_k && p.taken_time === Infinity && p.cut_time === Infinity));
        if (parents.length === 0) throw "Bank ist leer! Iterationstiefe überschreitet Vorrat.";

        let visible = bank_pieces.filter(p => p.taken_time === Infinity && p.cut_time === Infinity);
        let ccx = 0, ccy = 0, cwsum = 0;
        for (let p of visible) { let w = p.w * p.h; ccx += (p.x + p.w / 2) * w; ccy += (p.y + p.h / 2) * w; cwsum += w; }
        if (cwsum > 0) { ccx /= cwsum; ccy /= cwsum; } else { ccx = 0.5; ccy = 0.5; }
        function edgeDist(p) {
            let dx = Math.max(p.x - ccx, 0, ccx - (p.x + p.w));
            let dy = Math.max(p.y - ccy, 0, ccy - (p.y + p.h));
            return Math.hypot(dx, dy);
        }
        parents.sort((a, b) => (b.k - a.k) || (edgeDist(b) - edgeDist(a))); // am weitesten vom Schwerpunkt zuerst
        let best_parent = parents[0];
        if (best_parent.__stripEnd) lastEndPerParent.set(best_parent.parent_id, best_parent.__stripEnd);

        best_parent.cut_time = tick; // kein "-0.4"-Versatz noetig: Tick ist bereits eindeutig monoton

        // Robuste Schnittrichtung: schneide immer die LAENGERE Seite (nicht
        // nach k-Paritaet) - noetig, sobald bei einem exakten Quadrat frei
        // gewaehlt wird, sonst wuerden nachfolgende Schnitte falsch herum
        // gehen und die Stellenwert-Groessen kaputt machen.
        const EPS = 1e-9;
        let is_vert_cut;
        if (best_parent.w > best_parent.h + EPS) is_vert_cut = true;
        else if (best_parent.h > best_parent.w + EPS) is_vert_cut = false;
        else {
            // Exaktes Quadrat: echte freie Wahl, keine Groessenauswirkung.
            if (squareSplit === 'fixed') is_vert_cut = true;
            else is_vert_cut = ((best_parent.k / 2) % 2 === 0); // 'alternating': haengt an k, nicht an zeitlicher Reihenfolge
        }
        let cw = is_vert_cut ? best_parent.w / BASE : best_parent.w;
        let ch = is_vert_cut ? best_parent.h : best_parent.h / BASE;
        for (let i = 0; i < BASE; i++) {
            let child = {
                id: global_id++, parent_id: best_parent.id, k: best_parent.k + 1,
                x: best_parent.x + (is_vert_cut ? i * cw : 0),
                y: best_parent.y + (is_vert_cut ? 0 : i * ch),
                w: cw, h: ch, born_time: best_parent.cut_time, cut_time: Infinity, taken_time: Infinity, children: []
            };
            bank_pieces.push(child);
            best_parent.children.push(child);
        }
        return getPieceFromBank(target_k);
    }

    return {
        BASE, N_MAX, axes, TOTAL_STEPS,
        bank_pieces,          // Referenz - wird von getPieceFromBank mutiert
        getPieceFromBank,     // (target_k) -> {piece, tick}
        get currentTick() { return tick; }
    };
}

// ---------------------------------------------------------------------------
// TEIL 2: Kompaktierung ("Zeilen/Spalten ausblenden")
// ---------------------------------------------------------------------------
// Reine Funktionen, keine Abhaengigkeit von einer bestimmten Bank-Instanz -
// nehmen bank_pieces jeweils als Parameter entgegen.

function buildCompactionMap(pieces, axis) {
    let intervals = pieces.map(p => axis === 'x' ? [p.x, p.x + p.w] : [p.y, p.y + p.h]);
    intervals.sort((a, b) => a[0] - b[0]);
    let merged = [];
    for (let iv of intervals) {
        if (merged.length === 0 || iv[0] > merged[merged.length - 1][1] + 1e-9) merged.push([iv[0], iv[1]]);
        else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
    }
    let prefix = [0];
    for (let iv of merged) prefix.push(prefix[prefix.length - 1] + (iv[1] - iv[0]));
    function compact(coord) {
        for (let i = 0; i < merged.length; i++) {
            if (coord >= merged[i][0] - 1e-9 && coord <= merged[i][1] + 1e-9) return prefix[i] + Math.max(0, coord - merged[i][0]);
        }
        for (let i = 0; i < merged.length; i++) if (coord < merged[i][0]) return prefix[i];
        return prefix[prefix.length - 1];
    }
    return { compact, totalOccupied: Math.max(prefix[prefix.length - 1], 1e-9) };
}

function computeCompactionAt(bank_pieces, tickValue) {
    let visible = bank_pieces.filter(p => tickValue >= p.born_time && tickValue < p.cut_time && tickValue < p.taken_time);
    if (visible.length === 0) return { mapX: x => x, mapY: y => y, totalW: 1, totalH: 1 };
    let mapX = buildCompactionMap(visible, 'x');
    let mapY = buildCompactionMap(visible, 'y');
    return { mapX: mapX.compact, mapY: mapY.compact, totalW: mapX.totalOccupied, totalH: mapY.totalOccupied };
}

// Wegpunkte: einer pro Tick, an dem sich die kompaktierte Flaeche verkleinert
// (Schwellwert=0 hat sich als voellig ausreichend fuer ruhiges Verhalten
// herausgestellt - siehe Gespraechsverlauf; ein Bewegungs-Schwellwert-Regler
// wurde bewusst NICHT eingebaut, weil er bei extremen Werten das erste
// Intervall "einfrieren" liess).
function computeCompactionWaypoints(bank_pieces, maxTick) {
    let allTicks = new Set([0]);
    for (let p of bank_pieces) {
        if (isFinite(p.taken_time)) allTicks.add(p.taken_time);
        if (isFinite(p.cut_time)) allTicks.add(p.cut_time);
    }
    allTicks.add(maxTick);
    allTicks = Array.from(allTicks).sort((a, b) => a - b);

    let waypoints = [];
    let lastArea = Infinity;
    for (let t of allTicks) {
        let comp = computeCompactionAt(bank_pieces, t);
        let area = comp.totalW * comp.totalH;
        if (waypoints.length === 0 || area < lastArea) {
            let z = Math.min(1 / comp.totalW, 1 / comp.totalH);
            waypoints.push({ t, mapX: comp.mapX, mapY: comp.mapY, totalW: comp.totalW, totalH: comp.totalH, z });
            lastArea = area;
        }
    }
    let lastT = allTicks[allTicks.length - 1];
    if (waypoints.length === 0 || waypoints[waypoints.length - 1].t !== lastT) {
        let comp = computeCompactionAt(bank_pieces, lastT);
        let z = Math.min(1 / comp.totalW, 1 / comp.totalH);
        waypoints.push({ t: lastT, mapX: comp.mapX, mapY: comp.mapY, totalW: comp.totalW, totalH: comp.totalH, z });
    }
    return waypoints;
}

function compactedRectAt(piece, waypoint) {
    let cx = waypoint.mapX(piece.x), cy = waypoint.mapY(piece.y);
    let cw = waypoint.mapX(piece.x + piece.w) - cx;
    let ch = waypoint.mapY(piece.y + piece.h) - cy;
    let zx = 0.5 + (cx - waypoint.totalW / 2) * waypoint.z;
    let zy = 0.5 + (cy - waypoint.totalH / 2) * waypoint.z;
    return { x: zx, y: zy, w: cw * waypoint.z, h: ch * waypoint.z };
}

// Gedaempfte Ueberblendung (kausaler Exponentialkern, wie beim Zoom) ueber
// ALLE Wegpunkte - fuer JEDES Stueck mit denselben Gewichten (nicht auf seine
// eigene Sichtbarkeit beschraenkt!). Das ist entscheidend fuer Ordnungstreue:
// zwei Stuecke, die an jedem Wegpunkt eine bestimmte Reihenfolge haben,
// behalten diese nach der gewichteten Mischung garantiert bei.
function getSmoothedCompactedRect(piece, waypoints, time, TAU) {
    if (waypoints.length === 0) return null;
    let k = 1 / TAU;
    function F(tp) { return Math.exp(-k * (time - tp)); }
    let n = 0;
    for (let i = 1; i < waypoints.length; i++) { if (time >= waypoints[i].t) n = i; else break; }

    let wFirst = F(waypoints[0].t);
    let r0 = compactedRectAt(piece, waypoints[0]);
    let ax = r0.x * wFirst, ay = r0.y * wFirst, aw = r0.w * wFirst, ah = r0.h * wFirst;
    for (let i = 0; i < n; i++) {
        let w = F(waypoints[i + 1].t) - F(waypoints[i].t);
        let r = compactedRectAt(piece, waypoints[i]);
        ax += r.x * w; ay += r.y * w; aw += r.w * w; ah += r.h * w;
    }
    let rN = compactedRectAt(piece, waypoints[n]);
    let wLast = F(time) - F(waypoints[n].t);
    ax += rN.x * wLast; ay += rN.y * wLast; aw += rN.w * wLast; ah += rN.h * wLast;
    return { x: ax, y: ay, w: aw, h: ah };
}

// ---------------------------------------------------------------------------
// TEIL 3: Bijektive Tick <-> Zeit Abbildung (fuer das Haupttool)
// ---------------------------------------------------------------------------
// Das Haupttool hat zusaetzlich zur Tick-Zaehlung eine kontinuierliche
// Animationszeit (fuer die Flug-Animation). buildTickTimeMapping() erstellt
// aus einer Liste von (tick, action_time)-Paaren (in der Reihenfolge, in der
// getPieceFromBank sie geliefert hat) eine bijektive Abbildung in beide
// Richtungen.
function buildTickTimeMapping(tickTimePairs) {
    // tickTimePairs: [{tick, time}, ...] - nach tick sortiert (1,2,3,...)
    let sorted = tickTimePairs.slice().sort((a, b) => a.tick - b.tick);
    let tickToTimeArr = [0]; // Index 0 = Tick 0 = Zeitpunkt 0 (vor der ersten Entnahme)
    for (let p of sorted) tickToTimeArr[p.tick] = p.time;

    function tickToTime(t) {
        let lo = Math.max(0, Math.min(tickToTimeArr.length - 1, Math.floor(t)));
        let hi = Math.min(tickToTimeArr.length - 1, lo + 1);
        let frac = t - lo;
        if (hi >= tickToTimeArr.length) return tickToTimeArr[tickToTimeArr.length - 1];
        return tickToTimeArr[lo] + (tickToTimeArr[hi] - tickToTimeArr[lo]) * frac;
    }

    // Inverse: gegebene Animationszeit -> aequivalenter (ggf. gebrochener) Tick
    function timeToTick(time) {
        // binäre Suche im monoton wachsenden tickToTimeArr
        let lo = 0, hi = tickToTimeArr.length - 1;
        if (time <= tickToTimeArr[0]) return 0;
        if (time >= tickToTimeArr[hi]) return hi;
        while (hi - lo > 1) {
            let mid = (lo + hi) >> 1;
            if (tickToTimeArr[mid] <= time) lo = mid; else hi = mid;
        }
        let span = tickToTimeArr[hi] - tickToTimeArr[lo];
        let frac = span > 1e-12 ? (time - tickToTimeArr[lo]) / span : 0;
        return lo + frac;
    }

    return { tickToTime, timeToTick, maxTick: tickToTimeArr.length - 1 };
}

// Fuer Node-Tests (require) UND direkte Einbindung per <script> gleichermassen nutzbar:
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createBankSimulation, buildCompactionMap, computeCompactionAt,
        computeCompactionWaypoints, compactedRectAt, getSmoothedCompactedRect,
        buildTickTimeMapping
    };
}
```

## 9. Z/R-Transformationsmodi (separates, noch offenes Thema)

Im Haupttool gibt es historisch drei Flug-Animationsmodi für die Ziel-Seite: **Z** (Zerschneiden/Montessori-Stil), **R** (Rotieren/Festkörper), **S** (Strecken/Morphing). Z und R hatten Bugs (teilweise gefixt: Doppel-Zeichnung bei Z_source, falsche Zielgröße bei R_macro), wurden aber auf Wunsch des Nutzers **komplett deaktiviert** (nur noch S in der UI wählbar), da nur noch mit S getestet wurde. Der Code für Z/R ist im Haupttool als Kommentar erhalten (nicht gelöscht), für eine spätere Neuimplementierung.

**Anforderung für die Neuimplementierung (vom Nutzer explizit genannt):** Alle Übergänge müssen **C¹-stetig** sein (Ableitung stetig, kein "Stop-and-Go"). Erkenntnis dazu: Die Positions-Interpolation nutzte bereits Smoothstep (gut), aber die Alpha-Ein-/Ausblendungen bei Z (Z_source ausblenden, Z_micro ein-/ausblenden, Z_ghost einblenden) nutzten **lineare** Rampen (`Math.min`/`Math.max`) - das erzeugt Geschwindigkeitssprünge an den Rändern. Lösung (angedacht, noch nicht umgesetzt): alle Alpha-Übergänge auf Smoothstep umstellen, mit überlappenden Crossfade-Fenstern (z.B. 0.3 Zeiteinheiten) zwischen Z_source→Z_micro und Z_micro→Z_ghost, statt harter Cutoffs.

**Dieses Thema wurde in der Session unterbrochen** (Nutzer korrigierte: "Sprechen wir über das gleiche? Ich war bei der ... Kompaktierungs-Transformation" - das Z/R-Thema ist also nur angedacht, nicht begonnen worden in Code).

## 10. Zukünftige Vision (noch nicht begonnen)

- QR-Code-Verbindung: Besucher scannt Code am Exponat, öffnet Steuerung auf eigenem Gerät (Handy). Braucht echte Backend-Infrastruktur (WebSocket-Relay oder Realtime-Dienst wie Firebase/Supabase/Ably) - nicht mit einer reinen HTML-Datei machbar.
- Mehrbildschirm-Betrieb: Ziel/Rest/Steuerung auf getrennten physischen Displays. Innerhalb eines Rechners mit mehreren Fenstern schon heute simulierbar über die `BroadcastChannel`-API (kein Server nötig) - noch nicht umgesetzt. Würde ein gemeinsames Layout-Konfigurationsobjekt brauchen (z.B. `{ziel: {x,y,breite}, rest: {x,y,breite}, ...}`), damit jedes Fenster seine Position im gemeinsamen Koordinatenraum kennt.
- Admin-konfigurierbare Steuerungs-Komplexität: sobald die Grundarchitektur (siehe oben) steht, "nur" ein Konfigurationsobjekt, welche Regler für Besucher sichtbar sind.

## 11. Empfohlene nächste Schritte (Priorität)

1. **Sofort:** `shared/bank-core.js` sichern (Inhalt siehe Abschnitt 8) - liegt nur in der Sandbox, nicht in Outputs!
2. Test-Tool (`selection_strategy_prototype.html`, gerade neu gebaut) im Browser verifizieren - Node-Test war erfolgreich, DOM/UI noch offen.
3. Haupttool auf `bank-core.js` umstellen (größere Aufgabe: bijektive Zeit-Abbildung einbauen, Kompaktierung ergänzen).
4. Tiefe-Standardwert im Haupttool klären/synchronisieren.
5. Erst danach: Z/R-Transformationsmodi neu aufbauen (C¹-stetig, siehe Abschnitt 9) - eigenständiges Thema, nicht mit Punkt 1-4 vermischen.
