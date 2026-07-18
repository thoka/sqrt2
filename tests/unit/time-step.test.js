// Test für die Frame-dt-Clamp-Invariante (Zeitsprung-Fix):
// ein einzelner langer/negativer Frame darf die Simulation nicht
// nennenswert vorschieben.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampDt } from '../../src/lib/timeStep.js';

const MAX = 0.05;

test('clampDt: normaler Frame wird unveraendert durchgelassen', () => {
	assert.strictEqual(clampDt(0.016, MAX), 0.016);
	assert.strictEqual(clampDt(0.05, MAX), 0.05);
});

test('clampDt: zu langer Frame wird auf maxDt begrenzt (kein Sprung)', () => {
	// Hintergrund-Tab fuer 5s -> dt=5 waere ein riesiger Vorwaertssprung.
	assert.strictEqual(clampDt(5, MAX), MAX);
	assert.strictEqual(clampDt(1.2, MAX), MAX);
});

test('clampDt: nicht-positive dt (Uhr/Sprung/Throttle) werden auf maxDt gesetzt', () => {
	assert.strictEqual(clampDt(0, MAX), MAX);
	assert.strictEqual(clampDt(-0.3, MAX), MAX);
	assert.strictEqual(clampDt(NaN, MAX), MAX);
});
