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

test('Bounding-Box enthält alle sichtbaren Stücke (Sichtbarkeit, Tiefe 22)', () => {
	// Harte Invariante: der vom Compiler gelieferte Bank-Zoom (z, offsetX/Y)
	// skaliert die exakt gefaltete relative Bounding-Box so, dass KEIN
	// sichtbares Stück aus dem [0,1]-Fenster faellt. Das ist die eigentliche
	// Anforderung ("Rest immer sichtbar") - unabhaengig davon, wie lang die
	// Vorfahren-Kette im Einzelfall ist.
	const r = compileSystem({ ...BASE_CONFIG, depth: 22 });
	const parentMap = new Map(r.bank_pieces.map((p) => [p.id, p]));
	const BASE = BASE_CONFIG.base;
	function exactX(p) {
		let path = [];
		for (let c = p; c; c = parentMap.get(c.parent_id)) path.push(c);
		let x = 0;
		for (let e = 0; e < path.length; e++) x += path[e].localOffsetX * Math.pow(BASE, -(e + 1));
		return x;
	}
	function exactY(p) {
		let path = [];
		for (let c = p; c; c = parentMap.get(c.parent_id)) path.push(c);
		let y = 0;
		for (let e = 0; e < path.length; e++) y += path[e].localOffsetY * Math.pow(BASE, -(e + 1));
		return y;
	}
	let outside = 0,
		total = 0;
	for (let i = 0; i < r.GLOBAL_BANK_ZOOM_TIMES.length; i++) {
		const t = r.GLOBAL_BANK_ZOOM_TIMES[i];
		const s = r.GLOBAL_BANK_ZOOM[i];
		if (!isFinite(s.z) || s.z <= 0) continue;
		const vis = r.bank_pieces.filter((p) => t >= p.born_time && t < p.cut_time && t < p.taken_time);
		if (vis.length === 0) continue;
		const kMin = Math.min(...vis.map((p) => p.k));
		const framing = vis.filter(
			(p) =>
				!(
					BASE_CONFIG.bankZoomThresholdPowers > 0 &&
					p.k > kMin + 2 * BASE_CONFIG.bankZoomThresholdPowers
				),
		);
		if (framing.length === 0) continue;
		const anchor = framing[0];
		const ax = exactX(anchor),
			ay = exactY(anchor);
		const m = 1e-6;
		for (const p of framing) {
			const rx = exactX(p) - ax,
				ry = exactY(p) - ay;
			const relW = Math.pow(BASE, anchor.k - p.k);
			const sx0 = rx * s.z + s.offsetX,
				sx1 = (rx + relW) * s.z + s.offsetX;
			const sy0 = ry * s.z + s.offsetY,
				sy1 = (ry + relW) * s.z + s.offsetY;
			if (sx0 < -m || sx1 > 1 + m || sy0 < -m || sy1 > 1 + m) outside++;
			total++;
		}
	}
	assert.strictEqual(outside, 0, `${outside}/${total} Stücke fielen aus dem Fenster`);
});

test('Regressions-Parität: neue robuste Box == exakte relative Box (Normal-Tiefen 3-8)', () => {
	// Die neue, rein relative Box (relativ zum Anker framing[0], gebaut aus
	// ganzzahligen Rasterindizes) muss mit der exakt gefalteten relativen
	// Referenzbox übereinstimmen. Das ist die eigentliche Invariante - nicht
	// die rohe Float64-x-Box (die bei tiefen Tiefen ohnehin präzise ist).
	for (let depth of [3, 5, 8]) {
		const r = compileSystem({ ...BASE_CONFIG, depth });
		const parentMap = new Map(r.bank_pieces.map((p) => [p.id, p]));
		const BASE = BASE_CONFIG.base;
		function exactX(p) {
			let path = [];
			for (let c = p; c; c = parentMap.get(c.parent_id)) path.push(c);
			let x = 0;
			for (let e = 0; e < path.length; e++) x += path[e].localOffsetX * Math.pow(BASE, -(e + 1));
			return x;
		}
		function exactY(p) {
			let path = [];
			for (let c = p; c; c = parentMap.get(c.parent_id)) path.push(c);
			let y = 0;
			for (let e = 0; e < path.length; e++) y += path[e].localOffsetY * Math.pow(BASE, -(e + 1));
			return y;
		}
		let bankZoomThresholdPowers = BASE_CONFIG.bankZoomThresholdPowers;
		for (let i = 0; i < r.GLOBAL_BANK_ZOOM.length; i++) {
			let t = r.GLOBAL_BANK_ZOOM_TIMES[i];
			let visibleNow = r.bank_pieces.filter(
				(p) => t >= p.born_time && t < p.cut_time && t < p.taken_time,
			);
			if (visibleNow.length === 0) continue;
			let kMin = Math.min(...visibleNow.map((p) => p.k));
			let framing = visibleNow.filter(
				(p) => !(bankZoomThresholdPowers > 0 && p.k > kMin + 2 * bankZoomThresholdPowers),
			);
			if (framing.length === 0) continue;
			let anchor = framing[0];
			let ax = exactX(anchor),
				ay = exactY(anchor);
			let mnX = 0,
				mxX = 0,
				mnY = 0,
				mxY = 0;
			for (let p of framing) {
				let rx = exactX(p) - ax,
					ry = exactY(p) - ay;
				let relW = Math.pow(BASE, anchor.k - p.k);
				mnX = Math.min(mnX, rx);
				mxX = Math.max(mxX, rx + relW);
				mnY = Math.min(mnY, ry);
				mxY = Math.max(mxY, ry + relW);
			}
			let cxRef = (mnX + mxX) / 2;
			let halfWRef = Math.max((mxX - mnX) / 2, 1e-9);
			let halfHRef = Math.max((mxY - mnY) / 2, 1e-9);
			let zRef = Math.min(0.5 / halfWRef, 0.5 / halfHRef);
			let s = r.GLOBAL_BANK_ZOOM[i];
			assert.ok(
				Math.abs(s.z - zRef) < 1e-9,
				`Tiefe ${depth}, Checkpoint ${i}: z weicht zu stark ab (${s.z} vs ${zRef})`,
			);
			assert.ok(
				Math.abs(s.cx - cxRef) < 1e-9,
				`Tiefe ${depth}, Checkpoint ${i}: cx weicht zu stark ab (${s.cx} vs ${cxRef})`,
			);
		}
	}
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
