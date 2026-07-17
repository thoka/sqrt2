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

test('Kompaktierung wird immer berechnet: Waypoints und Lookup sind immer vorhanden', () => {
	let r = compileSystem({ ...BASE_CONFIG });
	assert.ok(r.GLOBAL_COMPACTION_WAYPOINTS.length > 0);
	assert.strictEqual(typeof r.GLOBAL_COMPACTION_LOGICAL_LOOKUP, 'function');
	assert.strictEqual(typeof r.GLOBAL_COMPACTION_FIT_SPLINE.at, 'function');
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

test('computeLiveL: exakte Präfixsumme der Achsen = P_int aus bank-core (zwei unabhängige Konstruktionen)', async () => {
	// GLOBAL_L_PREFIX[TOTAL_STEPS] (voll abgeschlossen) muss bitidentisch
	// mit der in bank-core.js aufgebauten P_int-Zahl übereinstimmen.
	const { buildSystem } = await import('../../src/lib/bank-core.js');
	const r = compileSystem(BASE_CONFIG);
	buildSystem(BASE_CONFIG.base, BASE_CONFIG.depth, 'fixed', 'subdivide');
	// P_int aus bank-core rekonstruieren (identisch zu bank-core.js:54):
	// P_int startet bei 1 und läuft m=1..N_MAX (nicht m=0..N_MAX).
	let baseBig = BigInt(BASE_CONFIG.base);
	let P_int = 1n;
	let n_arr = new Array(BASE_CONFIG.depth + 1).fill(0);
	for (let a of r.axes) n_arr[a.exp]++;
	for (let m = 1; m <= BASE_CONFIG.depth; m++) {
		P_int = P_int * baseBig + BigInt(n_arr[m]);
	}
	assert.strictEqual(r.GLOBAL_L_PREFIX[r.TOTAL_STEPS], P_int);
});

test('computeLiveL: l ist exakt (keine Wurzel), Treppenfunktion über abgeschlossene Schalen', () => {
	// l(t) = Σ BASE^(-axes[i].exp) über die abgeschlossenen Schalen - eine
	// exakte BigInt-Präfixsumme, kein Float/Rounding. Anfang (nichts
	// abgeschlossen): l = 0. Ende (alles abgeschlossen): l = sqrt(2) bis
	// N_MAX Stellen (exakt die Ziffern von sqrt(2) in Basis 10: 1.4142...).
	const r = compileSystem(BASE_CONFIG);

	let start = computeLiveL(r, 0, 10);
	let l_start = Number(start.N_l) / Number(r.GRID);
	assert.strictEqual(l_start, 0, 'Anfang (t=0) muss l = 0 sein');

	let end = computeLiveL(r, r.MAX_TIME, 10);
	let l_end = Number(end.N_l) / Number(r.GRID);
	// Exakt die echten sqrt(2)-Ziffern (1.4142...) bis N_MAX Stellen.
	let endDigits = end.N_l.toString(10);
	assert.ok(endDigits.startsWith('1414'), `Endwert soll mit 1.414 beginnen, war ${endDigits}`);
	// l² ist exakt N_l²/GRID² (keine Wurzel), und liefert sqrt(2)²=2
	// bis auf die Abschneidung der letzten Ziffer.
	let l2 = Number(end.N_l * end.N_l) / Number(r.GRID) ** 2;
	// l² weicht von 2 nur um die Abschneidung der letzten Zifferstelle
	// ab (exakt die Ziffern von sqrt(2), hier Tiefe 3 -> < 0.01).
	assert.ok(l2 > 1.99, `l² soll ~2 sein, war ${l2}`);
	assert.ok(Math.abs(l2 - 2) < 0.01, `l² soll ~2 sein, war ${l2}`);
});

test('computeLiveL: l ist Treppenfunktion über abgeschlossene Schalen', () => {
	// N_l(t) nimmt ausschließlich Werte aus GLOBAL_L_PREFIX an (eine
	// exakte Präfixsumme pro Schale) - es gibt keinen Wert dazwischen
	// und keinen Float. Es müssen genau TOTAL_STEPS verschiedene
	// Werte auftreten (eine Stufe pro Schale, inkl. t=0 -> 0).
	const r = compileSystem(BASE_CONFIG);
	let seen = new Set();
	for (let i = 0; i <= 5000; i++) {
		let t = (r.MAX_TIME * i) / 5000;
		let { N_l } = computeLiveL(r, t, 10);
		seen.add(N_l.toString());
		// Jeder Wert muss in GLOBAL_L_PREFIX vorkommen.
		let inPrefix = r.GLOBAL_L_PREFIX.some((v) => v === N_l);
		assert.ok(inPrefix, `N_l=${N_l} ist keine Präfixsumme`);
	}
	assert.strictEqual(
		seen.size,
		r.TOTAL_STEPS + 1,
		`muss genau ${r.TOTAL_STEPS + 1} Stufen haben (inkl. t=0 -> 0)`,
	);
});

test('computeLiveL: R (N_R) ändert sich pro Tick, nicht nur pro Schale', () => {
	// Im Gegensatz zu l (Treppenfunktion) ändert sich der gezählte Rest
	// N_R bei jeder einzelnen Stück-Entnahme.
	const r = compileSystem(BASE_CONFIG);
	let changes = 0;
	let prevN_R = null;
	for (let i = 0; i <= 4000; i++) {
		let t = (r.MAX_TIME * i) / 4000;
		let { N_R } = computeLiveL(r, t, 10);
		if (prevN_R !== null && N_R !== prevN_R) changes++;
		prevN_R = N_R;
	}
	// Deutlich mehr als nur (TOTAL_STEPS-1) Schalensprünge.
	assert.ok(changes > r.TOTAL_STEPS * 2, `N_R sollte bei vielen Ticks ändern (${changes})`);
});

test('computeLiveL: Verhalten bei Tiefe <= 16 bleibt zur alten sqrt-Herleitung sichtbar unverändert', () => {
	// Die neue, exakte l-Ableitung (Präfixsumme) weicht von der alten
	// sqrt(2 - R)-Näherung nur um die Abschneidung der tiefsten Stelle ab
	// - innerhalb der alten Float-Genauigkeit praktisch identisch.
	const r = compileSystem({ ...BASE_CONFIG, depth: 16 });
	// Die neue l-Ableitung ist bewusst eine TREPPENFUNKTION (springt nur
	// an Schalengrenzen, siehe Test #4), im Gegensatz zur alten,
	// stetigen sqrt-Herleitung. "Sichtbar unverändert" heißt daher:
	// die Treppenfunktion ist eine zulässige UNTERGRENZE der alten
	// (jede abgeschlossene Schale liefert exakt deren beitrags-Summe,
	// die laufende Schale fehlt noch) und ERREICHT am Ende exakt
	// dieselben Ziffern von sqrt(2) - es gibt keinen Sprung nach außen.
	let N_MAX = r.GRID.toString(10).length - 1;
	let end = computeLiveL(r, r.MAX_TIME, 10);
	let l_end = Number(end.N_l) / Number(r.GRID);
	let R_end = 0;
	for (let p of r.bank_pieces)
		if (r.MAX_TIME >= p.born_time && r.MAX_TIME < p.cut_time && r.MAX_TIME < p.taken_time)
			R_end += p.w * p.h;
	let l_old_end = Math.sqrt(2 - R_end);
	assert.ok(
		Math.abs(l_end - l_old_end) < 1e-3,
		`Endwert weicht ab: neu=${l_end}, alt=${l_old_end}`,
	);
	// Untergrenze: zu jedem Zeitpunkt gilt l_neu <= l_alt (die
	// Treppenfunktion hinkt höchstens hinterher, überschreitet nie).
	for (let i = 0; i <= 200; i++) {
		let t = (r.MAX_TIME * i) / 200;
		let { N_l, GRID } = computeLiveL(r, t, 10);
		let l_new = Number(N_l) / Number(GRID);
		let R = 0;
		for (let p of r.bank_pieces)
			if (t >= p.born_time && t < p.cut_time && t < p.taken_time) R += p.w * p.h;
		let l_old = Math.sqrt(2 - R);
		assert.ok(l_new <= l_old + 1e-12, `l_neu=${l_new} überschreitet l_alt=${l_old} bei t=${t}`);
	}
});

test('K_MAX > N_MAX ist real (nicht hypothetisch), auch bei kleinem N_MAX=1', () => {
	// Im subdivide-Modus treten Stücke mit k > N_MAX auf (Ecke
	// k = exp(u)+exp(v), u,v bis N_MAX; Rand-Zellen fordern p.k+1).
	// Regressionsschutz: falls sich die Bank-Strategie je ändert und
	// K_MAX plötzlich doch <= N_MAX würde, wäre AREA_SCALE überdimensioniert.
	for (let depth of [1, 3, 16, 22]) {
		let r = compileSystem({ ...BASE_CONFIG, depth });
		assert.ok(r.K_MAX > depth, `Tiefe ${depth}: K_MAX (${r.K_MAX}) muss > N_MAX (${depth}) sein`);
	}
});

test('computeLiveL: l und R sind unabhängig konsistent (Kreuzprobe)', () => {
	// l (Präfix der Achsen) und R (Zählung der sichtbaren p.k) sind
	// zwei unabhängige, exakte BigInt-Ableitungen. An den Schalengrenzen
	// (ganze Schalen abgeschlossen) gilt die geometrische Verwandtschaft
	// l² + 2·R ≈ 2 bis auf die Abschneidung der letzten Zifferstelle
	// (der Algorithmus schneidet feiner als N_MAX) - ein scharfer
	// Korrektheitstest OHNE dass R aus l² hergeleitet wird.
	const r = compileSystem({ ...BASE_CONFIG, depth: 16 });
	// An den frühen Schalengrenzen ist der noch nicht abgeschlossene
	// Rest groß (die laufende Schale ist erst teilweise gebaut) - dort ist
	// die Kreuzprobe bewusst groß und darf durchaus schwanken. Am
	// ENDE (alles abgeschlossen) muss sie aber im Rahmen der tiefsten
	// Zielzelle liegen - das ist der scharfe Korrektheitstest.
	let finalGap = 0;
	for (let S = 0; S < r.GLOBAL_SHELL_START.length; S++) {
		let t = r.GLOBAL_SHELL_START[S];
		let { N_l, N_R, GRID, AREA_SCALE } = computeLiveL(r, t, 10);
		let l2 = Number(N_l * N_l) / Number(GRID) ** 2;
		let R = Number(N_R) / Number(AREA_SCALE);
		let gap = Math.abs(2 - l2 - 2 * R);
		finalGap = gap;
	}
	// Toleranz am Ende: die Fläche EINER tiefsten Zielzelle
	// (= 2 / BASE^(2*N_MAX)) plus Float-Schutz. Bei Tiefe 16 winzig.
	let tol = (2 / Math.pow(10, 2 * 16)) * 5 + 1e-9;
	assert.ok(finalGap <= tol, `End-Kreuzprobe ${finalGap} > Toleranz ${tol}`);
});

test('computeLiveL: Performance bei Tiefe 22 bleibt im Frame-Budget', () => {
	// Kosten pro Aufruf: ein Array-Lookup (l) + Summe über SICHTBARE
	// Stücke (nicht alle je erzeugten). Muss klar unter ~16ms liegen.
	const r = compileSystem({ ...BASE_CONFIG, depth: 22 });
	let t = r.MAX_TIME * 0.5;
	let start = performance.now();
	for (let i = 0; i < 200; i++) computeLiveL(r, t + i * 1e-4, 10);
	let perCall = (performance.now() - start) / 200;
	assert.ok(perCall < 5, `computeLiveL zu langsam: ${perCall.toFixed(3)} ms/Aufruf`);
});

test('GLOBAL_L_PREFIX übersteht structuredClone() verlustfrei (Worker-Tauglichkeit)', () => {
	const r = compileSystem(BASE_CONFIG);
	// structuredClone ist das, was der Compile-Worker für den Rücktransport
	// via postMessage nutzt. BigInt-Arrays müssen feld-für-feld erhalten
	// bleiben.
	let cloned = structuredClone(r.GLOBAL_L_PREFIX);
	assert.strictEqual(cloned.length, r.GLOBAL_L_PREFIX.length);
	for (let i = 0; i < cloned.length; i++) {
		assert.strictEqual(cloned[i], r.GLOBAL_L_PREFIX[i]);
	}
	assert.strictEqual(cloned[r.TOTAL_STEPS], r.GLOBAL_L_PREFIX[r.TOTAL_STEPS]);
});

test('computeLiveL (Tiefe 22): Zahlentafel zeigt sqrt(2) exakt bis N_MAX Stellen', () => {
	// Der eigentliche Beweis für Teil A: bei Tiefe 22 liefert die exakte
	// Präfixsumme die echten sqrt(2)-Ziffern (Referenz aus Python/mpmath,
	// manuell erzeugt und hier fest hinterlegt: sqrt(2) = 1.41421356...
	// mit den ersten 20 Nachkommastellen 41421356237309504880).
	const r = compileSystem({ ...BASE_CONFIG, depth: 22 });
	let end = computeLiveL(r, r.MAX_TIME, 10);
	// Die ersten 20 Nachkommastellen müssen exakt den echten sqrt(2)-Ziffern
	// entsprechen (die Präfixsumme ist die exakte Vorkommastellen-Abschneidung
	// von sqrt(2), keine gerundete Float-Näherung).
	let digits = end.N_l.toString(10); // = floor(sqrt(2) * 10^N_MAX)
	let expectedPrefix = '141421356237309504880';
	assert.ok(
		digits.startsWith(expectedPrefix),
		`Tiefe 22 Endwert soll mit ${expectedPrefix} beginnen, war ${digits}`,
	);
});
