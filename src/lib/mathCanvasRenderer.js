// mathCanvasRenderer.js — zeichnet die Zahlentafel-Hoch-/Tiefstellung
// (l²/2¹⁸/1,41₁₀, siehe TargetBankCanvas.svelte renderHud()) auf einem
// Canvas-2D-Kontext, optisch angelehnt an MathJax' CHTML-Ausgabe (siehe
// mathMetrics.js + docs/MATHJAX_METRICS.md), OHNE MathJax zur Laufzeit zu
// laden - die Zahlentafel ändert sich bei JEDEM Frame, ein Cache (wie für
// die Achsen-Beschriftung, siehe mathJaxLabelCache.js) hilft dort nicht.
//
// Aufbau in zwei Schichten (Testbarkeit, siehe AGENTS.md "Canvas/DOM nie nur
// per Unit-Test verifizieren"):
//   - layoutScript(): REINE Geometrie, bekommt eine
//     `measure(text, fontPx) -> {width, ascent, descent}`-Funktion injiziert
//     statt selbst auf `ctx` zuzugreifen - dadurch mit einem Fake-Measurer
//     per `node --test` pruefbar (tests/unit/mathCanvasRenderer.test.js).
//   - drawScript(): duenne Canvas-Schicht, baut den echten
//     `ctx.measureText`-Adapter und fuehrt die eigentlichen
//     fillText()-Aufrufe anhand des Layouts aus - nur per Build+E2E/visuell
//     verifizierbar, siehe TargetBankCanvas.svelte.
//
// Die Achsen-Beschriftung der Ziel-Quadrate (Brüche/Exponenten wie
// "(1/2)³") nutzte frueher ebenfalls diesen Renderer (Nachbau der MathJax-
// Optik per Hand) - seit der Umstellung auf einen gecachten ECHTEN
// MathJax-Renderer (mathJaxLabelCache.js, docs/Beschriftung.md Diskussion
// "Es spricht nichts gegen die Nutzung von MathJax außer Performance. Wenn
// Caching ausreicht, ist das der einfachere Weg.") braucht es diesen
// Hand-Nachbau dort nicht mehr - die ehemaligen layoutFraction()/
// drawFraction()/layoutFractionPower()/drawFractionPower()/
// layoutSlashFraction()/drawSlashFraction()-Funktionen wurden entfernt.
import { MATH_METRICS } from './mathMetrics.js';

// Geometrie von "baseText" gefolgt von einem hoch- ODER tiefgestellten
// `scriptText` (z.B. Exponent "l²"/"2¹⁸" oder Index "1,41₁₀") - reine
// horizontale Aneinanderreihung, KEIN Bruch. `direction`: 'sup' (hochgestellt,
// SUP_SHIFT) oder 'sub' (tiefgestellt, SUB_SHIFT).
export function layoutScript(measure, baseText, scriptText, fontPx, direction = 'sup') {
	const baseM = measure(baseText, fontPx);
	const scriptFontPx = fontPx * MATH_METRICS.SCRIPT_SCALE;
	const scriptM = measure(scriptText, scriptFontPx);
	const shift =
		direction === 'sup' ? -fontPx * MATH_METRICS.SUP_SHIFT : fontPx * MATH_METRICS.SUB_SHIFT;
	const spacing = fontPx * 0.02;
	return {
		baseX: 0,
		baseBaselineY: 0,
		scriptX: baseM.width + spacing,
		scriptBaselineY: shift,
		scriptFontPx,
		totalWidth: baseM.width + spacing + scriptM.width,
	};
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

// Zeichnet "baseText" gefolgt von hoch-/tiefgestelltem `scriptText` ab dem
// LINKEN Rand (x,y) = normale Grundlinie. Siehe layoutScript(). Deckt sowohl
// Exponenten ("l²", direction='sup') als auch Indizes/Basis-Angaben
// ("1,41₁₀", direction='sub') ab - EIN Renderer statt zwei fast identischer.
export function drawScript(ctx, x, y, baseText, scriptText, fontPx, direction = 'sup', opts = {}) {
	const font = opts.font || 'ui-monospace, monospace';
	const measure = canvasMeasurer(ctx, font);
	const L = layoutScript(measure, baseText, scriptText, fontPx, direction);
	if (opts.dryRun) return L;

	ctx.fillStyle = opts.color || ctx.fillStyle;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'alphabetic';
	ctx.font = `${fontPx}px ${font}`;
	ctx.fillText(baseText, x + L.baseX, y + L.baseBaselineY);
	ctx.font = `${L.scriptFontPx}px ${font}`;
	ctx.fillText(scriptText, x + L.scriptX, y + L.scriptBaselineY);
	return L;
}
