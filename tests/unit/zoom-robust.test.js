// Tests für TEIL B (REST-PRECISION-PLAN): robuste Zoom-Bounding-Box via
// lokale Vorfahren-Rezentrierung. Läuft via `pnpm test` (node:test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSystem, relativePosition } from '../../src/lib/compiler.js';
import { buildSystem } from '../../src/lib/bank-core.js';

const BASE_CONFIG = {
	base: 10,
	depth: 3,
	transformMode: 'S',
	bankZoomThresholdPowers: 0,
	zoomSpeedCoef: 0.012,
	compactionEnabled: false,
	compactionTransitionTicks: 3,
};

test('relativePosition: liefert exakt die Differenz p.x - q.x (synthetisch nachgerechnet)', () => {
	// Baum von Hand bauen: Wurzel, Kind A bei (0.1,0), Kind B bei (0.3,0),
	// Enkel C (Kind von B) bei (0.31, 0.05).
	let pieces = [
		{ id: 0, parent_id: null, x: 0, y: 0, localOffsetX: 0, localOffsetY: 0, w: 1, h: 1 },
		{ id: 1, parent_id: 0, x: 0.1, y: 0, localOffsetX: 0.1, localOffsetY: 0, w: 0.1, h: 1 },
		{ id: 2, parent_id: 0, x: 0.3, y: 0, localOffsetX: 0.3, localOffsetY: 0, w: 0.1, h: 1 },
		{
			id: 3,
			parent_id: 2,
			x: 0.31,
			y: 0.05,
			localOffsetX: 0.01,
			localOffsetY: 0.05,
			w: 0.01,
			h: 0.1,
		},
	];
	let parentMap = new Map(pieces.map((p) => [p.id, p]));
	let rel = relativePosition(pieces[3], pieces[1], parentMap);
	assert.ok(Math.abs(rel.dx - (pieces[3].x - pieces[1].x)) < 1e-15);
	assert.ok(Math.abs(rel.dy - (pieces[3].y - pieces[1].y)) < 1e-15);
	// Symmetrie
	let rel2 = relativePosition(pieces[1], pieces[3], parentMap);
	assert.ok(Math.abs(rel2.dx + rel.dx) < 1e-15);
});

