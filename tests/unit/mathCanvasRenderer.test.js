// Tests fuer die REINE Geometrie aus src/lib/mathCanvasRenderer.js
// (layoutFraction/layoutFractionPower) - mit einem deterministischen
// Fake-`measure()` statt echtem `ctx.measureText` (Canvas-Zeichnen selbst
// wird laut AGENTS.md nur per Build+E2E verifiziert, nicht per Unit-Test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutFraction, layoutFractionPower } from '../../src/lib/mathCanvasRenderer.js';
import { MATH_METRICS } from '../../src/lib/mathMetrics.js';

// Deterministischer Fake-Measurer: Breite = Zeichenanzahl * halbe
// Schriftgroesse, Ascent/Descent als feste Anteile der Schriftgroesse -
// grob an echte Monospace-Ziffern angelehnt, aber exakt vorhersagbar.
function fakeMeasure(text, sizePx) {
	return { width: text.length * sizePx * 0.5, ascent: sizePx * 0.7, descent: sizePx * 0.15 };
}

test('layoutFraction: Bruchstrich-Dicke/Abstand aus MATH_METRICS abgeleitet', () => {
	const fontPx = 100;
	const L = layoutFraction(fakeMeasure, '1', '8', fontPx);
	assert.strictEqual(L.thickness, fontPx * MATH_METRICS.RULE_THICKNESS);
	assert.strictEqual(L.gap, fontPx * MATH_METRICS.RULE_GAP);
	assert.strictEqual(L.scriptFontPx, fontPx * MATH_METRICS.SCRIPT_SCALE);
});

test('layoutFraction: Zaehler liegt UEBER, Nenner UNTER dem Ankerpunkt (Bruchstrich-Mitte)', () => {
	const L = layoutFraction(fakeMeasure, '1', '8', 100);
	// Canvas-Konvention: kleineres y = weiter oben.
	assert.ok(L.numBaselineY < 0, 'Zaehler-Grundlinie muss oberhalb der Mitte liegen (y<0)');
	assert.ok(L.denBaselineY > 0, 'Nenner-Grundlinie muss unterhalb der Mitte liegen (y>0)');
	assert.ok(L.denBaselineY > L.numBaselineY);
});

test('layoutFraction: Breite deckt den breiteren von Zaehler/Nenner ab (plus Rand)', () => {
	const L = layoutFraction(fakeMeasure, '1', '100000', 100); // Nenner deutlich breiter
	assert.ok(L.width > L.denWidth, 'Bruchstrich muss etwas ueber den Nenner hinausragen');
	assert.ok(L.width >= L.numWidth);
});

test('layoutFraction: Gesamthoehe = Zaehler + 2x Gap + Strich + Nenner', () => {
	const fontPx = 100;
	const L = layoutFraction(fakeMeasure, '1', '8', fontPx);
	const expected =
		L.numAscent + L.numDescent + 2 * L.gap + L.thickness + L.denAscent + L.denDescent;
	assert.ok(Math.abs(L.height - expected) < 1e-9);
});

test('layoutFractionPower: liefert vier Segmente in der Reihenfolge ( frac ) exp', () => {
	const L = layoutFractionPower(fakeMeasure, '1', '2', '3', 100);
	assert.strictEqual(L.segments.length, 4);
	assert.deepStrictEqual(
		L.segments.map((s) => s.type),
		['paren', 'fraction', 'paren', 'exp'],
	);
	assert.strictEqual(L.segments[0].text, '(');
	assert.strictEqual(L.segments[2].text, ')');
	assert.strictEqual(L.segments[3].text, '3');
});

test('layoutFractionPower: Segmente liegen streng von links nach rechts (aufsteigendes x)', () => {
	const L = layoutFractionPower(fakeMeasure, '1', '2', '3', 100);
	const xs = L.segments.map((s) => s.x);
	for (let i = 1; i < xs.length; i++) {
		assert.ok(
			xs[i] >= xs[i - 1],
			`Segment ${i} (x=${xs[i]}) darf nicht vor Segment ${i - 1} liegen`,
		);
	}
	assert.ok(L.totalWidth >= xs[xs.length - 1]);
});

test('layoutFractionPower: Exponent sitzt auf Zaehler-Grundlinienhoehe (empirische MathJax-Naeherung)', () => {
	const L = layoutFractionPower(fakeMeasure, '1', '2', '3', 100);
	const fracSeg = L.segments.find((s) => s.type === 'fraction');
	const expSeg = L.segments.find((s) => s.type === 'exp');
	assert.strictEqual(expSeg.baselineY, fracSeg.layout.numBaselineY);
});

test('layoutFractionPower: Klammer-Schriftgroesse skaliert proportional mit fontPx', () => {
	const at100 = layoutFractionPower(fakeMeasure, '1', '2', '3', 100);
	const at200 = layoutFractionPower(fakeMeasure, '1', '2', '3', 200);
	const parenAt100 = at100.segments.find((s) => s.type === 'paren').fontPx;
	const parenAt200 = at200.segments.find((s) => s.type === 'paren').fontPx;
	assert.ok(parenAt100 >= 100, 'Klammer darf den Bruchinhalt nie unterschreiten');
	assert.ok(Math.abs(parenAt200 / parenAt100 - 2) < 1e-9, 'muss linear mit fontPx mitskalieren');
});
