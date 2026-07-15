// Reine Compiler-Logik aus sqrt2.html extrahiert (TOOLING_SPEC.md Phase 1).
// Kein DOM-Zugriff hier: Config rein, kompilierter Zustand raus - das macht
// diese Funktion sowohl per node --test testbar als auch später (Phase 2)
// als deterministische Basis für den derived `compiledStore` wiederverwendbar.
import { buildSystem, buildTickTimeMapping, computeCompactionWaypoints, makeCompactedLogicalRectLookup, computeCompactionFitStates } from '../../bank-core.js';
import { buildMonotoneSpline, buildDampedFilterBundle } from '../../smoothing.js';

export function compileSystem(config) {
    const { base: BASE, depth: N_MAX, transformMode, bankZoomThresholdPowers: BANK_ZOOM_THRESHOLD_POWERS, zoomSpeedCoef, compactionEnabled, compactionTransitionTicks } = config;

    // Beste validierte Kombination fest einprogrammiert (siehe README) -
    // das Haupttool bietet dafür bewusst keine eigene Auswahl an (nur den
    // Flug-Modus). Die Schalen-Konstruktion selbst (welche/wie viele Stücke
    // pro Gitterzelle) kommt aus bank-core.js (buildSystem) - gemeinsam mit
    // dem Test-Tool genutzt, statt einer eigenen Kopie der Schalen-Schleife.
    // cellMode 'morph' (S: Strecken) nimmt ein Stück direkt, 'subdivide'
    // (Z: Zerschneiden) BASE Stücke der nächsten Ebene pro Rand-Zelle -
    // siehe bank-core.js für Details.
    let cellMode = transformMode === 'Z' ? 'subdivide' : 'morph';
    let { sim, events } = buildSystem(BASE, N_MAX, 'fixed', cellMode);
    let axes = sim.axes;
    let TOTAL_STEPS = sim.TOTAL_STEPS;
    let bank_pieces = sim.bank_pieces;

    // n_arr[m] (Ziffer an Stelle m) ergibt sich direkt aus der Anzahl der
    // axes-Einträge mit exp===m - genau so hat bank-core.js sie erzeugt.
    let n_arr = new Array(N_MAX + 1).fill(0);
    for (let a of axes) n_arr[a.exp]++;

    // P_FINAL = Summe aller Achsen-Breiten (b^-exp) inkl. des Basisquadrats
    // (exp=0) - exakt der Wert, den axes[axes.length-1].cumulative früher lieferte.
    let P_FINAL = axes.reduce((sum, a) => sum + Math.pow(BASE, -a.exp), 0);

    let render_pipeline = [];
    let tickTimePairs = [];
    let global_time = 1.0;
    let local_max_time = 1.0;

    // PATCH V28b: Bugfix "Bank ist leer" bei größerer Tiefe.
    // Vorher wurde global_time zu Beginn jeder Schale S hart auf S*3.0
    // zurueckgesetzt. Eine Schale hat aber (2*S+1) Stuecke, die je 0.15
    // Zeiteinheiten verbrauchen. Sobald (2*S+1)*0.15 > 3.0 ist (ab S~10),
    // lief die Zeit ueber das naechste Reset-Ziel hinaus - der naechste
    // Reset sprang dann RUECKWAERTS in der Zeit. Ausserdem braucht
    // buildTickTimeMapping() weiter unten monoton wachsende t_fly-Werte,
    // um Tick <-> Zeit eindeutig umzurechnen - ein Zeitsprung rueckwaerts
    // wuerde diese Abbildung brechen.
    //
    // Fix: kein absolutes Reset mehr, sondern ein garantiert positiver
    // Abstand ("gap") zum tatsaechlichen Ende der vorherigen Schale.
    // Damit ist global_time global monoton steigend, unabhaengig davon
    // wie viele Stuecke eine Schale enthaelt.
    const SHELL_GAP = 1.0;
    let shell_start_time = new Array(TOTAL_STEPS).fill(0);

    // events (aus bank-core.js buildSystem) sind bereits in der exakten
    // Entnahme-Reihenfolge sortiert. Eine Rand-Zelle im Zerschneiden-Modus
    // erscheint als `count` aufeinanderfolgende Events mit derselben
    // Gitterposition (u,v) - diese werden hier zu EINER Zerschneiden-Gruppe
    // (Z_source/Z_ghost/Z_micro) zusammengefasst, die anderen (count===1)
    // direkt zu S_macro/Z_direct.
    let lastS = 0;
    let idx = 0;
    while (idx < events.length) {
        let e = events[idx];
        let S = Math.max(e.u, e.v);
        if (S !== lastS) {
            global_time += SHELL_GAP;
            shell_start_time[S] = global_time;
            lastS = S;
        }

        if (e.count === 1) {
            let t_fly = global_time;
            tickTimePairs.push({ tick: e.tick, time: t_fly });
            if (e.is_top) {
                render_pipeline.push({ type: 'S_macro', bp: e.piece, u: e.u, v: e.v, time_fly: t_fly });
            } else {
                render_pipeline.push({ type: 'Z_direct', bp: e.piece, u: e.u, v: e.v, time_fly: t_fly });
            }
            local_max_time = Math.max(local_max_time, t_fly + 1.0);
            global_time += 0.15;
            idx++;
        } else {
            // Zerschneiden-Gruppe: das ganze Elternstück wird sichtbar
            // "aufgeschnitten" (Z_source -> Z_micro) und beim Zurückspulen
            // wieder "verschmolzen" (Z_ghost). BEKANNTER OFFENER BUG (siehe
            // README Abschnitt 8): die Rück-Verschmelzung ist noch nicht
            // vollständig animiert/verifiziert - absichtlich noch nicht
            // weiter gefixt, siehe Gesprächsverlauf.
            let group = events.slice(idx, idx + e.count);
            let t_cut = global_time - 0.5;
            let t_fly = global_time;
            let t_fuse = global_time + 1.0;
            let parent_bp = bank_pieces.find(p => p.id === group[0].piece.parent_id);
            render_pipeline.push({ type: 'Z_source', bp: parent_bp, u: e.u, v: e.v, time_cut: t_cut });
            render_pipeline.push({ type: 'Z_ghost', bp: parent_bp, u: e.u, v: e.v, time_fuse: t_fuse });
            for (let g of group) {
                tickTimePairs.push({ tick: g.tick, time: t_cut });
                render_pipeline.push({ type: 'Z_micro', bp: g.piece, u: e.u, v: e.v, i: g.i, time_cut: t_cut, time_fly: t_fly, time_fuse: t_fuse });
            }
            local_max_time = Math.max(local_max_time, t_fuse + 0.5);
            global_time += 0.15;
            idx += e.count;
        }
    }

    // bank-core.js zählt Entnahmen nur als monotonen Integer-Tick (siehe
    // Kommentar oben in bank-core.js, TEIL 3). Die bijektive Abbildung
    // übersetzt jeden Tick zurück in die kontinuierliche Animationszeit
    // dieses Tools; ein kleiner Versatz auf cut_time/born_time reproduziert
    // den alten Vorlauf ("Stück ist schon sichtbar geschnitten, bevor es
    // fliegt"). WICHTIG: dieser Versatz muss strikt kleiner sein als der
    // kleinstmögliche Abstand zwischen zwei aufeinanderfolgenden Ticks
    // (0.15, siehe global_time-Inkremente oben) - sonst kann ein Schnitt-
    // Ereignis aus einem SPÄTEREN Tick durch den Versatz vor die Entnahme
    // eines NAHEN, aber früheren Ticks rutschen und die Sichtbarkeits-
    // Reihenfolge verfälschen (führte zu Bank-Zuständen, die vom Test-Tool
    // bei gleichem Tick abwichen - mit 0.4 empirisch an vielen Ticks
    // reproduzierbar, mit 0.1 an keinem einzigen mehr).
    const CUT_BORN_LEAD = 0.1;
    let ttm = buildTickTimeMapping(tickTimePairs);
    for (let p of bank_pieces) {
        p.taken_time = isFinite(p.taken_time) ? ttm.tickToTime(p.taken_time) : Infinity;
        p.cut_time = isFinite(p.cut_time) ? ttm.tickToTime(p.cut_time) - CUT_BORN_LEAD : Infinity;
        p.born_time = p.born_time === 0 ? 0 : ttm.tickToTime(p.born_time) - CUT_BORN_LEAD;
    }

    // Auto-Zoom-Ziel (Ziel-Seite): pro Schale S der Exponent der tiefsten in
    // dieser Schale neu sichtbaren Ziffern-Stelle - wächst mit der Animation
    // von 0 (nur Basisquadrat) bis N_MAX, nicht von Anfang an fix auf N_MAX.
    //
    // Nutzt buildMonotoneSpline() (siehe smoothing.js) statt eines kausalen
    // Filters: die Kurve trifft an JEDEM Checkpoint GENAU den dortigen
    // Exponenten - kein Nachhinken mehr. Für eine monoton wachsende
    // Stützpunkt-Folge bleibt die Spline zwischen zwei Checkpoints
    // garantiert innerhalb von deren Werten (Monotonie-Erhalt, siehe
    // smoothing.js) - das allein reicht bereits als Sichtbarkeits-Garantie,
    // siehe smoothing.test.js.
    //
    // { onlyChanges: true }: axes[S].exp wiederholt sich über mehrere
    // Schalen hinweg (bei Basis 10/Tiefe 16 sind nur 15 von 56 Schalen echte
    // Wertwechsel) - ohne diese Option erzwingt jeder Wiederholungspunkt
    // eine Nulltangente (siehe smoothing.js), was jeden Wertwechsel zu einer
    // isolierten Mini-Rampe zwischen "toten" Haltepunkten macht. Die
    // Sichtbarkeits-Garantie bleibt dabei erhalten (siehe
    // smoothing.test.js/auto-zoom-visibility.test.js).
    let GLOBAL_AUTO_ZOOM_CHECKPOINTS = [];
    for (let S = 0; S < TOTAL_STEPS; S++) {
        GLOBAL_AUTO_ZOOM_CHECKPOINTS.push({ t: shell_start_time[S], exp: axes[S].exp });
    }
    let GLOBAL_AUTO_ZOOM_SPLINE = buildMonotoneSpline(
        GLOBAL_AUTO_ZOOM_CHECKPOINTS.map(c => ({ t: c.t, v: c.exp })),
        { onlyChanges: true }
    );

    // PATCH V32: Auto-Zoom für die Bank - Zentrum und Zoom werden pro
    // Checkpoint aus der ECHTEN Bounding-Box (samt ihres eigenen
    // Mittelpunkts) berechnet, statt aus einem festen Zentrum 0.5/0.5 (der
    // Rest verlagert sich systematisch zu einer Seite hin, siehe README).
    // Damit eine Überblendung zwischen zwei verschiedenen Zentren dennoch
    // garantiert sicher bleibt, wird zwischen den fertig transformierten
    // BILDSCHIRM-POSITIONEN interpoliert (siehe getBankTransformed() in
    // sqrt2.html): für einen während des Übergangs sichtbaren Punkt liegt
    // sowohl die alte als auch die neue Position nachweislich in [0,1]
    // (Box-Schachtelung: die Box schrumpft monoton). Da [0,1] konvex ist,
    // liegt JEDE gewichtete Mischung dieser zwei sicheren Positionen
    // ebenfalls in [0,1] - unabhängig davon, wie stark sich das Zentrum
    // zwischen den Checkpoints verschiebt.
    //
    // Checkpoints kommen aus den tatsächlichen Entnahme-Zeitpunkten (viel
    // feinkörniger als "einmal pro Schale"), bei sehr tiefer Rekursion auf
    // eine Obergrenze heruntergesampelt, um die Kompilierzeit zu begrenzen.
    // PATCH V39: Kein Sicherheitsrand mehr (war 0.2) - der Zoom beim
    // Startzustand (volles [0,1]-Quadrat) ist damit exakt 1.0, nachweislich
    // der garantierte MINIMALE Zoom über die gesamte Laufzeit.
    const ZOOM_MARGIN = 0;
    const MAX_CHECKPOINTS = 400;

    let eventTimesSet = new Set([0]);
    for (let p of bank_pieces) { if (isFinite(p.taken_time)) eventTimesSet.add(p.taken_time); }
    eventTimesSet.add(local_max_time);
    let eventTimes = Array.from(eventTimesSet).sort((a, b) => a - b);
    if (eventTimes.length > MAX_CHECKPOINTS) {
        let sampled = [];
        for (let i = 0; i < MAX_CHECKPOINTS; i++) {
            sampled.push(eventTimes[Math.floor(i * (eventTimes.length - 1) / (MAX_CHECKPOINTS - 1))]);
        }
        eventTimes = Array.from(new Set(sampled));
    }

    // PATCH V35: Zoom-Schwellwert aus dem Algorithmus-Spiel-Tool
    // übernommen. Stücke, die mehr als BANK_ZOOM_THRESHOLD_POWERS Potenzen
    // von BASE kleiner sind als das größte gerade sichtbare Stück, fließen
    // NICHT ins Zoom-Framing ein (werden aber weiter gezeichnet) -
    // verhindert, dass ein einzelner winziger Einzelgänger den Zoom aufhält.
    const kThresholdDiff = 2 * BANK_ZOOM_THRESHOLD_POWERS;
    let bank_zoom_states = new Array(eventTimes.length);
    for (let i = 0; i < eventTimes.length; i++) {
        let t = eventTimes[i];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, found = false;
        let area = 0;
        let visibleNow = bank_pieces.filter(p => t >= p.born_time && t < p.cut_time && t < p.taken_time);
        let kMin = visibleNow.length > 0 ? Math.min(...visibleNow.map(p => p.k)) : 0;
        for (let p of visibleNow) {
            area += p.w * p.h; // Fläche zählt IMMER, auch für ausgeblendete (nur fürs Framing irrelevant)
            if (BANK_ZOOM_THRESHOLD_POWERS > 0 && p.k > kMin + kThresholdDiff) continue;
            found = true;
            if (p.x < minX) minX = p.x;
            if (p.x + p.w > maxX) maxX = p.x + p.w;
            if (p.y < minY) minY = p.y;
            if (p.y + p.h > maxY) maxY = p.y + p.h;
        }
        if (!found) { minX = 0; maxX = 1; minY = 0; maxY = 1; area = 1; }
        let cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        let halfW = Math.max((maxX - minX) / 2, 1e-9) * (1 + ZOOM_MARGIN);
        let halfH = Math.max((maxY - minY) / 2, 1e-9) * (1 + ZOOM_MARGIN);
        let z = Math.min(0.5 / halfW, 0.5 / halfH);
        let offsetX = 0.5 - cx * z, offsetY = 0.5 - cy * z;
        bank_zoom_states[i] = { z, cx, cy, offsetX, offsetY, area };
    }

    // buildDampedFilterBundle() statt buildMonotoneSplineBundle(): der
    // Bank-Zoom hat bis zu MAX_CHECKPOINTS=400 dicht getaktete Wegpunkte
    // (oft nur einen Tick auseinander) - eine exakte Spline reagiert auf
    // JEDEN davon sofort, was sich als unruhige/zappelige Bewegung zeigt.
    // Der Bank-Zoom BRAUCHT diese Exaktheit auch gar nicht: sein
    // Sicherheitsbeweis ("Konvexkombination bereits sicherer Positionen
    // bleibt sicher") gilt für JEDE Zeitkonstante TAU, siehe README
    // Abschnitt 6.1 - anders als beim Auto-Zoom-Exponenten oben (dort MUSS
    // jeder Wegpunkt exakt getroffen werden). Der Koeffizient (Anteil von
    // local_max_time) ist einstellbar (zoomSpeedCoef, "Trägheit").
    const BANK_ZOOM_TAU = Math.max(local_max_time * zoomSpeedCoef, 0.5);
    let GLOBAL_BANK_ZOOM_SPLINE = buildDampedFilterBundle(
        eventTimes.map((t, i) => ({ t, ...bank_zoom_states[i] })),
        ['z', 'offsetX', 'offsetY', 'area'],
        BANK_ZOOM_TAU
    );

    // Kompaktierung ("Zeilen/Spalten ausblenden", siehe bank-core.js TEIL 2)
    // - nur berechnet, wenn die Einstellung aktiv ist (nicht kostenlos bei
    // tiefer Rekursion). Ersetzt bei aktiver Kompaktierung den obigen
    // bankT-basierten Auto-Zoom für die Bank-Darstellung vollständig (siehe
    // project() in renderFrame()) - beide Modi sind bewusst gegenseitig
    // exklusiv, analog zum Algorithmus-Spiel-Tool.
    let GLOBAL_COMPACTION_WAYPOINTS = [];
    let GLOBAL_COMPACTION_LOGICAL_LOOKUP = null;
    let GLOBAL_COMPACTION_FIT_SPLINE = null;
    if (compactionEnabled) {
        // transitionTicks einstellbar (siehe README Abschnitt 6.2 "Siebte
        // Voraussetzung") - Default hier niedriger als der Bibliotheks-
        // Default in bank-core.js (weniger Wartezeit bis eine Lücke
        // sichtbar schließt).
        let transitionTicks = compactionTransitionTicks;
        if (!(transitionTicks >= 0)) transitionTicks = 3;
        GLOBAL_COMPACTION_WAYPOINTS = computeCompactionWaypoints(bank_pieces, local_max_time, transitionTicks);
        // Schnell/exakt: "wo steht jedes Stück im kompaktierten Layout"
        // (computeSegmentBlend()-basiert, für die Nichtüberlappungs-
        // Garantie - siehe bank-core.js).
        GLOBAL_COMPACTION_LOGICAL_LOOKUP = makeCompactedLogicalRectLookup(GLOBAL_COMPACTION_WAYPOINTS);
        // Gedämpft: "wie wird das Layout aufs [0,1]-Fenster gezoomt" -
        // dieselbe (einstellbare) Zeitkonstante wie beim regulären
        // Bank-Zoom oben, UNABHÄNGIG von den schnellen Logical-Rects.
        // Sicherheit bleibt erhalten, weil JEDE gemeinsame affine
        // Skalierung+Verschiebung Nichtüberlappung bewahrt, siehe
        // computeCompactionFitStates()-Kommentar.
        GLOBAL_COMPACTION_FIT_SPLINE = buildDampedFilterBundle(
            computeCompactionFitStates(GLOBAL_COMPACTION_WAYPOINTS),
            ['z', 'offsetX', 'offsetY'],
            BANK_ZOOM_TAU
        );
    }

    return {
        axes, TOTAL_STEPS, bank_pieces, render_pipeline,
        GLOBAL_N_ARR: n_arr,
        P_FINAL,
        GLOBAL_SHELL_START: shell_start_time,
        GLOBAL_TTM: ttm,
        GLOBAL_AUTO_ZOOM_CHECKPOINTS,
        GLOBAL_AUTO_ZOOM_SPLINE,
        GLOBAL_BANK_ZOOM_TIMES: eventTimes,
        GLOBAL_BANK_ZOOM: bank_zoom_states,
        GLOBAL_BANK_ZOOM_SPLINE,
        COMPACTION_ENABLED: compactionEnabled,
        GLOBAL_COMPACTION_WAYPOINTS,
        GLOBAL_COMPACTION_LOGICAL_LOOKUP,
        GLOBAL_COMPACTION_FIT_SPLINE,
        MAX_TIME: local_max_time,
    };
}
