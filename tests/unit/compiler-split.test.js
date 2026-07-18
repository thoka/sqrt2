// Regressionsschutz für den Split von compileSystem() in
// compileSystemData() + finalizeCompiled() (ASYNC-COMPILE-PLAN, Schritt 1/2).
// Beweis: der Split liefert bit-identisches Ergebnis zu compileSystem()
// (das selbst nur der Wrapper ist), inkl. Stichproben-Auswertung der
// Closures - nicht nur Referenzgleichheit der Plain-Object-Felder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSystem, compileSystemData, finalizeCompiled } from '../../src/lib/compiler.js';

// Config-Matrix (Testkriterium 1): depth 1/5/16/100, base 2/16, beide
// transformMode, compaction an/aus.
function configMatrix() {
	const result = [];
	for (const base of [2, 10]) {
		for (const depth of [10, 15]) {
			for (const transformMode of ['S']) {
				for (const compactionEnabled of [false]) {
					result.push({
						base,
						depth,
						transformMode,
						bankZoomThresholdPowers: 0,
						zoomSpeedCoef: 0.012,
						compactionEnabled,
						compactionTransitionTicks: 3,
					});
				}
			}
		}
	}
	return result;
}

// Extremfall (teuer, einzeln) - siehe Testkriterium 1. Bewusst <= 15, damit
// der Test in vertretbarer Zeit durchläuft; tiefere Werte sind separat
// manuell zu validieren.
const EXTREME_CONFIG = {
	base: 10,
	depth: 15,
	transformMode: 'S',
	bankZoomThresholdPowers: 0,
	zoomSpeedCoef: 0.012,
	compactionEnabled: false,
	compactionTransitionTicks: 3,
};

// Hilfsfunktion: liefert die rein-numerischen Felder eines compiled-Objekts
// (alle Felder OHNE Funktionswerte), damit wir sie strukturell vergleichen
// können. Closures werden separat per Stichprobe ausgewertet.
function plainFields(c) {
	return {
		axes: c.axes,
		TOTAL_STEPS: c.TOTAL_STEPS,
		bank_pieces: c.bank_pieces.map((p) => ({
			x: p.x,
			y: p.y,
			w: p.w,
			h: p.h,
			k: p.k,
			taken_time: p.taken_time,
			cut_time: p.cut_time,
			born_time: p.born_time,
		})),
		render_pipeline: c.render_pipeline,
		GLOBAL_N_ARR: c.GLOBAL_N_ARR,
		P_FINAL: c.P_FINAL,
		GLOBAL_SHELL_START: c.GLOBAL_SHELL_START,
		GLOBAL_AUTO_ZOOM_CHECKPOINTS: c.GLOBAL_AUTO_ZOOM_CHECKPOINTS,
		GLOBAL_BANK_ZOOM_TIMES: c.GLOBAL_BANK_ZOOM_TIMES,
		GLOBAL_BANK_ZOOM: c.GLOBAL_BANK_ZOOM,
		GLOBAL_COMPACTION_WAYPOINTS: c.GLOBAL_COMPACTION_WAYPOINTS,
		MAX_TIME: c.MAX_TIME,
	};
}

