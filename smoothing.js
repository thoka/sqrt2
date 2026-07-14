// ============================================================================
// SMOOTHING.JS - Generische, monoton erhaltende Glättung durch Stützpunkte
// ============================================================================
// Ersetzt die früher mehrfach unabhängig erfundenen Glättungs-Lösungen
// (kausaler Exponentialkern in getBankTransform()/getSmoothedCompactedRect(),
// kritisch gedämpfte Sprungantwort 2. Ordnung in getSmoothedAutoZoomExp()) -
// siehe CLAUDE.md, Abschnitt "Automatisierte Parameteränderungen".
//
// Methode: monotone kubische Hermite-Interpolation (Fritsch-Carlson), der
// Standardansatz für genau diese Anforderung - siehe
// https://en.wikipedia.org/wiki/Monotone_cubic_interpolation
//
//   - C¹-stetig überall, inklusive exakt AN jedem Stützpunkt (kein Sprung in
//     Wert oder Steigung).
//   - Trifft an jedem Stützpunkt exakt den vorgegebenen Wert (Interpolation,
//     keine Approximation) - GENAU zu diesem Zeitpunkt, ohne Verzögerung.
//     Das behebt strukturell den Bug, der die alten kausalen Filter plagte
//     (Wert hinkt dem zuletzt hinzugekommenen Stützpunkt eine Zeitkonstante
//     lang hinterher - siehe sqrt2.html-Historie zum Auto-Zoom-Bug).
//   - Überschwingt/unterschwingt NICHT zwischen zwei benachbarten
//     Stützpunkten mit gleichgerichteter Steigung (kein "Klingeln" wie bei
//     einem natürlichen kubischen Spline) - für eine monoton wachsende
//     Stützpunkt-Folge bleibt daher auch die gesamte Kurve monoton wachsend.
//   - Randtangenten werden bewusst auf 0 gepinnt (Abweichung vom
//     "natürlichen" Standardverfahren) - dadurch ist die Fortsetzung VOR dem
//     ersten und NACH dem letzten Stützpunkt exakt konstant, ohne an der
//     Naht selbst einen Knick in der Steigung zu erzeugen.
//
// Da nicht-kausal (die gesamte Stützpunkt-Reihe ist beim Aufruf schon
// bekannt), ohne Weiteres in beide Richtungen auswertbar - genau richtig für
// dieses Projekt, das ohnehin die komplette Animation vorab kompiliert und
// beliebig scrubbar macht (kein Live-/Streaming-Kontext, in dem Kausalität
// nötig wäre).
// ============================================================================

