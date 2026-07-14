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

import { buildMonotoneSplineBundle } from './smoothing.js';

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
    squareSplit = squareSplit || 'fixed'; // 'fixed' oder 'alternating'
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
    let tick = 1;

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

    function getPieceFromBank(target_k) {
        let available = filterToStripEnds(bank_pieces.filter(p => p.k === target_k && p.taken_time === Infinity && p.cut_time === Infinity));
        if (available.length > 0) {
            available.sort((a, b) => isolationScore(a, tick) - isolationScore(b, tick));
            let chosen = available[0];
            chosen.taken_time = tick;

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

        best_parent.cut_time = tick;

        const EPS = 1e-9;
        let is_vert_cut;
        if (best_parent.w > best_parent.h + EPS) is_vert_cut = true;
        else if (best_parent.h > best_parent.w + EPS) is_vert_cut = false;
        else {
            // Exaktes Quadrat: echte freie Wahl, keine Groessenauswirkung.
            if (squareSplit === 'fixed') is_vert_cut = true;
            else is_vert_cut = ((best_parent.k / 2) % 2 === 0);
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
// TEIL 1b: Shell-Konstruktion (bestimmt, in welcher Reihenfolge und mit
// welcher Ziel-Groesse getPieceFromBank aufgerufen wird - simuliert den
// echten Aufbau des Ziel-Quadrats schalenweise).
// ---------------------------------------------------------------------------
//
// Fuer Positionen am "oberen Rand" einer Schale (is_top) gibt es zwei
// Betriebsarten, ueber cellMode gewaehlt - beide nutzen denselben
// Auswahl-/Schneide-Algorithmus, unterscheiden sich nur darin, WIE VIELE
// Stuecke pro Rand-Zelle aus der Bank geholt werden:
//
//  - 'subdivide' (Default, "Zerschneiden"/Montessori-Stil): es werden BASE
//    Stuecke der NAECHSTEN, feineren Ebene (k+1) entnommen statt eines
//    einzelnen Stuecks der Ebene k - der Rand einer Schale entspricht immer
//    der naechsten Ziffern-Stelle (siehe README Abschnitt 6). Wird das
//    ausgelassen (wie einst versehentlich beim Portieren auf bank-core.js
//    passiert), verschiebt sich die gesamte Entnahme-Reihenfolge und das
//    Ergebnis sieht spuerbar "unruhiger" aus, obwohl der Auswahl-/
//    Schneide-Algorithmus selbst unveraendert ist. Das ist der Modus, den
//    das Algorithmus-Spiel-Tool (selection_strategy_prototype.html) nutzt.
//  - 'morph' ("Strecken"): nimmt ein einzelnes Stueck der Ebene k direkt aus
//    der Bank (keine Unterteilung) - das Stueck wird beim Rendern in die
//    Zielzelle gestreckt/gemorpht. Das nutzt das Haupttool im Morphing-
//    Flugmodus (siehe sqrt2.html).
//
// Jeder getPieceFromBank()-Aufruf wird als "Event" mit Gitterposition (u,v),
// Gruppengroesse (count) und Index innerhalb der Gruppe (i) zurueckgegeben -
// das gibt Aufrufern (z.B. dem Haupttool) genug Information, um daraus ihre
// eigene Animations-/Render-Pipeline zu bauen, ohne die Schalen-Konstruktion
// selbst zu duplizieren.
export function buildSystem(BASE, N_MAX, squareSplit, cellMode) {
    cellMode = cellMode || 'subdivide';
    let sim = createBankSimulation(BASE, N_MAX, squareSplit);
    let events = [];
    for (let S = 1; S < sim.TOTAL_STEPS; S++) {
        let shell = [];
        for (let v = 0; v < S; v++) shell.push({ u: S, v: v, is_top: false });
        for (let u = 0; u < S; u++) shell.push({ u: u, v: S, is_top: true });
        shell.push({ u: S, v: S, is_top: false });
        for (let sp of shell) {
            let k = sim.axes[sp.u].exp + sim.axes[sp.v].exp;
            if (sp.is_top && cellMode === 'subdivide') {
                for (let i = 0; i < BASE; i++) {
                    let { piece, tick } = sim.getPieceFromBank(k + 1);
                    events.push({ u: sp.u, v: sp.v, is_top: true, k: k + 1, piece, tick, i, count: BASE });
                }
            } else {
                let { piece, tick } = sim.getPieceFromBank(k);
                events.push({ u: sp.u, v: sp.v, is_top: sp.is_top, k, piece, tick, i: 0, count: 1 });
            }
        }
    }
    let local_max_time = sim.currentTick - 1;
    return { sim, local_max_time, events };
}

// ---------------------------------------------------------------------------
// TEIL 2: Kompaktierung ("Zeilen/Spalten ausblenden")
// ---------------------------------------------------------------------------
// Reine Funktionen, keine Abhaengigkeit von einer bestimmten Bank-Instanz -
// nehmen bank_pieces jeweils als Parameter entgegen.

export function buildCompactionMap(pieces, axis) {
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

export function computeCompactionAt(bank_pieces, tickValue) {
    let visible = bank_pieces.filter(p => tickValue >= p.born_time && tickValue < p.cut_time && tickValue < p.taken_time);
    if (visible.length === 0) return { mapX: x => x, mapY: y => y, totalW: 1, totalH: 1 };
    let mapX = buildCompactionMap(visible, 'x');
    let mapY = buildCompactionMap(visible, 'y');
    return { mapX: mapX.compact, mapY: mapY.compact, totalW: mapX.totalOccupied, totalH: mapY.totalOccupied };
}

export function computeCompactionWaypoints(bank_pieces, maxTick) {
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

export function compactedRectAt(piece, waypoint) {
    let cx = waypoint.mapX(piece.x), cy = waypoint.mapY(piece.y);
    let cw = waypoint.mapX(piece.x + piece.w) - cx;
    let ch = waypoint.mapY(piece.y + piece.h) - cy;
    let zx = 0.5 + (cx - waypoint.totalW / 2) * waypoint.z;
    let zy = 0.5 + (cy - waypoint.totalH / 2) * waypoint.z;
    return { x: zx, y: zy, w: cw * waypoint.z, h: ch * waypoint.z };
}

// Glättet den Kompaktierungs-Sprung zwischen Waypoints per monotoner
// kubischer Hermite-Interpolation (siehe smoothing.js) statt eines eigenen
// Exponentialkerns - kein TAU-Parameter mehr nötig (keine Zeitkonstante,
// exakte Interpolation statt Abkling-Filter) und C¹- statt nur C⁰-stetig.
export function getSmoothedCompactedRect(piece, waypoints, time) {
    if (waypoints.length === 0) return null;
    let points = waypoints.map(wp => ({ t: wp.t, ...compactedRectAt(piece, wp) }));
    let bundle = buildMonotoneSplineBundle(points, ['x', 'y', 'w', 'h']);
    return bundle.at(time);
}

// getSmoothedCompactedRect() baut bei JEDEM Aufruf die komplette Spline neu
// (O(Waypoints) Tangentenberechnung) - beim Rendern (ein Aufruf pro
// sichtbarem Stück, pro Frame) gemessen ein echtes Performance-Problem, kein
// Fall von vorzeitiger Optimierung: bei Tiefe 16 kostete das ~15-24ms für
// nur 46-64 sichtbare Stücke - über dem 16.7ms-Budget für 60fps (siehe
// Gesprächsverlauf/CLAUDE.md "Measure before optimizing").
//
// makeCompactedRectLookup(waypoints) baut die Spline pro Stück nur EINMAL
// (beim ersten Abfragen, per piece.id gecacht) und wertet sie danach nur
// noch aus (O(log Waypoints) statt O(Waypoints) pro Frame) - Waypoints
// bleiben dabei fest (ein neuer Lookup pro Kompilierung/computeCompaction-
// Waypoints()-Aufruf, siehe Aufrufer). Bewusst NICHT eager für alle
// bank_pieces vorberechnet (könnte bei tiefer Rekursion hunderte MB
// belegen, siehe Messung oben) - nur tatsächlich abgefragte (also
// tatsächlich gerenderte) Stücke bekommen eine Spline.
export function makeCompactedRectLookup(waypoints) {
    let cache = new Map();
    return function (piece, time) {
        if (waypoints.length === 0) return null;
        let bundle = cache.get(piece.id);
        if (!bundle) {
            let points = waypoints.map(wp => ({ t: wp.t, ...compactedRectAt(piece, wp) }));
            bundle = buildMonotoneSplineBundle(points, ['x', 'y', 'w', 'h']);
            cache.set(piece.id, bundle);
        }
        return bundle.at(time);
    };
}

// ---------------------------------------------------------------------------
// TEIL 3: Bijektive Tick <-> Zeit Abbildung (fuer das Haupttool)
// ---------------------------------------------------------------------------
// Das Haupttool hat zusaetzlich zur Tick-Zaehlung eine kontinuierliche
// Animationszeit (fuer die Flug-Animation). buildTickTimeMapping() erstellt
// aus einer Liste von (tick, action_time)-Paaren (in der Reihenfolge, in der
// getPieceFromBank sie geliefert hat) eine bijektive Abbildung in beide
// Richtungen.
export function buildTickTimeMapping(tickTimePairs) {
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

export { createBankSimulation };

// Fuer Node-Tests (require) UND direkte Einbindung per <script> gleichermassen nutzbar:
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createBankSimulation, buildSystem, buildCompactionMap, computeCompactionAt,
        computeCompactionWaypoints, compactedRectAt, getSmoothedCompactedRect,
        buildTickTimeMapping
    };
}