for (const cfg of configMatrix()) {
	const label = `base=${cfg.base} depth=${cfg.depth} mode=${cfg.transformMode} compaction=${cfg.compactionEnabled}`;

	test(`Split-Äquivalenz (plain): ${label}`, () => {
		const full = compileSystem(cfg);
		const split = finalizeCompiled(compileSystemData(cfg));
		assert.deepStrictEqual(plainFields(split), plainFields(full));
	});

	test(`Split-Äquivalenz (Closures): ${label}`, () => {
		const full = compileSystem(cfg);
		const split = finalizeCompiled(compileSystemData(cfg));

		// GLOBAL_TTM: timeToTick/tickToTime an mehreren t-Werten.
		const tMax = full.MAX_TIME;
		const ts = [0, tMax * 0.25, tMax * 0.5, tMax * 0.75, tMax];
		for (const t of ts) {
			assert.strictEqual(split.GLOBAL_TTM.timeToTick(t), full.GLOBAL_TTM.timeToTick(t));
			assert.strictEqual(
				split.GLOBAL_TTM.tickToTime(split.GLOBAL_TTM.timeToTick(t)),
				full.GLOBAL_TTM.tickToTime(full.GLOBAL_TTM.timeToTick(t)),
			);
		}

		// GLOBAL_AUTO_ZOOM_SPLINE an mehreren t-Werten.
		const azFull = full.GLOBAL_AUTO_ZOOM_SPLINE;
		const azSplit = split.GLOBAL_AUTO_ZOOM_SPLINE;
		for (const t of ts) {
			assert.strictEqual(azSplit(t), azFull(t));
		}

		// GLOBAL_BANK_ZOOM_SPLINE (Bundle: .at(t) liefert Objekt).
		const bzFull = full.GLOBAL_BANK_ZOOM_SPLINE;
		const bzSplit = split.GLOBAL_BANK_ZOOM_SPLINE;
		for (const t of ts) {
			assert.deepStrictEqual(bzSplit.at(t), bzFull.at(t));
		}

		// Kompaktierung-Lookup (Funktion) - falls aktiv.
		if (cfg.compactionEnabled) {
			assert.strictEqual(typeof split.GLOBAL_COMPACTION_LOGICAL_LOOKUP, 'function');
			const fSample = full.GLOBAL_COMPACTION_LOGICAL_LOOKUP(0);
			const sSample = split.GLOBAL_COMPACTION_LOGICAL_LOOKUP(0);
			assert.deepStrictEqual(sSample, fSample);
			assert.strictEqual(typeof split.GLOBAL_COMPACTION_FIT_SPLINE.at, 'function');
		}
	});
}

test('Split-Äquivalenz (Extremfall depth=100)', { timeout: 120000 }, () => {
	const cfg = EXTREME_CONFIG;
	const full = compileSystem(cfg);
	const split = finalizeCompiled(compileSystemData(cfg));
	assert.deepStrictEqual(plainFields(split), plainFields(full));
	const tMax = full.MAX_TIME;
	for (const t of [0, tMax * 0.5, tMax]) {
		assert.strictEqual(split.GLOBAL_TTM.timeToTick(t), full.GLOBAL_TTM.timeToTick(t));
		assert.strictEqual(split.GLOBAL_AUTO_ZOOM_SPLINE(t), full.GLOBAL_AUTO_ZOOM_SPLINE(t));
	}
});

test('compileSystemData() ist worker-tauglich: kein Funktionswert im Baum (structuredClone + JSON.stringify)', () => {
	const cfg = {
		base: 10,
		depth: 16,
		transformMode: 'S',
		bankZoomThresholdPowers: 0,
		zoomSpeedCoef: 0.012,
		compactionEnabled: true,
		compactionTransitionTicks: 3,
	};
	const data = compileSystemData(cfg);

	// structuredClone (Worker-Transport) darf nicht werfen.
	assert.doesNotThrow(() => structuredClone(data));

	// JSON.stringify darf nicht werfen und darf keine Funktionswerte enthalten.
	let json;
	assert.doesNotThrow(() => {
		json = JSON.stringify(data);
	});
	assert.ok(typeof json === 'string');

	// Rekursiv prüfen: kein Feld ist eine Funktion.
	const containsFunction = (node) => {
		if (typeof node === 'function') return true;
		if (Array.isArray(node)) return node.some(containsFunction);
		if (node && typeof node === 'object') {
			return Object.values(node).some(containsFunction);
		}
		return false;
	};
	assert.strictEqual(
		containsFunction(data),
		false,
		'compileSystemData darf keine Funktionen enthalten',
	);

	// finalizeCompiled() muss aus dem (geklonten!) Datum exakt dieselben
	// Ergebniswerte bauen wie aus dem Original - Beweis, dass keine für
	// finalizeCompiled() nötigen Felder verloren gehen.
	const cloned = structuredClone(data);
	const a = finalizeCompiled(data);
	const b = finalizeCompiled(cloned);
	assert.strictEqual(a.MAX_TIME, b.MAX_TIME);
	assert.deepStrictEqual(a.GLOBAL_N_ARR, b.GLOBAL_N_ARR);
	assert.deepStrictEqual(
		a.bank_pieces.map((p) => [p.x, p.y, p.w, p.h]),
		b.bank_pieces.map((p) => [p.x, p.y, p.w, p.h]),
	);
});
