// Tests für TEIL B (REST-PRECISION-PLAN): robuste Zoom-Bounding-Box via
// lokale Vorfahren-Rezentrierung. Läuft via `pnpm test` (node:test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSystem, relativePosition } from '../../src/lib/compiler.js';
import { buildSystem, applyCompactionFit } from '../../src/lib/bank-core.js';

const BASE_CONFIG = {
	base: 10,
	depth: 3,
	transformMode: 'S',
	bankZoomThresholdPowers: 0,
	zoomSpeedCoef: 0.012,
	compactionEnabled: false,
	compactionTransitionTicks: 3,
};

test('relativePosition: liefert exakt die gefaltete Differenz (synthetisch, Rasterindex-Semantik)', () => {
	// NEUE Semantik (Teil B): localOffset = ganzzahliger Rasterindex i
	// (0..BASE-1) des Child im Parent. Absolute Position = Faltung
	//   x = ((...(i_root)/BASE + i_1)/BASE + ... + i_blatt)/BASE
	// rel.dx = exakte relative Position in [0,1]-Einheiten (kein Float-x).
	// Baum: Wurzel(0), A=Raster 1 (x=0.1), B=Raster 3 (x=0.3),
	// C=Kind von B, Raster 1 -> x = 0.3 + 1*0.1*0.1 = 0.31.
	const BASE = 10;
	let pieces = [
		{ id: 0, parent_id: null, localOffsetX: 0, localOffsetY: 0 },
		{ id: 1, parent_id: 0, localOffsetX: 1, localOffsetY: 0 },
		{ id: 2, parent_id: 0, localOffsetX: 3, localOffsetY: 0 },
		{ id: 3, parent_id: 2, localOffsetX: 1, localOffsetY: 5 },
	];
	// exakte Position (blatt->wurzel gefaltet)
	function exactX(p, map) {
		let path = [];
		for (let c = p; c; c = map.get(c.parent_id)) path.push(c);
		let x = 0;
		for (let e = 0; e < path.length; e++) x += path[e].localOffsetX * Math.pow(BASE, -(e + 1));
		return x;
	}
	function exactY(p, map) {
		let path = [];
		for (let c = p; c; c = map.get(c.parent_id)) path.push(c);
		let y = 0;
		for (let e = 0; e < path.length; e++) y += path[e].localOffsetY * Math.pow(BASE, -(e + 1));
		return y;
	}
	let parentMap = new Map(pieces.map((p) => [p.id, p]));
	let rel = relativePosition(pieces[3], pieces[1], parentMap, BASE);
	let ex = exactX(pieces[3], parentMap) - exactX(pieces[1], parentMap);
	let ey = exactY(pieces[3], parentMap) - exactY(pieces[1], parentMap);
	assert.ok(Math.abs(rel.dx - ex) < 1e-15);
	assert.ok(Math.abs(rel.dy - ey) < 1e-15);
	// Symmetrie
	let rel2 = relativePosition(pieces[1], pieces[3], parentMap, BASE);
	assert.ok(Math.abs(rel2.dx + rel.dx) < 1e-15);
});

test('relativePosition: terminiert und ist korrekt für gemeinsamen Vorfahren = Wurzel', () => {
	let { sim } = buildSystem(10, 6, 'fixed', 'subdivide');
	let parentMap = new Map(sim.bank_pieces.map((p) => [p.id, p]));
	let a = sim.bank_pieces[1];
	let b = sim.bank_pieces[sim.bank_pieces.length - 1];
	function exactX(p, map) {
		let path = [];
		for (let c = p; c; c = map.get(c.parent_id)) path.push(c);
		let x = 0;
		for (let e = 0; e < path.length; e++) x += path[e].localOffsetX * Math.pow(10, -(e + 1));
		return x;
	}
	let rel = relativePosition(a, b, parentMap, 10);
	assert.ok(Number.isFinite(rel.dx) && Number.isFinite(rel.dy));
	assert.ok(Math.abs(rel.dx - (exactX(a, parentMap) - exactX(b, parentMap))) < 1e-12);
});

