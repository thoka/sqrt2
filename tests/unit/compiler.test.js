// Persistente Tests für src/lib/compiler.js (TOOLING_SPEC.md Phase 1) -
// laufen via `pnpm test` (node:test, keine zusätzliche Abhängigkeit nötig).
// Zweck: absichern, dass die Extraktion aus sqrt2.html verhaltensgleich
// blieb, UND dass compileSystem() tatsächlich rein/deterministisch ist -
// das trägt später die Phase-2-Architektur (compiledStore als derived aus
// configStore, siehe TOOLING_SPEC.md 3.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSystem, computeLiveL } from '../../src/lib/compiler.js';

const BASE_CONFIG = {
	base: 10,
	depth: 3,
	transformMode: 'S',
	bankZoomThresholdPowers: 0,
	zoomSpeedCoef: 0.012,
	compactionEnabled: false,
	compactionTransitionTicks: 3,
};

test('compileSystem() ist eine reine Funktion: identische Config -> tief-gleiches Ergebnis', () => {
	// Trägt die Determinismus-Garantie, auf der Phase 2 (compiledStore als
	// reines derived aus configStore, siehe TOOLING_SPEC.md 3.1) aufbaut -
	// jedes Fenster muss aus demselben configStore denselben Zustand
	// herleiten, ohne ihn über BroadcastChannel zu übertragen.
	let r1 = compileSystem(BASE_CONFIG);
	let r2 = compileSystem({ ...BASE_CONFIG });
	assert.deepStrictEqual(r1.GLOBAL_N_ARR, r2.GLOBAL_N_ARR);
	assert.strictEqual(r1.TOTAL_STEPS, r2.TOTAL_STEPS);
	assert.strictEqual(r1.MAX_TIME, r2.MAX_TIME);
	assert.strictEqual(r1.P_FINAL, r2.P_FINAL);
	assert.deepStrictEqual(
		r1.bank_pieces.map((p) => [p.x, p.y, p.w, p.h]),
		r2.bank_pieces.map((p) => [p.x, p.y, p.w, p.h]),
	);
});

test('compileSystem() bleibt bei DOM-freiem Aufruf (kein document-Zugriff) funktionsfähig', () => {
	// Wer das versehentlich reinbricht (z.B. ein "document.getElementById"
	// zurück in compiler.js kopiert), merkt es sofort: in Node gibt es kein
	// globales `document`.
	assert.strictEqual(typeof document, 'undefined');
	assert.doesNotThrow(() => compileSystem(BASE_CONFIG));
});

test('GLOBAL_N_ARR: Ziffern pro Stelle summieren sich zur Gesamtzahl der Schalen (TOTAL_STEPS)', () => {
	let r = compileSystem(BASE_CONFIG);
	let sum = r.GLOBAL_N_ARR.reduce((a, b) => a + b, 0);
	assert.strictEqual(sum, r.TOTAL_STEPS);
	assert.strictEqual(r.GLOBAL_N_ARR.length, BASE_CONFIG.depth + 1);
});

test('P_FINAL nähert sich mit wachsender Tiefe sqrt(2) monoton an (Kernzweck des Tools)', () => {
	let prevError = Infinity;
	for (let depth of [1, 2, 4, 6]) {
		let r = compileSystem({ ...BASE_CONFIG, depth });
		let error = Math.abs(r.P_FINAL - Math.sqrt(2));
		assert.ok(
			error < prevError,
			`Tiefe ${depth}: Fehler ${error} sollte kleiner sein als bei geringerer Tiefe (${prevError})`,
		);
		prevError = error;
	}
});

test('GLOBAL_TTM: Tick<->Zeit-Abbildung ist bijektiv und monoton auf [0, maxTick]', () => {
	let r = compileSystem(BASE_CONFIG);
	let lastTime = -Infinity;
	for (let tick = 0; tick <= r.GLOBAL_TTM.maxTick; tick++) {
		let time = r.GLOBAL_TTM.tickToTime(tick);
		assert.ok(
			time > lastTime,
			`Zeit bei Tick ${tick} (${time}) muss strikt größer sein als bei Tick ${tick - 1} (${lastTime})`,
		);
		lastTime = time;
	}
});

test('MAX_TIME ist endlich und positiv', () => {
	let r = compileSystem(BASE_CONFIG);
	assert.ok(Number.isFinite(r.MAX_TIME));
	assert.ok(r.MAX_TIME > 0);
});

