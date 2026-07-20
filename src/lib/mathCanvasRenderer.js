// mathCanvasRenderer.js — zeichnet Brueche/Exponenten auf einem Canvas-2D-
// Kontext, optisch angelehnt an MathJax' CHTML-Ausgabe (siehe mathMetrics.js
// + docs/MATHJAX_METRICS.md), OHNE MathJax zur Laufzeit zu laden.
//
// Aufbau in zwei Schichten (Testbarkeit, siehe AGENTS.md "Canvas/DOM nie nur
// per Unit-Test verifizieren"):
//   - layoutFraction()/layoutFractionPower(): REINE Geometrie, bekommen eine
//     `measure(text, fontPx) -> {width, ascent, descent}`-Funktion injiziert
//     statt selbst auf `ctx` zuzugreifen - dadurch mit einem Fake-Measurer
//     per `node --test` pruefbar (tests/unit/mathCanvasRenderer.test.js).
//   - drawFraction()/drawFractionPower(): duenne Canvas-Schicht, baut den
//     echten `ctx.measureText`-Adapter und fuehrt die eigentlichen
//     fillText()/fillRect()-Aufrufe anhand des Layouts aus - nur per
//     Build+E2E/visuell verifizierbar, siehe TargetBankCanvas.svelte.
import { MATH_METRICS } from './mathMetrics.js';

// Geometrie eines Bruchs num/den bei gegebener Grundschriftgroesse fontPx.
// Alle Positionen sind relativ zum ANKERPUNKT (0,0) = Mitte des Bruchstrichs
// (Canvas-Konvention: y waechst nach UNTEN - "y wird groesser" = "geht
// optisch nach unten"). `measure` wird NUR fuer die skalierte Zaehler-/
// Nenner-Schriftgroesse aufgerufen (`fontPx * SCRIPT_SCALE`).
export function layoutFraction(measure, numText, denText, fontPx) {
	const scriptFontPx = fontPx * MATH_METRICS.SCRIPT_SCALE;
	const thickness = fontPx * MATH_METRICS.RULE_THICKNESS;
	const gap = fontPx * MATH_METRICS.RULE_GAP;
	const numM = measure(numText, scriptFontPx);
	const denM = measure(denText, scriptFontPx);
	// Kleiner Ueberstand des Bruchstrichs ueber Zaehler/Nenner hinaus, wie
	// bei MathJax (dort deutlich groesser - siehe docs; hier bewusst
	// zurueckhaltender fuer die kompakten Achsen-Beschriftungen).
	const width = Math.max(numM.width, denM.width) + fontPx * 0.15;
	return {
		width,
		thickness,
		gap,
		scriptFontPx,
		// Grundlinien-Y relativ zum Anker (0 = Bruchstrich-Mitte).
		numBaselineY: -(thickness / 2 + gap),
		denBaselineY: thickness / 2 + gap + denM.ascent,
		numWidth: numM.width,
		denWidth: denM.width,
		numAscent: numM.ascent,
		numDescent: numM.descent,
		denAscent: denM.ascent,
		denDescent: denM.descent,
		// Gesamthoehe (oben=Zaehler-Ascent, unten=Nenner-Descent) - fuer die
		// Klammerhoehe von drawFractionPower()/layoutFractionPower() sowie
		// fuer Sichtbarkeits-Schwellwerte des Aufrufers.
		height: numM.ascent + numM.descent + 2 * gap + thickness + denM.ascent + denM.descent,
	};
}