test('Zoom-Bounding-Box kollabiert nicht bei Tiefe 22 (z endlich und positiv)', () => {
	// Das ursprünglich gemeldete Symptom: bei Tiefe 22 schlägt die
	// Float64-Differenz fehl -> halfW->0 -> z->Infinity/NaN.
	const r = compileSystem({ ...BASE_CONFIG, depth: 22 });
	assert.ok(r.GLOBAL_BANK_ZOOM.length > 0, 'Bank-Zoom-Checkpoints müssen existieren');
	for (let s of r.GLOBAL_BANK_ZOOM) {
		assert.ok(Number.isFinite(s.z), `z muss endlich sein, war ${s.z}`);
		assert.ok(s.z > 0, `z muss positiv sein, war ${s.z}`);
		assert.ok(Number.isFinite(s.cx), `cx muss endlich sein, war ${s.cx}`);
		assert.ok(Number.isFinite(s.offsetX), `offsetX muss endlich sein, war ${s.offsetX}`);
	}
});

test('Sichtbarkeit im kompaktierten Raum: alle sichtbaren Stücke in [0,1] (Teil C, Tiefe 22)', () => {
	// TEIL C: der Zoom framt die kompaktierte Geometrie. Hier wird geprüft,
	// dass ALLE sichtbaren Stücke im kompaktierten Raum ihre Ecken in [0,1]
	// haben (kein kThresholdDiff-Filter - mit Kompaktierung werden alle
	// Stücke berücksichtigt). Die Kompaktierung kommt aus zoom_waypoints.
	const r = compileSystem({ ...BASE_CONFIG, depth: 22 });
	const bp = r.bank_pieces;
	const zoomWp = r.zoom_waypoints;
	assert.ok(zoomWp && zoomWp.length > 0, 'zoom_waypoints müssen existieren');
	const lookup = r.zoom_rect_lookup;
	assert.ok(typeof lookup === 'function', 'zoom_rect_lookup muss eine Funktion sein');
	let outside = 0,
		total = 0;
	for (let i = 0; i < r.GLOBAL_BANK_ZOOM_TIMES.length; i++) {
		const t = r.GLOBAL_BANK_ZOOM_TIMES[i];
		const s = r.GLOBAL_BANK_ZOOM[i];
		if (!isFinite(s.z) || s.z <= 0) continue;
		const vis = bp.filter((p) => t >= p.born_time && t < p.cut_time && t < p.taken_time);
		if (vis.length === 0) continue;
		// Anker = schwerste Gruppe (max w*h, wie im Compiler)
		let anchor = null,
			aR = null,
			bestMass = -1;
		for (const p of vis) {
			const rr = lookup(p, t);
			if (!rr) continue;
			const mass = rr.w * rr.h;
			if (mass > bestMass) {
				bestMass = mass;
				anchor = p;
				aR = rr;
			}
		}
		if (!aR || aR.w <= 0 || aR.h <= 0) continue;
		const m = 1e-6;
		for (const p of vis) {
			const rr = lookup(p, t);
			if (!rr) continue;
			const x0 = rr.x - aR.x;
			const x1 = x0 + rr.w;
			const y0 = rr.y - aR.y;
			const y1 = y0 + rr.h;
			const sx0 = x0 * s.z + s.offsetX,
				sx1 = x1 * s.z + s.offsetX;
			const sy0 = y0 * s.z + s.offsetY,
				sy1 = y1 * s.z + s.offsetY;
			if (sx0 < -m || sx1 > 1 + m || sy0 < -m || sy1 > 1 + m) outside++;
			total++;
		}
	}
	assert.strictEqual(
		outside,
		0,
		`${outside}/${total} Stücke fielen aus dem Fenster (kompaktierter Raum)`,
	);
});

