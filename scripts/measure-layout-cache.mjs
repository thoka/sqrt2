// Mess-Skript: potenzielle Ersparnis durch Caching der Rekursions-Aggregate
// in layoutBox() (src/lib/recursive-layout.js). Reproduziert die Zahlen in
// docs/COMPILER-LAYERING-PLAN.md Abschnitt E.
//
// Hintergrund: layoutBox() rekursiert pro Frame den gesamten aktiven Baum ab
// der Wurzel neu. Der "fuer die Fortsetzung der Rekursion notwendige Wert"
// eines geschnittenen Knotens ist sein Aggregat {w,h,mass,momentX,momentY}
// (+ Kind-Positionen). Dieses Aggregat ist konstant, solange KEIN Blatt in
// seinem Teilbaum seinen taken_time-Sprung (voll -> 0, leafEffectiveSize ist
// binaer) macht.
//
// Pro Frame gemessen:
//   visited = Knoten, die layoutBox() tatsaechlich besucht (Ist-Kosten).
//   needed  = Knoten, die bei perfektem Caching neu berechnet werden
//             muessten = Vereinigung aller Wurzel->Blatt-Pfade zu Blaettern,
//             deren voll/0-Zustand sich ggue. dem VORIGEN Frame geaendert hat.
//   speedup = visited / needed.
//
// Aufruf: node scripts/measure-layout-cache.mjs

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { buildSystem } = await import(join(__dirname, '../src/lib/bank-core.js'));
const { layoutBox } = await import(join(__dirname, '../src/lib/recursive-layout.js'));

const BASE = 10;

// voll/0-Zustand eines Blattes zum Zeitpunkt t (binaer, siehe
// leafEffectiveSize: voll solange t <= taken_time, danach 0). born_time/te-
// Grenzen zaehlen ebenfalls als Wechsel (Erscheinen/Pruning).
function leafVisible(p, t) {
	if (t < p.born_time || t > p.te) return false;
	if (!isFinite(p.taken_time)) return true;
	return t <= p.taken_time;
}

// In layoutBox() ist ein Knoten "Blatt", wenn er keine Kinder hat ODER
// t < cut_time (noch nicht geschnitten).
function isLeafAt(p, t) {
	return p.children.length === 0 || t < p.cut_time;
}

function collectVisibleLeaves(root, t) {
	const state = new Map(); // id -> bool visible
	function walk(p) {
		if (t < p.born_time || t > p.te) return;
		if (isLeafAt(p, t)) {
			state.set(p.id, leafVisible(p, t));
			return;
		}
		for (const c of p.children) walk(c);
	}
	walk(root);
	return state;
}

function pathToRootCount(changedIds, byId) {
	const seen = new Set();
	for (const id of changedIds) {
		let cur = byId.get(id);
		while (cur && !seen.has(cur.id)) {
			seen.add(cur.id);
			cur = cur.parent_id == null ? null : byId.get(cur.parent_id);
		}
	}
	return seen.size;
}

function measure(depth, framesPerTickApprox = 4) {
	const { sim } = buildSystem(BASE, depth, 'fixed', 'subdivide');
	const root = sim.bank_pieces[0];
	const byId = new Map(sim.bank_pieces.map((p) => [p.id, p]));

	let maxT = 0;
	for (const p of sim.bank_pieces) if (isFinite(p.te) && p.te > maxT) maxT = p.te;
	const takenTimes = new Set();
	for (const p of sim.bank_pieces) if (isFinite(p.taken_time)) takenTimes.add(p.taken_time);
	const nTicks = takenTimes.size || 1;
	const nFrames = Math.max(2, nTicks * framesPerTickApprox);
	const dt = maxT / nFrames;

	let sumVisited = 0;
	let sumNeeded = 0;
	let maxVisited = 0;
	let prevState = null;
	let framesCounted = 0;

	for (let f = 0; f <= nFrames; f++) {
		const t = f * dt;
		const stats = { visited: 0 };
		layoutBox(root, t, 0, 0, null, stats);
		const visited = stats.visited;

		const state = collectVisibleLeaves(root, t);
		let needed;
		if (prevState === null) {
			needed = visited; // Cold-Start: alles neu
		} else {
			const changed = [];
			for (const [id, vis] of state) {
				if (!prevState.has(id) || prevState.get(id) !== vis) changed.push(id);
			}
			for (const [id] of prevState) if (!state.has(id)) changed.push(id);
			needed = changed.length === 0 ? 0 : pathToRootCount(changed, byId);
		}

		sumVisited += visited;
		sumNeeded += needed;
		if (visited > maxVisited) maxVisited = visited;
		framesCounted++;
		prevState = state;
	}

	return {
		depth,
		nodes: sim.bank_pieces.length,
		nTicks,
		nFrames: framesCounted,
		maxVisited,
		avgVisited: Math.round(sumVisited / framesCounted),
		avgNeeded: Math.round(sumNeeded / framesCounted),
		speedup: (sumVisited / Math.max(1, sumNeeded)).toFixed(1),
	};
}

console.log('depth | nodes | ticks | frames | maxVisited | avgVisited | avgNeeded | speedup');
console.log('------|-------|-------|--------|------------|------------|-----------|--------');
for (const d of [6, 8, 10, 12, 14, 16, 18, 20]) {
	const r = measure(d);
	console.log(
		`${String(r.depth).padStart(5)} | ${String(r.nodes).padStart(5)} | ${String(r.nTicks).padStart(5)} | ${String(r.nFrames).padStart(6)} | ${String(r.maxVisited).padStart(10)} | ${String(r.avgVisited).padStart(10)} | ${String(r.avgNeeded).padStart(9)} | ${String(r.speedup).padStart(6)}x`,
	);
}

console.log('\nSensitivitaet framesPerTick (depth=16):');
console.log('fpt | avgVisited | avgNeeded | speedup');
for (const fpt of [1, 2, 4]) {
	const r = measure(16, fpt);
	console.log(
		`${String(fpt).padStart(3)} | ${String(r.avgVisited).padStart(10)} | ${String(r.avgNeeded).padStart(9)} | ${String(r.speedup).padStart(6)}x`,
	);
}