// Geometrie von "(num/den)^exp" - Klammern werden auf die Bruchhoehe
// hochskaliert (angenaehert an MathJax' `\left(\right)`-Streckung), der
// Exponent sitzt auf Zaehler-Grundlinienhoehe (empirisch: Exponent-Mitte ≈
// Zaehler-Mitte, siehe docs "paren_frac_pow_inline"). Liefert eine Liste
// VON LINKS NACH RECHTS zu zeichnender Segmente mit x-Offset relativ zum
// linken Rand (0) - der Aufrufer kennt dadurch `totalWidth`, BEVOR
// irgendetwas gezeichnet wird (fuer den "passt die Breite?"-Test, TODO.md
// "Darstellung").
export function layoutFractionPower(measure, numText, denText, expText, fontPx) {
	const frac = layoutFraction(measure, numText, denText, fontPx);
	const refDigit = measure('0', fontPx);
	const refHeight = refDigit.ascent + refDigit.descent;
	// Klammer-Schriftgroesse so waehlen, dass die Klammer-Glyphe (deren
	// eigene Ascent+Descent bei "normaler" Groesse ≈ refHeight ist) auf die
	// Bruchhoehe skaliert - plus 5% Sicherheitszuschlag (MathJax-Klammern
	// ueberragen den Inhalt leicht, siehe docs).
	const parenFontPx = fontPx * Math.max(1, (frac.height / refHeight) * 1.05);
	const parenOpen = measure('(', parenFontPx);
	const parenClose = measure(')', parenFontPx);
	const exp = measure(expText, frac.scriptFontPx);

	let x = 0;
	const segments = [];
	segments.push({ type: 'paren', text: '(', x, fontPx: parenFontPx, baselineY: 0 });
	x += parenOpen.width;
	segments.push({ type: 'fraction', x: x + frac.width / 2, layout: frac });
	x += frac.width;
	segments.push({ type: 'paren', text: ')', x, fontPx: parenFontPx, baselineY: 0 });
	x += parenClose.width;
	segments.push({
		type: 'exp',
		text: expText,
		x,
		fontPx: frac.scriptFontPx,
		baselineY: frac.numBaselineY,
	});
	x += exp.width;

	return { segments, totalWidth: x, height: Math.max(frac.height, parenFontPx * 1.05) };
}

function canvasMeasurer(ctx, font) {
	return (text, sizePx) => {
		ctx.font = `${sizePx}px ${font}`;
		const m = ctx.measureText(text);
		// actualBoundingBox* ist in allen modernen Browsern verfuegbar; Fallback
		// nur fuer den (in diesem Projekt nie genutzten) Fall eines aelteren
		// Canvas-Renderers ohne diese Metriken.
		const ascent = Number.isFinite(m.actualBoundingBoxAscent)
			? m.actualBoundingBoxAscent
			: sizePx * 0.35;
		const descent = Number.isFinite(m.actualBoundingBoxDescent)
			? m.actualBoundingBoxDescent
			: sizePx * 0.02;
		return { width: m.width, ascent, descent };
	};
}

// Zeichnet num/den als echten, gestrichenen Bruch (Zaehler/Bruchstrich/
// Nenner) zentriert um den Ankerpunkt (x,y) = Bruchstrich-Mitte. Erwartet
// ctx.textAlign/textBaseline NICHT vorbelegt (wird selbst gesetzt). Mit
// `opts.dryRun: true` wird nur die Geometrie berechnet (z.B. fuer einen
// "passt die Breite in die Zelle?"-Test VOR dem Zeichnen), nichts gemalt.
export function drawFraction(ctx, x, y, numText, denText, fontPx, opts = {}) {
	const font = opts.font || 'ui-monospace, monospace';
	const measure = canvasMeasurer(ctx, font);
	const L = layoutFraction(measure, numText, denText, fontPx);
	if (opts.dryRun) return L;

	ctx.fillStyle = opts.color || ctx.fillStyle;
	ctx.font = `${L.scriptFontPx}px ${font}`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'alphabetic';
	ctx.fillText(numText, x, y + L.numBaselineY);
	ctx.fillText(denText, x, y + L.denBaselineY);
	ctx.fillRect(x - L.width / 2, y - L.thickness / 2, L.width, L.thickness);
	return L;
}

// Zeichnet "(num/den)^exp" ab dem LINKEN Rand (x,y) = Bruchstrich-Mitte-Y.
// Mit `opts.dryRun: true` wird NICHTS gezeichnet (nur `ctx.measureText`
// aufgerufen) - fuer den "passt die Breite in die Zelle?"-Test VOR dem
// eigentlichen Zeichnen (gleiche Idee wie `layoutFractionPower`, aber ueber
// die echte Canvas-Font-Messung statt eines Fake-Measurers).
export function drawFractionPower(ctx, x, y, numText, denText, expText, fontPx, opts = {}) {
	const font = opts.font || 'ui-monospace, monospace';
	const measure = canvasMeasurer(ctx, font);
	const L = layoutFractionPower(measure, numText, denText, expText, fontPx);
	if (opts.dryRun) return L;

	ctx.fillStyle = opts.color || ctx.fillStyle;
	ctx.textAlign = 'left';
	for (const seg of L.segments) {
		if (seg.type === 'paren' || seg.type === 'exp') {
			ctx.font = `${seg.fontPx}px ${font}`;
			ctx.textBaseline = seg.type === 'paren' ? 'middle' : 'alphabetic';
			ctx.fillText(seg.text, x + seg.x, y + seg.baselineY);
		} else if (seg.type === 'fraction') {
			drawFraction(ctx, x + seg.x, y, numText, denText, fontPx, opts);
		}
	}
	return L;
}