test('Kompaktierung bricht nie zusammen: z/endlich, Rest-Fläche >0 (Teil C, Tiefen 5/8/12)', () => {
	// TEIL C: die alte externe Kompaktierung brach bei hoher Tiefe wegen
	// Float-Genauigkeit zusammen → z wurde NaN/Infinity, Rest-Fläche = 0%.
	// Teil C nutzt die kompaktierte Geometrie direkt im Zoom-Pfad (Float-sicher),
	// sodass die Kompaktierung bei jeder Tiefe funktioniert. Hier wird geprüft:
	// 1. z, cx, cy, offsetX/Y sind bei allen Checkpoints endlich und sinnvoll.
	// 2. Die Rest-Fläche (nach Kompaktierung) ist bei jedem Checkpoint >0
	//    (sofern sichtbare Stücke existieren).
	for (let depth of [5, 8, 12]) {
		const r = compileSystem({ ...BASE_CONFIG, depth });
		const bp = r.bank_pieces;
		const lookup = r.zoom_rect_lookup;
		assert.ok(typeof lookup === 'function', 'zoom_rect_lookup muss eine Funktion sein');
		let nonFiniteCount = 0;
		let zeroAreaCount = 0;
		let totalChecks = 0;
		for (let i = 0; i < r.GLOBAL_BANK_ZOOM_TIMES.length; i++) {
			const t = r.GLOBAL_BANK_ZOOM_TIMES[i];
			const s = r.GLOBAL_BANK_ZOOM[i];
			const vis = bp.filter((p) => t >= p.born_time && t < p.cut_time && t < p.taken_time);
			if (vis.length === 0) continue;
			totalChecks++;
			if (!isFinite(s.z) || s.z <= 0 || !isFinite(s.cx) || !isFinite(s.offsetX)) {
				nonFiniteCount++;
			}
			// Rest-Fläche >0 prüfen
			let aR = null,
				bestMass = -1;
			for (const p of vis) {
				const rr = lookup(p, t);
				if (!rr) continue;
				const mass = rr.w * rr.h;
				if (mass > bestMass) {
					bestMass = mass;
					aR = rr;
				}
			}
			if (aR && aR.w > 0 && aR.h > 0) {
				let totalArea = 0;
				for (const p of vis) {
					const rr = lookup(p, t);
					if (!rr) continue;
					totalArea += (rr.w / aR.w) * (rr.h / aR.h);
				}
				if (totalArea <= 0) zeroAreaCount++;
			}
		}
		assert.strictEqual(
			nonFiniteCount,
			0,
			`Tiefe ${depth}: ${nonFiniteCount}/${totalChecks} Checkpoints mit NaN/Infinity in z/cx/offsetX`,
		);
		assert.strictEqual(
			zeroAreaCount,
			0,
			`Tiefe ${depth}: ${zeroAreaCount}/${totalChecks} Checkpoints mit Rest-Fläche = 0`,
		);
	}
});

