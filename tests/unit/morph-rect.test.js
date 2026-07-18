// Tests für src/lib/morphRect.js (FLIGHT-MORPH-SPEC §7).
// Läuft via `pnpm test` (node:test). Reine Funktion, kein DOM.
//
// WICHTIG: Tests NICHT nach Belieben ändern. Jede Änderung muss durch
// eine korrekte Spezifikation oder einen nachweisbaren Bug motiviert sein.
// Tests sichern Verhalten ab, nicht Implementierungsdetails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morphRect, computeRotation, rotationAngle } from '../../src/lib/morphRect.js';

const DEG = Math.PI / 180;

// Erwartete Fläche: A0 -> A1 linear über t (kein smoothstep in morphRect).
function expectedArea(A0, A1, t) {
	return A0 * (1 - t) + A1 * t;
}
function areaAt(sw, sh, ew, eh, t, rho, dir) {
	const r = morphRect(sw, sh, ew, eh, t, rho, dir);
	return r.pw * r.ph;
}
// Helfer: morphRect mit rotWeight aufrufen (wie alter Code)
function morphWithWeight(sw, sh, ew, eh, t, rotWeight) {
	const cr = computeRotation(sw, sh, ew, eh, rotWeight);
	const m = morphRect(sw, sh, ew, eh, t, cr.rho, cr.dir);
	const rot = rotationAngle(cr, t);
	return { ...m, rot, rho: cr.rho };
}

// ─── Flächen-Invariante ───────────────────────────────────────────────