// Baut eine skalare Glättungsfunktion aus Stützpunkten { t, v }.
// Erwartet aufsteigend sortierte, im Rahmen von 1e-9 strikt wachsende t-Werte
// (Duplikate werden defensiv zusammengelegt, siehe unten) - reine Funktion,
// keine Seiteneffekte. Rückgabe: (time) => number, auswertbar für JEDES
// reelle time (konstante Fortsetzung außerhalb [t_min, t_max]).
//
// opts.onlyChanges (default false): wenn eine Stützpunkt-Quelle denselben
// Wert über viele Stützpunkte hinweg wiederholt (z.B. mehrere Schalen mit
// gleicher Ziffern-Tiefe), erzwingt JEDER dieser Wiederholungspunkte per
// Konstruktion eine Nulltangente (siehe Rescale-Schleife unten: d[i]===0
// zwingt m[i]=m[i+1]=0) - jeder tatsächliche Wertwechsel wird dadurch zu
// einer isolierten Mini-Rampe zwischen zwei "toten" Haltepunkten, was sich
// als sichtbare Abfolge "weicher Stufen" statt einer durchgehenden Bewegung
// zeigt (leicht zu verwechseln mit "zu viele Stützpunkte", liegt aber
// tatsächlich an WIEDERHOLTEN Werten, nicht an der Stützpunkt-DICHTE an
// sich - bei einer streng monoton wachsenden Folge OHNE Wiederholungen
// träte der Effekt nicht auf, siehe smoothing.test.js).
// Mit onlyChanges:true werden Folge-Stützpunkte mit UNVERÄNDERTEM Wert vor
// dem Spline-Aufbau verworfen (nur der jeweils ERSTE Punkt einer Wert-
// Plateau-Folge bleibt) - der reguläre Tangenten-Algorithmus verbindet die
// verbleibenden (jetzt streng unterschiedlichen) Werte dann mit einer
// durchgehend fließenden statt abgehackten Kurve. Trade-off: der Übergang
// beginnt dadurch bereits ab dem ERSTEN Auftreten des alten Werts (nicht
// erst kurz vor dem neuen) - der alte, exakte Zeitpunkt jedes Wertwechsels
// bleibt aber weiterhin exakt getroffen (Kern-Garantie bleibt erhalten).
export function buildMonotoneSpline(points, opts) {
    opts = opts || {};
    // Duplikate/nicht-monotone t-Werte defensiv entfernen (nachfolgende
    // Segment-Mathematik setzt strikt wachsende t voraus, sonst Division
    // durch Null) - im Normalfall bereits durch die Aufrufer sichergestellt
    // (z.B. per Set() dedupliziert), hier trotzdem zur Sicherheit.
    let pts = [];
    for (let p of points) {
        if (pts.length > 0 && p.t <= pts[pts.length - 1].t + 1e-9) continue;
        if (opts.onlyChanges && pts.length > 0 && p.v === pts[pts.length - 1].v) continue;
        pts.push(p);
    }

    if (pts.length === 0) return () => 0;
    if (pts.length === 1) { let v0 = pts[0].v; return () => v0; }

    let n = pts.length;
    let t = pts.map(p => p.t);
    let v = pts.map(p => p.v);

    // Sekanten-Steigung je Segment.
    let d = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) d[i] = (v[i + 1] - v[i]) / (t[i + 1] - t[i]);

    // Tangenten an den Stützpunkten. Ränder bewusst auf 0 gepinnt (siehe
    // Kommentar oben) statt der sonst üblichen einseitigen Sekanten-Schätzung.
    let m = new Array(n);
    m[0] = 0;
    m[n - 1] = 0;
    for (let i = 1; i < n - 1; i++) {
        if (d[i - 1] === 0 || d[i] === 0 || (d[i - 1] < 0) !== (d[i] < 0)) {
            // Lokales Extremum oder Vorzeichenwechsel der Sekanten - die
            // Tangente MUSS hier 0 sein, sonst überschwingt die Kurve.
            m[i] = 0;
        } else {
            // Gewichteter harmonischer Mittelwert (Fritsch-Butland-Formel) -
            // Standardwahl für den Startwert vor dem Rescale unten.
            let hL = t[i] - t[i - 1], hR = t[i + 1] - t[i];
            let w1 = 2 * hR + hL, w2 = hR + 2 * hL;
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
        }
    }

    // Fritsch-Carlson-Rescale je Segment: verhindert Überschwinger, falls
    // eine der beiden Randtangenten zu groß im Verhältnis zur Sekante ist
    // (alpha² + beta² > 9 ist das Standard-Monotonie-Kriterium).
    for (let i = 0; i < n - 1; i++) {
        if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
        let alpha = m[i] / d[i], beta = m[i + 1] / d[i];
        let s = alpha * alpha + beta * beta;
        if (s > 9) {
            let tau = 3 / Math.sqrt(s);
            m[i] = tau * alpha * d[i];
            m[i + 1] = tau * beta * d[i];
        }
    }

    return function at(time) {
        if (time <= t[0]) return v[0];
        if (time >= t[n - 1]) return v[n - 1];
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
            let mid = (lo + hi) >> 1;
            if (t[mid] <= time) lo = mid; else hi = mid;
        }
        let h = t[lo + 1] - t[lo];
        let s = (time - t[lo]) / h;
        let s2 = s * s, s3 = s2 * s;
        // Kubische Hermite-Basisfunktionen (h00, h10, h01, h11).
        let h00 = 2 * s3 - 3 * s2 + 1;
        let h10 = s3 - 2 * s2 + s;
        let h01 = -2 * s3 + 3 * s2;
        let h11 = s3 - s2;
        return h00 * v[lo] + h10 * h * m[lo] + h01 * v[lo + 1] + h11 * h * m[lo + 1];
    };
}

// Komfort-Wrapper für mehrere Felder, die dieselbe Zeitachse teilen (z.B.
// {t, z, offsetX, offsetY, area} - siehe getBankTransform() in sqrt2.html).
// points: Array von Objekten mit .t und den in `keys` genannten Feldern.
// opts: siehe buildMonotoneSpline() - gilt gleich für jedes Feld, aber JEDES
// Feld dedupliziert unabhängig anhand seiner EIGENEN Werte (ein Feld ohne
// Wiederholungen bleibt unangetastet, selbst wenn ein anderes Feld auf
// denselben Zeitpunkten viele Wiederholungen hat).
// Rückgabe: { at(time) => { [key]: number, ... } }.
export function buildMonotoneSplineBundle(points, keys, opts) {
    let splines = {};
    for (let k of keys) splines[k] = buildMonotoneSpline(points.map(p => ({ t: p.t, v: p[k] })), opts);
    return {
        at(time) {
            let result = {};
            for (let k of keys) result[k] = splines[k](time);
            return result;
        }
    };
}