test('Größte Reste im Zoom-Rahmen: k-größte Stücke landen innerhalb [0,1] (Tiefe 10, Base 10)', () => {
	// Der Zoom framt die kompaktierte Geometrie. Die größten sichtbaren
	// Reste (kleinste k → größte Fläche) müssen nach Zoom-Transform
	// (compactedRect - anchor) * z + offset innerhalb [0,1] liegen.
	// FAILED, wenn die größten Reste außerhalb des Zoom-Rahmens landen.
	const r = compileSystem({ ...BASE_CONFIG, depth: 10 });
	const bp = r.bank_pieces;
	const lookup = r.zoom_rect_lookup;
	assert.ok(typeof lookup === 'function');
	let violations = [];
	let totalLargest = 0;
	for (let i = 0; i < r.GLOBAL_BANK_ZOOM_TIMES.length; i++) {
		const t = r.GLOBAL_BANK_ZOOM_TIMES[i];
		const s = r.GLOBAL_BANK_ZOOM[i];
		if (!isFinite(s.z) || s.z <= 0) continue;
		const vis = bp.filter((p) => t >= p.born_time && t < p.cut_time && t < p.taken_time);
		if (vis.length === 0) continue;
		// Anker = schwerste Gruppe (max w*h), wie im Compiler
		let anchor = null,
			aR = null,
			bestMass = -1;
		for (const p of vis) {
			const rr = lookup(p, t);
			if (!rr) continue;
			if (rr.w * rr.h > bestMass) {
				bestMass = rr.w * rr.h;
				anchor = p;
				aR = rr;
			}
		}
		if (!aR) continue;
		// Größte Reste = kleinste k (größte Fläche w*h)
		const kMin = Math.min(...vis.map((p) => p.k));
		const largest = vis.filter((p) => p.k === kMin);
		const m = 1e-6;
		for (const p of largest) {
			totalLargest++;
			const rr = lookup(p, t);
			if (!rr) continue;
			const x0 = rr.x - aR.x;
			const y0 = rr.y - aR.y;
			const sx0 = x0 * s.z + s.offsetX;
			const sx1 = (x0 + rr.w) * s.z + s.offsetX;
			const sy0 = y0 * s.z + s.offsetY;
			const sy1 = (y0 + rr.h) * s.z + s.offsetY;
			if (sx0 < -m || sx1 > 1 + m || sy0 < -m || sy1 > 1 + m) {
				violations.push({
					tick: i,
					t: t.toFixed(2),
					k: p.k,
					sx: `${sx0.toFixed(3)}..${sx1.toFixed(3)}`,
					sy: `${sy0.toFixed(3)}..${sy1.toFixed(3)}`,
				});
			}
		}
	}
	assert.ok(totalLargest > 0, 'mindestens ein größeres Stück vorhanden');
	assert.strictEqual(
		violations.length,
		0,
		`${violations.length}/${totalLargest} größte Reste außerhalb [0,1]: ${JSON.stringify(violations.slice(0, 5))}`,
	);
});

test('Renderer-Pfad (compactionFit): project() liefert finite, sichtbare Koordinaten für alle Stücke (Tiefe 5)', () => {
	// Der Renderer nutzt GLOBAL_COMPACTION_LOGICAL_LOOKUP + applyCompactionFit
	// (NICHT bankT). Dieser Test exercised genau diesen Pfad und prüft, dass
	// er für alle sichtbaren Stücke bei allen Checkpoints finite,
	// nicht-negative Koordinaten liefert (die auf dem Canvas landen).
	const r = compileSystem({ ...BASE_CONFIG, depth: 5 });
	const bp = r.bank_pieces;
	const lookup = r.GLOBAL_COMPACTION_LOGICAL_LOOKUP;
	const fitSpline = r.GLOBAL_COMPACTION_FIT_SPLINE;
	assert.ok(lookup, 'GLOBAL_COMPACTION_LOGICAL_LOOKUP muss existieren');
	assert.ok(fitSpline, 'GLOBAL_COMPACTION_FIT_SPLINE muss existieren');
	const times = r.GLOBAL_BANK_ZOOM_TIMES;
	assert.ok(times.length > 0, 'mindestens ein Checkpoint');
	let violations = 0;
	let total = 0;
	for (let i = 0; i < times.length; i++) {
		const t = times[i];
		const fit = fitSpline.at(t);
		assert.ok(fit, `compactionFit muss für t=${t} existieren`);
		assert.ok(
			Number.isFinite(fit.z) && fit.z > 0,
			`fit.z muss positiv sein, war ${fit.z} bei t=${t}`,
		);
		const vis = bp.filter((p) => t >= p.born_time && t < p.cut_time && t < p.taken_time);
		for (const p of vis) {
			const logical = lookup(p, t);
			if (!logical) continue;
			const r = applyCompactionFit(logical, fit);
			total++;
			const ok =
				Number.isFinite(r.x) &&
				Number.isFinite(r.y) &&
				Number.isFinite(r.w) &&
				Number.isFinite(r.h) &&
				r.w > 0 &&
				r.h > 0 &&
				r.x >= -1 &&
				r.x <= 2 &&
				r.y >= -1 &&
				r.y <= 2;
			if (!ok) violations++;
		}
	}
	assert.ok(total > 0, 'mindestens ein Stück geprüft');
	assert.strictEqual(
		violations,
		0,
		`${violations}/${total} Stücke mit invaliden Koordinaten im Compaction-Fit-Pfad`,
	);
});

