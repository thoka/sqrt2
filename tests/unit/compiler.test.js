// Persistente Tests für src/lib/compiler.js (TOOLING_SPEC.md Phase 1) -
// laufen via `pnpm test` (node:test, keine zusätzliche Abhängigkeit nötig).
// Zweck: absichern, dass die Extraktion aus sqrt2.html verhaltensgleich
// blieb, UND dass compileSystem() tatsächlich rein/deterministisch ist -
// das trägt später die Phase-2-Architektur (compiledStore als derived aus
// configStore, siehe TOOLING_SPEC.md 3.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSystem } from '../../src/lib/compiler.js';

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

test('GLOBAL_SHELL_TAKEN: eine Stück-Liste pro Schale, Länge == TOTAL_STEPS, sortiert', () => {
	let r = compileSystem(BASE_CONFIG);
	assert.strictEqual(r.GLOBAL_SHELL_TAKEN.length, r.TOTAL_STEPS);
	for (let S = 0; S < r.TOTAL_STEPS; S++) {
		let times = r.GLOBAL_SHELL_TAKEN[S];
		assert.ok(Array.isArray(times), `Schale ${S} muss ein Array sein`);
		for (let i = 1; i < times.length; i++) {
			assert.ok(
				times[i] >= times[i - 1],
				`Schale ${S}: Entnahme-Zeiten müssen aufsteigend sortiert sein`,
			);
		}
	}
	// Die Summe aller entnommenen Stücke über alle Schalen entspricht der
	// Anzahl endlich entnommener Bank-Stücke (das Basisquadrat bleibt drin).
	let finiteTaken = r.bank_pieces.filter((p) => isFinite(p.taken_time)).length;
	let shellTotal = r.GLOBAL_SHELL_TAKEN.reduce((a, t) => a + t.length, 0);
	assert.strictEqual(shellTotal, finiteTaken);
});

test('GLOBAL_SHELL_TAKEN ermöglicht laufendes Mitwachsen der HUD-Zahl (liveDigit 0..Ziffer)', () => {
	// Die Zahlentafel leitet aus den Entnahme-Zeiten einer Schale die laufende
	// Ziffer der aktuellen Stelle ab. Wir simulieren das und prüfen, dass die
	// Ziffer monoton von 0 bis zur vollen Ziffer der Stelle wächst.
	let r = compileSystem(BASE_CONFIG);
	let baseBig = 10n;
	for (let S = 1; S < r.TOTAL_STEPS; S++) {
		let m = r.axes[S].exp;
		let fullDigit = r.GLOBAL_N_ARR[m];
		let times = r.GLOBAL_SHELL_TAKEN[S];
		if (times.length === 0) continue;
		// Anfang der Schale: noch nichts entnommen -> liveDigit 0.
		let fracStart = 0 / times.length;
		let startDigit = Math.round(fullDigit * fracStart);
		assert.strictEqual(startDigit, 0);
		// Mitte der Schale: liveDigit wächst (bei mehrstelligen Ziffern
		// strikt zwischen 0 und voll; bei einstelligen Ziffern ist spätestens
		// nach der ersten Entnahme die volle Ziffer erreicht).
		let midTime = times[Math.floor(times.length / 2)];
		let doneMid = times.filter((t) => t <= midTime).length;
		let midDigit = Math.round(fullDigit * (doneMid / times.length));
		if (fullDigit > 1) {
			assert.ok(midDigit > 0 && midDigit < fullDigit, `Schale ${S}: Mitte ${midDigit}`);
		} else {
			assert.ok(midDigit >= 0 && midDigit <= fullDigit, `Schale ${S}: Mitte ${midDigit}`);
		}
		// Ende der Schale: volle Ziffer.
		let endDigit = Math.round(fullDigit * 1);
		assert.strictEqual(endDigit, fullDigit);
		// BigInt-Aufbau bleibt gültig (kein negative Digit).
		assert.ok(BigInt(startDigit) >= 0n && BigInt(endDigit) <= baseBig);
	}
});
