// Tests für src/lib/morphRect.js (FLIGHT-MORPH-SPEC §7).
// Läuft via `pnpm test` (node:test). Reine Funktion, kein DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morphRect } from '../../src/lib/morphRect.js';

const DEG = Math.PI / 180;

// erwartete Fläche zu t: morphRect wendet KEIN smoothstep mehr an,
// der Render-Pfad glättet fly_t vor dem Aufruf.
function expectedArea(sw, sh, ew, eh, t) {
	const A0 = sw * sh;
	const A1 = ew * eh;
	return A0 * (1 - t) + A1 * t;
}
function areaAt(sw, sh, ew, eh, t, w) {
	const r = morphRect(sw, sh, ew, eh, t, w);
	return r.pw * r.ph;
}

test('Invariante: pw*ph == A(t) exakt für beliebige Rechtecke', () => {
	for (const [sw, sh, ew, eh] of [
		[1, 0.1, 0.5, 0.5],
		[1, 4, 4, 1],
		[1, 3, 1 / 3, 9],
		[2, 2, 3, 7],
		[0.3, 0.7, 0.8, 0.2],
	]) {
		for (let i = 0; i <= 10; i++) {
			const t = i / 10;
			const A = expectedArea(sw, sh, ew, eh, t); // erwartete Fläche (smoothstep)
			assert.ok(
				Math.abs(areaAt(sw, sh, ew, eh, t, 0.5) - A) < 1e-9,
				`Fläche bei (${sw},${sh})->(${ew},${eh}) t=${t}: ${areaAt(sw, sh, ew, eh, t, 0.5)} vs ${A}`,
			);
		}
	}
});

test('Kein Pulsieren: pw*ph monoton zwischen A0 und A1', () => {
	const sw = 1,
		sh = 0.1,
		ew = 0.5,
		eh = 0.5;
	const A0 = sw * sh,
		A1 = ew * eh;
	let prev = -Infinity;
	for (let i = 0; i <= 20; i++) {
		const t = i / 20;
		const a = areaAt(sw, sh, ew, eh, t, 0.5);
		assert.ok(a >= prev - 1e-9, `Fläche nicht monoton bei t=${t}`);
		prev = a;
	}
	// und innerhalb [min,max] der Endflächen (hier A0<A1)
	assert.ok(prev <= Math.max(A0, A1) + 1e-9);
});

test('Reine Drehung bei 1:4 -> 4:1 mit weight=1 (Fläche exakt konstant)', () => {
	// t=0.5: halbe Drehung (45°), Fläche == A0 == A1 == 4
	const r = morphRect(1, 4, 4, 1, 0.5, 1);
	assert.ok(Math.abs(r.pw * r.ph - 4) < 1e-9);
	assert.ok(Math.abs(Math.abs(r.rot) - 45 * DEG) < 1e-6, `rot=${r.rot}`);
	assert.ok(Math.abs(r.rho - 1) < 1e-9, `rho=${r.rho}`);
	// t=1: volle Drehung (90°), Form == Ziel
	const r1 = morphRect(1, 4, 4, 1, 1, 1);
	assert.ok(Math.abs(r1.pw * r1.ph - 4) < 1e-9);
	assert.ok(Math.abs(r1.pw - 1) < 1e-6, `pw=${r1.pw}`);
	assert.ok(Math.abs(r1.ph - 4) < 1e-6, `ph=${r1.ph}`);
	assert.ok(Math.abs(Math.abs(r1.rot) - 90 * DEG) < 1e-6, `rot=${r1.rot}`);
});

test('Quadrat wird nicht gedreht: (1,1) -> (3,7) weight=1', () => {
	const r = morphRect(1, 1, 3, 7, 0.5, 1);
	assert.ok(Math.abs(r.rot) < 1e-9, `rot sollte 0 sein, war ${r.rot}`);
	assert.ok(Math.abs(r.rho) < 1e-9, `rho sollte 0 sein, war ${r.rho}`);
});

test('Mischfall 1:b -> 2:1 (b=4) hat kontinuierliches rho in (0,1)', () => {
	const b = 4;
	for (const w of [0.25, 0.5, 0.75]) {
		const r = morphRect(1, b, 2, 1, 0.5, w);
		assert.ok(r.rho > 0 && r.rho < 1, `weight=${w}: rho=${r.rho} sollte in (0,1) sein`);
	}
});

test('weight=0 -> keine Drehung (reine Flächenkonstanz-Streckung)', () => {
	for (const [sw, sh, ew, eh] of [
		[1, 4, 4, 1],
		[1, 3, 1 / 3, 9],
	]) {
		for (let i = 0; i <= 5; i++) {
			const r = morphRect(sw, sh, ew, eh, i / 5, 0);
			assert.ok(Math.abs(r.rot) < 1e-9, `rot=${r.rot} bei weight=0`);
			assert.ok(Math.abs(r.rho) < 1e-9, `rho=${r.rho} bei weight=0`);
		}
	}
});

test('Endpunkte exakt: t=0 -> Start, t=1 -> Ziel mit Drehung', () => {
	// t=0
	let r0 = morphRect(1, 4, 4, 1, 0, 1);
	assert.ok(Math.abs(r0.pw - 1) < 1e-9 && Math.abs(r0.ph - 4) < 1e-9);
	assert.ok(Math.abs(r0.rot) < 1e-9);
	// t=1: volle Drehung (90°), Form == Ziel (gedrehte Zielform via Seitenverhältnis)
	let r1 = morphRect(1, 4, 4, 1, 1, 1);
	assert.ok(Math.abs(r1.pw - 1) < 1e-9 && Math.abs(r1.ph - 4) < 1e-9);
	assert.ok(Math.abs(Math.abs(r1.rot) - 90 * DEG) < 1e-6, `rot=${r1.rot}`);
});

test('C1-Stetigkeit: morphRect stetig in t (kein Sprung)', () => {
	const eps = 1e-4;
	let prevR = morphRect(1, 4, 4, 1, 0, 0.5);
	for (let t = eps; t <= 1; t += eps) {
		const r = morphRect(1, 4, 4, 1, t, 0.5);
		assert.ok(Math.abs(r.pw - prevR.pw) < 1e-2, `pw-Sprung bei t=${t}`);
		assert.ok(Math.abs(r.ph - prevR.ph) < 1e-2, `ph-Sprung bei t=${t}`);
		prevR = r;
	}
});
