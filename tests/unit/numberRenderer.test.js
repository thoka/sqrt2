// Unit-Tests fuer den eigenen Zahl-Renderer (statt MathJax) -
// siehe docs/INTERFACE-TODO.md "Eigener Renderer fuer Zahlendarstellung"
// (Ursache des Flug-Stotterns: pro-Frame MathJax typesetPromise,
// danach stuendiges DOM-innerHTML + erzwungener Reflow). Die
// Zahlentafel (l/l²/R) wird JETZT direkt auf dem Bank-Canvas gemalt
// (TargetBankCanvas.svelte renderFrame -> computeLiveL +
// formatLiveNumbers + ctx.fillText), nicht mehr ins DOM geschrieben.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBaseNumber, formatLiveNumbers } from '../../src/lib/numberRenderer.js';

test('splitBaseNumber: trennt Ganzzahl- und Nachkommateil am Punkt', () => {
	assert.deepStrictEqual(splitBaseNumber('1.4142'), { int: '1', frac: '4142' });
	assert.deepStrictEqual(splitBaseNumber('123'), { int: '123', frac: '' });
	assert.deepStrictEqual(splitBaseNumber('0.5A'), { int: '0', frac: '5A' });
});

test('formatLiveNumbers: l / l² / R in Basis-B, Punkt-Format + Trailing-Zero-Trim', () => {
	// sqrt(2) Basis 10, Tiefe 1: l = 1.4, l² = 1.96, R = 0.04
	// (N_l=14, N_l²=196, N_R=4, GRID=10, AREA_SCALE=100).
	const { P_str, P2_str, rem_str } = formatLiveNumbers(14n, 4n, 10n, 100n, 10);
	assert.strictEqual(P_str, '1.4');
	assert.strictEqual(P2_str, '1.96');
	assert.strictEqual(rem_str, '0.04');
});

test('formatLiveNumbers: haengende Nullen werden abgeschnitten', () => {
	// l=1.40 -> "1.4", l²=1.9600 -> "1.96", R=0.0400 -> "0.04"
	const { P_str, P2_str, rem_str } = formatLiveNumbers(140n, 400n, 100n, 10000n, 10);
	assert.strictEqual(P_str, '1.4');
	assert.strictEqual(P2_str, '1.96');
	assert.strictEqual(rem_str, '0.04');
});

test('formatLiveNumbers: Basis > 10 nutzt Buchstaben-Ziffern', () => {
	// Basis 16: N_l=0x1A=26, N_l²=676=0x2A4, N_R=0xC=12,
	// GRID=16, AREA_SCALE=256.
	const { P_str, P2_str, rem_str } = formatLiveNumbers(26n, 12n, 16n, 256n, 16);
	assert.strictEqual(P_str, '1.A');
	assert.strictEqual(P2_str, '2.A4');
	assert.strictEqual(rem_str, '0.0C');
});

test('formatLiveNumbers: ganzzahlig (ohne Nachkommateil) bleibt valide', () => {
	const { P_str, P2_str, rem_str } = formatLiveNumbers(2n, 0n, 1n, 1n, 10);
	assert.strictEqual(P_str, '2');
	assert.strictEqual(P2_str, '4');
	assert.strictEqual(rem_str, '0');
});