test('GLOBAL_AUTO_ZOOM_SPLINE: startet bei Exponent 0 und erreicht am Ende der Animation depth', () => {
	let r = compileSystem(BASE_CONFIG);
	assert.strictEqual(r.GLOBAL_AUTO_ZOOM_SPLINE(0), 0);
	assert.strictEqual(r.GLOBAL_AUTO_ZOOM_SPLINE(r.MAX_TIME), BASE_CONFIG.depth);
});

test('transformMode S vs. Z erzeugt unterschiedliche Bank-Belegungen bei sonst gleicher Config', () => {
	let rS = compileSystem({ ...BASE_CONFIG, transformMode: 'S' });
	let rZ = compileSystem({ ...BASE_CONFIG, transformMode: 'Z' });
	assert.notStrictEqual(rS.bank_pieces.length, rZ.bank_pieces.length);
});

test('Kompaktierung deaktiviert: alle GLOBAL_COMPACTION_*-Felder sind leer/null', () => {
	let r = compileSystem({ ...BASE_CONFIG, compactionEnabled: false });
	assert.deepStrictEqual(r.GLOBAL_COMPACTION_WAYPOINTS, []);
	assert.strictEqual(r.GLOBAL_COMPACTION_LOGICAL_LOOKUP, null);
	assert.strictEqual(r.GLOBAL_COMPACTION_FIT_SPLINE, null);
});

test('Kompaktierung aktiviert: Waypoints und Lookup werden gebaut', () => {
	let r = compileSystem({ ...BASE_CONFIG, compactionEnabled: true });
	assert.ok(r.GLOBAL_COMPACTION_WAYPOINTS.length > 0);
	assert.strictEqual(typeof r.GLOBAL_COMPACTION_LOGICAL_LOOKUP, 'function');
	assert.strictEqual(typeof r.GLOBAL_COMPACTION_FIT_SPLINE.at, 'function');
});

test('Kompaktierung mit ungültigem compactionTransitionTicks (NaN) fällt auf Default 3 zurück statt zu crashen', () => {
	assert.doesNotThrow(() =>
		compileSystem({ ...BASE_CONFIG, compactionEnabled: true, compactionTransitionTicks: NaN }),
	);
});

test('computeLiveL: l wächst stetig und nimmt bei jeder vollendeten Schale den nächsten Meilenstein an', () => {
	// Gewünschtes Verhalten der Zahlentafel (Basis 10, Tiefe 3):
	//   Anfang                          -> l = 1
	//   Schale 1 fertig (exp=1, Ziffer 4) -> l = 1.1
	//   Schale 2 fertig                 -> l = 1.2
	//   Schale 3 fertig                 -> l = 1.3
	//   Schale 4 fertig (Stelle 1 voll) -> l = 1.4
	//   Schale 5 fertig (exp=2, Ziffer 1) -> l = 1.41
	const r = compileSystem(BASE_CONFIG);
	const expectedAtShellEnd = ['1', '1.1', '1.2', '1.3', '1.4', '1.41'];
	// l als String zur Basis BASE mit `m` Nachkommastellen formatieren.
	function fmt(N, m) {
		let s = N.toString(10);
		if (m === 0) return s;
		s = s.padStart(m + 1, '0');
		return s.slice(0, s.length - m) + '.' + s.slice(s.length - m);
	}
	// Anfang (vor erster Schale): l = 1
	let start = computeLiveL(r, 0, 10);
	assert.strictEqual(fmt(start.N, start.m), '1', 'Anfang muss l = 1 sein');

	for (let S = 1; S < expectedAtShellEnd.length; S++) {
		// Zeit kurz VOR dem Start der nächsten Schale = Ende von Schale S.
		let nextStart = r.GLOBAL_SHELL_START[S + 1] ?? r.MAX_TIME;
		let t = nextStart - 1e-6;
		let { N, m } = computeLiveL(r, t, 10);
		assert.strictEqual(
			fmt(N, m),
			expectedAtShellEnd[S],
			`Schale ${S} fertig: l soll ${expectedAtShellEnd[S]} sein, war ${fmt(N, m)}`,
		);
	}
});

test('computeLiveL: l ist über die gesamte Animation monoton wachsend (stetig)', () => {
	const r = compileSystem(BASE_CONFIG);
	const steps = 400;
	let prev = -Infinity;
	for (let i = 0; i <= steps; i++) {
		let t = (r.MAX_TIME * i) / steps;
		let { N } = computeLiveL(r, t, 10);
		// N ist l * BASE^m, also vergleichbar über die Zeit hinweg (m wächst
		// nur, wenn N ohnehin mitwächst - durch padStart-Form nie kleiner).
		assert.ok(
			N >= prev,
			`l bei t=${t.toFixed(2)} (${N}) darf nicht kleiner sein als vorher (${prev})`,
		);
		prev = N;
	}
});