test('Invariante: pw*ph == A(t) exakt für beliebige Rechtecke', () => {
	for (const [sw, sh, ew, eh] of [
		[1, 0.1, 0.5, 0.5],
		[1, 4, 4, 1],
		[1, 3, 1 / 3, 9],
		[2, 2, 3, 7],
		[0.3, 0.7, 0.8, 0.2],
		[1, 10, 10, 1],
	]) {
		const A0 = sw * sh;
		const A1 = ew * eh;
		const cr = computeRotation(sw, sh, ew, eh, 0.5);
		for (let i = 0; i <= 10; i++) {
			const t = i / 10;
			const A = expectedArea(A0, A1, t);
			assert.ok(
				Math.abs(areaAt(sw, sh, ew, eh, t, cr.rho, cr.dir) - A) < 1e-9,
				`Fläche bei (${sw},${sh})->(${ew},${eh}) t=${t}: ${areaAt(sw, sh, ew, eh, t, cr.rho, cr.dir)} vs ${A}`,
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
	const cr = computeRotation(sw, sh, ew, eh, 0.5);
	let prev = -Infinity;
	for (let i = 0; i <= 20; i++) {
		const t = i / 20;
		const a = areaAt(sw, sh, ew, eh, t, cr.rho, cr.dir);
		assert.ok(a >= prev - 1e-9, `Fläche nicht monoton bei t=${t}`);
		prev = a;
	}
	assert.ok(prev <= Math.max(A0, A1) + 1e-9);
});

// ─── Reine Drehung: Seitenlängen konstant ─────────────────────────────

test('Reine Drehung 1:4 -> 4:1 (weight=1): Seitenlängen konstant', () => {
	const sw = 1,
		sh = 4,
		ew = 4,
		eh = 1;
	for (let i = 0; i <= 10; i++) {
		const t = i / 10;
		const r = morphWithWeight(sw, sh, ew, eh, t, 1);
		assert.ok(Math.abs(r.pw * r.ph - 4) < 1e-9, `Fläche bei t=${t}: ${r.pw * r.ph}`);
		assert.ok(Math.abs(r.pw - sw) < 1e-9, `pw bei t=${t}: ${r.pw} != ${sw}`);
		assert.ok(Math.abs(r.ph - sh) < 1e-9, `ph bei t=${t}: ${r.ph} != ${sh}`);
	}
	const r0 = morphWithWeight(sw, sh, ew, eh, 0, 1);
	assert.ok(Math.abs(r0.rot) < 1e-9, `rot bei t=0: ${r0.rot}`);
	const r1 = morphWithWeight(sw, sh, ew, eh, 1, 1);
	assert.ok(Math.abs(Math.abs(r1.rot) - 90 * DEG) < 1e-6, `rot bei t=1: ${r1.rot}`);
});

test('Reine Drehung 1:10 -> 10:1 (weight=1): Seitenlängen konstant', () => {
	const sw = 1,
		sh = 10,
		ew = 10,
		eh = 1;
	for (let i = 0; i <= 10; i++) {
		const t = i / 10;
		const r = morphWithWeight(sw, sh, ew, eh, t, 1);
		assert.ok(Math.abs(r.pw * r.ph - 10) < 1e-9, `Fläche bei t=${t}: ${r.pw * r.ph}`);
		assert.ok(Math.abs(r.pw - sw) < 1e-9, `pw bei t=${t}: ${r.pw} != ${sw}`);
		assert.ok(Math.abs(r.ph - sh) < 1e-9, `ph bei t=${t}: ${r.ph} != ${sh}`);
	}
	const r1 = morphWithWeight(sw, sh, ew, eh, 1, 1);
	assert.ok(Math.abs(Math.abs(r1.rot) - 90 * DEG) < 1e-6, `rot bei t=1: ${r1.rot}`);
});

// ─── Rotation zoom-unabhängig ─────────────────────────────────────────

test('Rotation zoom-unabhängig: gleiche logische Form, unterschiedliche Screen-Größe', () => {
	// Logisch: 1×10 → 10×1 (gleiche Form)
	// Screen: einmal normal, einmal doppelt so groß
	const r1 = morphWithWeight(1, 10, 10, 1, 0.5, 1);
	const r2 = morphWithWeight(2, 20, 20, 2, 0.5, 1);
	// rho und rot müssen identisch sein (nur logische Form zählt)
	assert.ok(Math.abs(r1.rho - r2.rho) < 1e-9, `rho: ${r1.rho} vs ${r2.rho}`);
	assert.ok(Math.abs(r1.rot - r2.rot) < 1e-9, `rot: ${r1.rot} vs ${r2.rot}`);
});

// ─── Quadrat: keine Drehung ───────────────────────────────────────────

test('Quadrat wird nicht gedreht: (1,1) -> (3,7) weight=1', () => {
	const r = morphWithWeight(1, 1, 3, 7, 0.5, 1);
	assert.ok(Math.abs(r.rot) < 1e-9, `rot sollte 0 sein, war ${r.rot}`);
	assert.ok(Math.abs(r.rho) < 1e-9, `rho sollte 0 sein, war ${r.rho}`);
});

// ─── Mischfall: rho kontinuierlich ────────────────────────────────────

test('Mischfall 1:b -> 2:1 (b=4) hat kontinuierliches rho in (0,1)', () => {
	const b = 4;
	for (const w of [0.25, 0.5, 0.75]) {
		const r = morphWithWeight(1, b, 2, 1, 0.5, w);
		assert.ok(r.rho > 0 && r.rho < 1, `weight=${w}: rho=${r.rho} sollte in (0,1) sein`);
	}
});

// ─── weight=0: reine Streckung, keine Drehung ─────────────────────────

test('weight=0 -> keine Drehung (reine Flächenkonstanz-Streckung)', () => {
	for (const [sw, sh, ew, eh] of [
		[1, 4, 4, 1],
		[1, 3, 1 / 3, 9],
	]) {
		for (let i = 0; i <= 5; i++) {
			const r = morphWithWeight(sw, sh, ew, eh, i / 5, 0);
			assert.ok(Math.abs(r.rot) < 1e-9, `rot=${r.rot} bei weight=0`);
			assert.ok(Math.abs(r.rho) < 1e-9, `rho=${r.rho} bei weight=0`);
		}
	}
});

// ─── Endpunkte: exakt wie alter Lerp bei weight=0 ─────────────────────

test('Endpunkte bei weight=0: exakt == alter linearer Lerp', () => {
	const cases = [
		[1, 4, 4, 1],
		[1, 0.1, 0.5, 0.5],
		[2, 2, 3, 7],
		[0.3, 0.7, 0.8, 0.2],
	];
	for (const [sw, sh, ew, eh] of cases) {
		for (const t of [0, 1]) {
			const m = morphWithWeight(sw, sh, ew, eh, t, 0);
			assert.ok(
				Math.abs(m.pw - (sw * (1 - t) + ew * t)) < 1e-9 &&
					Math.abs(m.ph - (sh * (1 - t) + eh * t)) < 1e-9,
				`t=${t} (${sw},${sh})->(${ew},${eh}): morphRect(${m.pw},${m.ph}) != lerp`,
			);
		}
	}
});

// ─── C1-Stetigkeit ────────────────────────────────────────────────────

test('C1-Stetigkeit: morphRect stetig in t (kein Sprung)', () => {
	const eps = 1e-4;
	const cr = computeRotation(1, 4, 4, 1, 0.5);
	let prevR = morphRect(1, 4, 4, 1, 0, cr.rho, cr.dir);
	for (let t = eps; t <= 1; t += eps) {
		const r = morphRect(1, 4, 4, 1, t, cr.rho, cr.dir);
		assert.ok(Math.abs(r.pw - prevR.pw) < 1e-2, `pw-Sprung bei t=${t}`);
		assert.ok(Math.abs(r.ph - prevR.ph) < 1e-2, `ph-Sprung bei t=${t}`);
		prevR = r;
	}
});