test('Renderer-Pfad vollständig: Canvas-Koordinaten sind finite, positive Pixelwerte (Tiefe 5)', () => {
	// Simuliert den exakten Pfad aus TargetBankCanvas project():
	// applyCompactionFit → V_SCALE_BANK → BANK_X_OFFSET → *scale.
	// Prüft, dass das Ergebnis finite, positive Pixel-Koordinaten sind.
	const r = compileSystem({ ...BASE_CONFIG, depth: 5 });
	const bp = r.bank_pieces;
	const lookup = r.GLOBAL_COMPACTION_LOGICAL_LOOKUP;
	const fitSpline = r.GLOBAL_COMPACTION_FIT_SPLINE;
	assert.ok(lookup && fitSpline);
	const SQRT2 = Math.SQRT2;
	const V_SCALE_BANK = 1.0;
	const BANK_X_OFFSET = SQRT2 + 0.1;
	const times = r.GLOBAL_BANK_ZOOM_TIMES;
	let violations = 0;
	let total = 0;
	for (let i = 0; i < times.length; i++) {
		const t = times[i];
		const fit = fitSpline.at(t);
		if (!fit || !Number.isFinite(fit.z)) continue;
		const vis = bp.filter((p) => t >= p.born_time && t < p.cut_time && t < p.taken_time);
		for (const p of vis) {
			const logical = lookup(p, t);
			if (!logical) continue;
			const cr = applyCompactionFit(logical, fit);
			// Exakter Pfad aus project():
			const final_x = BANK_X_OFFSET + cr.x * V_SCALE_BANK;
			const final_y = cr.y * V_SCALE_BANK;
			const final_w = cr.w * V_SCALE_BANK;
			const final_h = cr.h * V_SCALE_BANK;
			total++;
			const ok =
				Number.isFinite(final_x) &&
				Number.isFinite(final_y) &&
				Number.isFinite(final_w) &&
				Number.isFinite(final_h) &&
				final_w > 0 &&
				final_h > 0;
			if (!ok) violations++;
		}
	}
	assert.ok(total > 0);
	assert.strictEqual(
		violations,
		0,
		`${violations}/${total} Stücke mit invaliden Canvas-Koordinaten`,
	);
});

test('isolationScore / Simulationskern unverändert: localOffset ist Rasterindex, x/y im [0,1]', () => {
	// Teil B fasst bank-core.js nur additiv an (neue Felder) - x/y/w/h
	// und damit die Hot-Path-Simulation dürfen sich nicht ändern.
	// localOffsetX/Y sind ganzzahlige Rasterindizes (0..BASE-1); x/y
	// bleiben im Einheitsquadrat.
	const r = compileSystem(BASE_CONFIG);
	const BASE = BASE_CONFIG.base;
	for (let p of r.bank_pieces) {
		if (p.parent_id === null) {
			assert.strictEqual(p.localOffsetX, 0);
			assert.strictEqual(p.localOffsetY, 0);
		} else {
			assert.ok(Number.isInteger(p.localOffsetX) && p.localOffsetX >= 0 && p.localOffsetX < BASE);
			assert.ok(Number.isInteger(p.localOffsetY) && p.localOffsetY >= 0 && p.localOffsetY < BASE);
		}
		assert.ok(p.x >= -1e-9 && p.x <= 1 + 1e-9 && p.y >= -1e-9 && p.y <= 1 + 1e-9);
	}
});
