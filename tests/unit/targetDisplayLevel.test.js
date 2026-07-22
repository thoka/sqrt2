// Persistente Tests für src/lib/targetDisplayLevel.js - reines Modul (die
// Store-Nutzung selbst ist trivial/svelte-intern), daher hier via node:test
// statt vitest/jsdom (siehe CLAUDE.md "Svelte-Komponenten-Tests").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	levelToPx,
	pxToLevel,
	TARGET_DISPLAY_LEVEL_MIN_PX,
	targetDisplayMaxPxStore,
} from '../../src/lib/targetDisplayLevel.js';
import { get } from 'svelte/store';

test('levelToPx(0, maxPx) liefert immer exakt TARGET_DISPLAY_LEVEL_MIN_PX (unabhängig von maxPx)', () => {
	for (let maxPx of [10, 100, 8333, 37500]) {
		assert.ok(Math.abs(levelToPx(0, maxPx) - TARGET_DISPLAY_LEVEL_MIN_PX) < 1e-9);
	}
});

test('levelToPx(1, maxPx) liefert exakt maxPx - Regler-Maximum trifft die tatsächliche Obergrenze', () => {
	for (let maxPx of [10, 100, 8333, 37500]) {
		assert.ok(Math.abs(levelToPx(1, maxPx) - maxPx) < 1e-6, `maxPx=${maxPx}`);
	}
});

test('levelToPx() ist monoton wachsend in level (für festes maxPx)', () => {
	let maxPx = 8333;
	let prev = levelToPx(0, maxPx);
	for (let i = 1; i <= 100; i++) {
		let v = levelToPx(i / 100, maxPx);
		assert.ok(v > prev, `sollte streng wachsend sein bei i=${i}`);
		prev = v;
	}
});

test('pxToLevel() ist die Umkehrfunktion von levelToPx() für ein festes maxPx', () => {
	let maxPx = 25000;
	for (let level of [0, 0.1, 0.42, 0.73, 1]) {
		let px = levelToPx(level, maxPx);
		let back = pxToLevel(px, maxPx);
		assert.ok(Math.abs(back - level) < 1e-6, `level=${level} -> px=${px} -> ${back}`);
	}
});

test('pxToLevel() klemmt auf [0,1]', () => {
	let maxPx = 100;
	assert.strictEqual(pxToLevel(-5, maxPx), 0);
	assert.strictEqual(pxToLevel(1e9, maxPx), 1);
});

test('targetDisplayMaxPxStore hat einen sinnvollen Default vor dem ersten Render', () => {
	let v = get(targetDisplayMaxPxStore);
	assert.ok(typeof v === 'number' && v > 0 && isFinite(v));
});
