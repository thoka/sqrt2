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