test('relativePosition: terminiert und ist korrekt für gemeinsamen Vorfahren = Wurzel', () => {
	let { sim } = buildSystem(10, 6, 'fixed', 'subdivide');
	let parentMap = new Map(sim.bank_pieces.map((p) => [p.id, p]));
	let a = sim.bank_pieces[1];
	let b = sim.bank_pieces[sim.bank_pieces.length - 1];
	let rel = relativePosition(a, b, parentMap);
	assert.ok(Number.isFinite(rel.dx) && Number.isFinite(rel.dy));
	assert.ok(Math.abs(rel.dx - (a.x - b.x)) < 1e-9);
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

test('Selbstregulierung: räumlich nahe Stücke haben kurze Vorfahren-Kette (Tiefe 22)', () => {
	// Beleg für die behauptete Kosten-Eigenschaft: genau die Stücke, die
	// räumlich NAHE beieinander liegen (der Fall, in dem Float-Auslöschung
	// droht), haben einen tiefen gemeinsamen Vorfahr -> kurze localOffset-
	// Kette. Wir suchen das räumlich nächste Paar im Framing-Verband und
	// prüfen, dass dessen relative Kette kurz ist.
	const r = compileSystem({ ...BASE_CONFIG, depth: 22 });
	let parentMap = new Map(r.bank_pieces.map((p) => [p.id, p]));
	function chainDepth(p, q) {
		let pathP = [];
		for (let cur = p; cur; cur = parentMap.get(cur.parent_id)) pathP.push(cur);
		let pathQ = [];
		for (let cur = q; cur; cur = parentMap.get(cur.parent_id)) pathQ.push(cur);
		let i = pathP.length - 1,
			j = pathQ.length - 1;
		while (i >= 0 && j >= 0 && pathP[i].id === pathQ[j].id) {
			i--;
			j--;
		}
		return i + 1 + (j + 1); // Schritte unterhalb des LCA (beide Pfade)
	}
	function dist(p, q) {
		return Math.hypot(p.x - q.x, p.y - q.y);
	}
	// Mehrere Checkpoints abtasten; das jeweils nächste Paar muss eine
	// kurze Kette haben.
	let worstClosestChain = 0;
	for (let f = 0.25; f <= 0.75; f += 0.25) {
		let t = r.MAX_TIME * f;
		let framing = r.bank_pieces.filter(
			(p) => t >= p.born_time && t < p.cut_time && t < p.taken_time,
		);
		if (framing.length < 2) continue;
		// nächstes Paar (O(n^2), n klein im Framing-Verband)
		let best = Infinity;
		for (let a = 0; a < framing.length; a++)
			for (let b = a + 1; b < framing.length; b++) {
				let d = dist(framing[a], framing[b]);
				if (d < best) best = d;
			}
		// das Paar mit der kleinsten Distanz finden und seine Kette messen
		let closest = null;
		for (let a = 0; a < framing.length; a++)
			for (let b = a + 1; b < framing.length; b++) {
				if (Math.abs(dist(framing[a], framing[b]) - best) < 1e-12) {
					closest = [framing[a], framing[b]];
					break;
				}
			}
		if (closest)
			worstClosestChain = Math.max(worstClosestChain, chainDepth(closest[0], closest[1]));
	}
	// Das räumlich nächste Paar teilt einen tiefen Vorfahren -> Kette kurz
	// (deutlich unter K_MAX ~ 40-50).
	assert.ok(
		worstClosestChain < 12,
		`Kette des nächsten Paars ${worstClosestChain} sollte kurz sein`,
	);
});

test('Regressions-Parität: z weicht bei Normal-Tiefen (3-8) kaum von der rohen Differenz ab', () => {
	// Bei flachen Tiefen ist die rohe Float64-Differenz ausreichend genau;
	// die neue, robuste Box muss nahezu identisch sein (enge Toleranz).
	// Die Referenz nutzt denselben kThresholdDiff-Filter wie finalizeCompiled.
	for (let depth of [3, 5, 8]) {
		const r = compileSystem({ ...BASE_CONFIG, depth });
		let bankZoomThresholdPowers = BASE_CONFIG.bankZoomThresholdPowers;
		let kThresholdDiff = 2 * bankZoomThresholdPowers;
		for (let i = 0; i < r.GLOBAL_BANK_ZOOM.length; i++) {
			let t = r.GLOBAL_BANK_ZOOM_TIMES[i];
			let visibleNow = r.bank_pieces.filter(
				(p) => t >= p.born_time && t < p.cut_time && t < p.taken_time,
			);
			if (visibleNow.length === 0) continue;
			let kMin = Math.min(...visibleNow.map((p) => p.k));
			let framing = visibleNow.filter(
				(p) => !(bankZoomThresholdPowers > 0 && p.k > kMin + kThresholdDiff),
			);
			if (framing.length === 0) continue;
			let minX = Math.min(...framing.map((p) => p.x));
			let maxX = Math.max(...framing.map((p) => p.x + p.w));
			let minY = Math.min(...framing.map((p) => p.y));
			let maxY = Math.max(...framing.map((p) => p.y + p.h));
			let cxRef = (minX + maxX) / 2;
			let halfWRef = Math.max((maxX - minX) / 2, 1e-9);
			let halfHRef = Math.max((maxY - minY) / 2, 1e-9);
			let zRef = Math.min(0.5 / halfWRef, 0.5 / halfHRef);
			let s = r.GLOBAL_BANK_ZOOM[i];
			assert.ok(
				Math.abs(s.z - zRef) < 1e-6,
				`Tiefe ${depth}, Checkpoint ${i}: z weicht zu stark ab (${s.z} vs ${zRef})`,
			);
			assert.ok(
				Math.abs(s.cx - cxRef) < 1e-6,
				`Tiefe ${depth}, Checkpoint ${i}: cx weicht zu stark ab (${s.cx} vs ${cxRef})`,
			);
		}
	}
});

test('isolationScore / Simulationskern unverändert: x/y bleiben konsistent mit localOffset', () => {
	// Teil B fasst bank-core.js nur additiv an (neue Felder) - x/y/w/h
	// und damit die Hot-Path-Simulation dürfen sich nicht ändern.
	const r = compileSystem(BASE_CONFIG);
	for (let p of r.bank_pieces) {
		let parent = p.parent_id === null ? null : r.bank_pieces.find((q) => q.id === p.parent_id);
		if (parent) {
			assert.ok(Math.abs(p.x - (parent.x + p.localOffsetX)) < 1e-15);
			assert.ok(Math.abs(p.y - (parent.y + p.localOffsetY)) < 1e-15);
		} else {
			assert.strictEqual(p.localOffsetX, 0);
			assert.strictEqual(p.localOffsetY, 0);
		}
	}
});
