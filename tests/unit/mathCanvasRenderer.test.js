// Tests fuer die REINE Geometrie aus src/lib/mathCanvasRenderer.js
// (layoutScript) - mit einem deterministischen Fake-`measure()` statt
// echtem `ctx.measureText` (Canvas-Zeichnen selbst wird laut AGENTS.md nur
// per Build+E2E verifiziert, nicht per Unit-Test).
//
// Die Achsen-Beschriftung (Brueche/Exponenten wie "(1/2)³") nutzt seit der
// Umstellung auf gecachtes ECHTES MathJax (mathJaxLabelCache.js,
// docs/Beschriftung.md) diesen Renderer NICHT mehr - nur noch die
// Zahlentafel-Hoch-/Tiefstellung (renderHud() in TargetBankCanvas.svelte).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutScript } from '../../src/lib/mathCanvasRenderer.js';
import { MATH_METRICS } from '../../src/lib/mathMetrics.js';

// Deterministischer Fake-Measurer: Breite = Zeichenanzahl * halbe
// Schriftgroesse, Ascent/Descent als feste Anteile der Schriftgroesse -
// grob an echte Monospace-Ziffern angelehnt, aber exakt vorhersagbar.
function fakeMeasure(text, sizePx) {
	return { width: text.length * sizePx * 0.5, ascent: sizePx * 0.7, descent: sizePx * 0.15 };
}

test('layoutScript: sup hebt den Exponenten an, sub senkt den Index ab', () => {
	const sup = layoutScript(fakeMeasure, 'l', '2', 100, 'sup');
	const sub = layoutScript(fakeMeasure, '1.4142', '10', 100, 'sub');
	assert.strictEqual(sup.scriptBaselineY, -100 * MATH_METRICS.SUP_SHIFT);
	assert.strictEqual(sub.scriptBaselineY, 100 * MATH_METRICS.SUB_SHIFT);
});

test('layoutScript: scriptText steht rechts von baseText, beide in totalWidth enthalten', () => {
	const L = layoutScript(fakeMeasure, 'l', '2', 100, 'sup');
	assert.ok(L.scriptX >= 0);
	assert.ok(L.totalWidth > L.scriptX);
});

test('layoutScript: scriptFontPx nutzt dieselbe SCRIPT_SCALE wie Brueche/Exponenten', () => {
	const L = layoutScript(fakeMeasure, 'l', '2', 100, 'sup');
	assert.strictEqual(L.scriptFontPx, 100 * MATH_METRICS.SCRIPT_SCALE);
});
