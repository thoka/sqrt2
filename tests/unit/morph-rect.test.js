// Tests für src/lib/morphRect.js (FLIGHT-MORPH-SPEC §7).
// Läuft via `pnpm test` (node:test). Reine Funktion, kein DOM.
//
// WICHTIG: Tests NICHT nach Belieben ändern. Jede Änderung muss durch
// eine korrekte Spezifikation oder einen nachweisbaren Bug motiviert sein.
// Tests sichern Verhalten ab, nicht Implementierungsdetails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morphRect } from '../../src/lib/morphRect.js';

const DEG = Math.PI / 180;

// Erwartete Fläche: A0 -> A1 linear über t (kein smoothstep in morphRect).
function expectedArea(A0, A1, t) {
	return A0 * (1 - t) + A1 * t;
}
function areaAt(sw, sh, ew, eh, t, w) {
	const r = morphRect(sw, sh, ew, eh, t, w);
	return r.pw * r.ph;
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
		for (let i = 0; i <= 10; i++) {
			const t = i / 10;
			const A = expectedArea(A0, A1, t);
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
	assert.ok(prev <= Math.max(A0, A1) + 1e-9);
});

// ─── Reine Drehung: Seitenlängen konstant ─────────────────────────────

test('Reine Drehung 1:4 -> 4:1 (weight=1): Seitenlängen konstant', () => {
	// Bei rho=1 (reine Drehung) bleiben die Dimensionen auf dem Startwert.
	// Die visuelle Transformation erfolgt über die Canvas-Rotation.
	const sw = 1,
		sh = 4,
		ew = 4,
		eh = 1;
	for (let i = 0; i <= 10; i++) {
		const t = i / 10;
		const r = morphRect(sw, sh, ew, eh, t, 1);
		// Fläche exakt konstant (A0 == A1 == 4)
		assert.ok(Math.abs(r.pw * r.ph - 4) < 1e-9, `Fläche bei t=${t}: ${r.pw * r.ph}`);
		// Dimensionen bleiben bei Startform (1×4)
		assert.ok(Math.abs(r.pw - sw) < 1e-9, `pw bei t=${t}: ${r.pw} != ${sw}`);
		assert.ok(Math.abs(r.ph - sh) < 1e-9, `ph bei t=${t}: ${r.ph} != ${sh}`);
	}
	// rot monoton von 0 bis 90°
	const r0 = morphRect(sw, sh, ew, eh, 0, 1);
	assert.ok(Math.abs(r0.rot) < 1e-9, `rot bei t=0: ${r0.rot}`);
	const r1 = morphRect(sw, sh, ew, eh, 1, 1);
	assert.ok(Math.abs(Math.abs(r1.rot) - 90 * DEG) < 1e-6, `rot bei t=1: ${r1.rot}`);
});

test('Reine Drehung 1:10 -> 10:1 (weight=1): Seitenlängen konstant', () => {
	// Exakte Anforderung aus dem Bug-Report: 1:10 → 10:1, Seitenlängen
	// bleiben konstant, nur Zentrum + Winkel ändern sich.
	const sw = 1,
		sh = 10,
		ew = 10,
		eh = 1;
	for (let i = 0; i <= 10; i++) {
		const t = i / 10;
		const r = morphRect(sw, sh, ew, eh, t, 1);
		assert.ok(Math.abs(r.pw * r.ph - 10) < 1e-9, `Fläche bei t=${t}: ${r.pw * r.ph}`);
		assert.ok(Math.abs(r.pw - sw) < 1e-9, `pw bei t=${t}: ${r.pw} != ${sw}`);
		assert.ok(Math.abs(r.ph - sh) < 1e-9, `ph bei t=${t}: ${r.ph} != ${sh}`);
	}
	const r1 = morphRect(sw, sh, ew, eh, 1, 1);
	assert.ok(Math.abs(Math.abs(r1.rot) - 90 * DEG) < 1e-6, `rot bei t=1: ${r1.rot}`);
});

// ─── Quadrat: keine Drehung ───────────────────────────────────────────

test('Quadrat wird nicht gedreht: (1,1) -> (3,7) weight=1', () => {
	const r = morphRect(1, 1, 3, 7, 0.5, 1);
	assert.ok(Math.abs(r.rot) < 1e-9, `rot sollte 0 sein, war ${r.rot}`);
	assert.ok(Math.abs(r.rho) < 1e-9, `rho sollte 0 sein, war ${r.rho}`);
});

// ─── Mischfall: rho kontinuierlich ────────────────────────────────────

test('Mischfall 1:b -> 2:1 (b=4) hat kontinuierliches rho in (0,1)', () => {
	const b = 4;
	for (const w of [0.25, 0.5, 0.75]) {
		const r = morphRect(1, b, 2, 1, 0.5, w);
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
			const r = morphRect(sw, sh, ew, eh, i / 5, 0);
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
			const m = morphRect(sw, sh, ew, eh, t, 0);
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
	let prevR = morphRect(1, 4, 4, 1, 0, 0.5);
	for (let t = eps; t <= 1; t += eps) {
		const r = morphRect(1, 4, 4, 1, t, 0.5);
		assert.ok(Math.abs(r.pw - prevR.pw) < 1e-2, `pw-Sprung bei t=${t}`);
		assert.ok(Math.abs(r.ph - prevR.ph) < 1e-2, `ph-Sprung bei t=${t}`);
		prevR = r;
	}
});
