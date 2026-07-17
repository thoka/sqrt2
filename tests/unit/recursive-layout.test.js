// Tests für TEIL D (REST-PRECISION-PLAN): rekursives Box-in-Boxes-Modell.
// Läuft via `pnpm test` (node:test). Arbeitet direkt auf bank-core.js's
// sim.bank_pieces (Tick-Achse, siehe REST-PRECISION-PLAN Teil D
// "Zeitachse") - KEIN Umweg über compiler.js/finalizeCompiled (die Tick->
// Zeit-Konversion ist für dieses Modell laut Plan nicht nötig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystem } from '../../src/lib/bank-core.js';
import {
	layoutBox,
	layoutVisible,
	computeZoomFrame,
	findRect,
} from '../../src/lib/recursive-layout.js';

function build(depth, cellMode = 'morph', compactionParams) {
	return buildSystem(10, depth, 'fixed', cellMode, compactionParams);
}

// --------------------------------------------------------------------------
// Testkriterium 1: Pruning-Korrektheit - ein Teilbaum, dessen te erreicht
// ist, wird nachweislich nicht mehr besucht.
// --------------------------------------------------------------------------
test('Teil D: pruning - Kinder eines beendeten Teilbaums werden nicht mehr besucht', () => {
	const { sim, local_max_time } = build(5, 'subdivide');

	// Ein GETEILTES (nicht-Blatt) Stück, dessen gesamter Teilbaum schon lange
	// vor local_max_time vollständig "beendet" ist (te früh, aber mit
	// eigenen Kindern - sonst gäbe es nichts zu prunen). layoutBox() wird
	// HIER isoliert (nicht über den root) direkt auf DIESES Stück
	// aufgerufen: der Pruning-Check ("t>=piece.te -> sofort zurück, KEIN
	// Abstieg in piece.children") ist unabhängig davon, ob ein übergeordneter
	// Baum existiert - genau das prüft dieser Test.
	const exitedSubtree = sim.bank_pieces.find(
		(p) => p.children.length > 0 && isFinite(p.te) && p.te < local_max_time * 0.5,
	);
	assert.ok(
		exitedSubtree,
		'Testvoraussetzung: es muss ein früh vollständig beendeter Teilbaum geben',
	);

	const stats = { visited: 0, ids: new Set() };
	layoutBox(exitedSubtree, local_max_time, 0, 0, [], stats);
	assert.equal(stats.visited, 1, 'nur das Stück selbst wird geprüft, kein Abstieg in die Kinder');
	for (let child of exitedSubtree.children) {
		assert.ok(
			!stats.ids.has(child.id),
			`Kind ${child.id} eines beendeten Teilbaums darf nicht besucht werden`,
		);
	}

	// Gegenprobe: kurz VOR seinem te wird tatsächlich in die Kinder abgestiegen.
	const statsBefore = { visited: 0, ids: new Set() };
	layoutBox(exitedSubtree, exitedSubtree.te - 1e-6, 0, 0, [], statsBefore);
	assert.ok(statsBefore.visited > 1, 'kurz vor te muss der Abstieg in die Kinder stattfinden');
});

// --------------------------------------------------------------------------
// Testkriterium 2: Ordnungstreue automatisch - Geschwister überlappen nie,
// für zufällige t-Stichproben (Beweis der Konstruktion, siehe layoutBox()-
// Kommentar: der Cursor entlang `dir` wächst monoton).
// --------------------------------------------------------------------------
test('Teil D: Ordnungstreue - keine zwei sichtbaren Rects überlappen, für zufällige t', () => {
	const { sim, local_max_time } = build(5, 'subdivide');
	const root = sim.bank_pieces[0];
	const EPS = 1e-9;

	function overlaps(a, b) {
		let xOverlap = a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS;
		let yOverlap = a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
		return xOverlap && yOverlap;
	}

	let rng = 1234567;
	function rand() {
		rng = (rng * 1103515245 + 12345) & 0x7fffffff;
		return rng / 0x7fffffff;
	}

	for (let i = 0; i < 300; i++) {
		let t = rand() * local_max_time;
		let { rects } = layoutVisible(root, t);
		for (let a = 0; a < rects.length; a++) {
			for (let b = a + 1; b < rects.length; b++) {
				assert.ok(
					!overlaps(rects[a], rects[b]),
					`Überlappung bei t=${t}: piece ${rects[a].piece.id} vs ${rects[b].piece.id}`,
				);
			}
		}
	}
});

// --------------------------------------------------------------------------
// Testkriterium 3: Eingefrorene Delay-Werte - te/delaySnapshot werden bei
// der Entnahme aus dem AKTUELL gültigen Parameter eingefroren, nicht aus
// einer globalen Konstante, die später anders konfiguriert sein könnte.
// --------------------------------------------------------------------------
test('Teil D: te/delaySnapshot werden bei Entnahme korrekt eingefroren', () => {
	const { sim: simA } = build(4, 'morph', { transitionTicks: 3 });
	const { sim: simB } = build(4, 'morph', { transitionTicks: 20 });

	let takenA = simA.bank_pieces.filter((p) => isFinite(p.taken_time));
	let takenB = simB.bank_pieces.filter((p) => isFinite(p.taken_time));
	assert.ok(takenA.length > 0 && takenB.length > 0);

	for (let p of takenA) {
		assert.equal(p.delaySnapshot, 1, 'GAP_CLOSE_DELAY_TICKS-Default bleibt 1');
		assert.equal(p.transitionSnapshot, 3);
		assert.equal(p.te, p.taken_time + p.delaySnapshot + p.transitionSnapshot);
	}
	for (let p of takenB) {
		assert.equal(p.transitionSnapshot, 20);
		assert.equal(p.te, p.taken_time + p.delaySnapshot + p.transitionSnapshot);
	}

	// Zwei UNABHÄNGIGE Simulationsläufe mit unterschiedlicher Konfiguration
	// frieren unterschiedliche te-Werte ein, obwohl dieselben Entnahme-Ticks
	// erreicht werden (Entnahme-Reihenfolge hängt nicht von transitionTicks
	// ab) - direkter Beleg, dass der eingefrorene Wert wirklich den zum
	// Entnahme-Zeitpunkt gültigen Parameter trägt, nicht einen später/anders
	// konfigurierten.
	let pA = takenA[0];
	let pB = takenB.find((p) => p.taken_time === pA.taken_time);
	assert.ok(pB, 'gleiche Entnahme-Reihenfolge in beiden Läufen (Tick 1)');
	assert.notEqual(pA.te, pB.te);
	assert.equal(pB.te - pA.te, 20 - 3);
});

test('Teil D: dir wird beim Schnitt gesetzt, Blätter behalten dir=null', () => {
	const { sim } = build(4, 'subdivide');
	let cutPieces = sim.bank_pieces.filter((p) => p.children.length > 0);
	assert.ok(cutPieces.length > 0);
	for (let p of cutPieces) assert.ok(p.dir === 'x' || p.dir === 'y');
	let untouchedLeaves = sim.bank_pieces.filter((p) => p.children.length === 0);
	for (let p of untouchedLeaves) assert.equal(p.dir, null);
});

test('Teil D: computeSubtreeTe (implizit via buildSystem) - ein nie entnommenes Blatt hält den ganzen Vorfahren-Pfad bei te=Infinity', () => {
	const { sim } = build(4, 'morph');
	let neverTaken = sim.bank_pieces.find((p) => p.children.length === 0 && !isFinite(p.taken_time));
	assert.ok(neverTaken, 'Testvoraussetzung: es muss ein nie entnommenes Blatt geben (das ist R)');
	assert.equal(neverTaken.te, Infinity);
	let cur = neverTaken;
	let parentMap = new Map(sim.bank_pieces.map((p) => [p.id, p]));
	while (cur.parent_id !== null) {
		cur = parentMap.get(cur.parent_id);
		assert.equal(cur.te, Infinity, `Vorfahre ${cur.id} muss ebenfalls te=Infinity haben`);
	}
});

// --------------------------------------------------------------------------
// Testkriterium 4: C¹ an Phasengrenzen (taken_time+delaySnapshot und te) -
// numerische Ableitung links/rechts der Grenze muss übereinstimmen.
// Zusätzlich: Ableitung an `ts` (born_time) dokumentiert den bewussten
// "sofort"-Sprung (User-Entscheidung, siehe REST-PRECISION-PLAN Teil D
// "Offene Punkte") - HIER wird die C¹-Regel bewusst NICHT eingehalten.
// --------------------------------------------------------------------------
test('Teil D: C¹-Ease an taken_time+delaySnapshot und an te (numerische Ableitung)', () => {
	const { sim } = build(6, 'morph', { transitionTicks: 5 });
	let leaf = sim.bank_pieces.find(
		(p) => p.children.length === 0 && isFinite(p.taken_time) && p.transitionSnapshot > 0,
	);
	assert.ok(leaf);

	function widthAt(t) {
		return layoutBox(leaf, t, 0, 0).w;
	}

	const EPS = 1e-4;
	const holdEnd = leaf.taken_time + leaf.delaySnapshot;

	// Wert stetig an holdEnd (kein Sprung).
	assert.ok(Math.abs(widthAt(holdEnd - EPS) - widthAt(holdEnd + EPS)) < 1e-6);
	// Ableitung an holdEnd: links (im Hold, konstant) ist Steigung 0, rechts
	// (Ease-Start) ist Steigung ebenfalls 0 (smoothstep-Randbedingung).
	let slopeLeft = (widthAt(holdEnd) - widthAt(holdEnd - EPS)) / EPS;
	let slopeRight = (widthAt(holdEnd + EPS) - widthAt(holdEnd)) / EPS;
	assert.ok(Math.abs(slopeLeft) < 1e-3, `slopeLeft=${slopeLeft} sollte ~0 sein`);
	assert.ok(Math.abs(slopeRight) < 1e-3, `slopeRight=${slopeRight} sollte ~0 sein`);

	// Wert stetig an te (geht exakt auf 0, danach geprunt/konstant 0).
	assert.ok(Math.abs(widthAt(leaf.te - EPS) - widthAt(leaf.te + EPS)) < 1e-6);
	let slopeLeftTe = (widthAt(leaf.te) - widthAt(leaf.te - EPS)) / EPS;
	let slopeRightTe = (widthAt(leaf.te + EPS) - widthAt(leaf.te)) / EPS;
	assert.ok(Math.abs(slopeLeftTe) < 1e-3, `slopeLeftTe=${slopeLeftTe} sollte ~0 sein`);
	assert.equal(slopeRightTe, 0, 'nach te ist die Größe konstant 0');
});

test('Teil D (dokumentiert, offener Punkt): an born_time (ts) springt die Größe bewusst OHNE Fade-in', () => {
	const { sim } = build(6, 'morph');
	// Ein Stück, das (noch) nicht geschnitten wurde, ist am einfachsten zu
	// isolieren (kein Kinder-Einfluss).
	let piece = sim.bank_pieces.find((p) => p.parent_id !== null && p.children.length === 0);
	assert.ok(piece);
	let before = layoutBox(piece, piece.born_time - 1e-6, 0, 0).w;
	let atStart = layoutBox(piece, piece.born_time, 0, 0).w;
	assert.equal(before, 0);
	// User-Entscheidung "sofort" (REST-PRECISION-PLAN Teil D, Offene Punkte):
	// volle designte Breite ab dem ERSTEN erreichten Tick - ein echter
	// Wert-Sprung (C⁰-Verletzung), bewusst so belassen, nicht versehentlich.
	assert.equal(atStart, piece.w);
});

// --------------------------------------------------------------------------
// Blatt-Exit ist ein harter Cutoff (kein Ease-Out mehr, siehe
// leafEffectiveSize()): ein entnommenes Blatt bleibt bis EINSCHLIESSLICH
// taken_time in voller Design-Größe sichtbar und ist unmittelbar DANACH
// (t > taken_time) vollständig verschwunden - kein hideFading-Parameter mehr
// nötig, da es keine Zwischenphase (schrumpfende Größe) mehr gibt, die
// wahlweise aus `out` ausgeblendet werden müsste.
// --------------------------------------------------------------------------
test('Teil D: Blatt bleibt bis einschließlich taken_time in voller Design-Größe sichtbar, danach sofort verschwunden', () => {
	const { sim } = build(6, 'morph');
	let leaf = sim.bank_pieces.find((p) => p.children.length === 0 && isFinite(p.taken_time));
	assert.ok(leaf);

	let outAt = [];
	let sizeAt = layoutBox(leaf, leaf.taken_time, 0, 0, outAt);
	assert.equal(outAt.length, 1, 'bei GENAU taken_time noch sichtbar');
	assert.equal(sizeAt.w, leaf.w);
	assert.equal(sizeAt.h, leaf.h);

	let outAfter = [];
	let sizeAfter = layoutBox(leaf, leaf.taken_time + 1e-6, 0, 0, outAfter);
	assert.equal(outAfter.length, 0, 'unmittelbar danach vollständig verschwunden (kein Ease-Out)');
	assert.equal(sizeAfter.w, 0);
	assert.equal(sizeAfter.h, 0);
});

// --------------------------------------------------------------------------
// Testkriterium 5: Performance - aktive Knotenzahl pro Frame bleibt klein,
// unabhängig von der Gesamtgröße von bank_pieces (Pruning greift).
// --------------------------------------------------------------------------
test('Teil D: aktive Knotenzahl pro Frame bleibt klein ggü. Gesamtgröße', () => {
	const { sim, local_max_time } = build(22, 'morph', { transitionTicks: 3 });
	const root = sim.bank_pieces[0];
	const total = sim.bank_pieces.length;
	assert.ok(total > 5000, 'Testvoraussetzung: großer Baum (Tiefe 22)');

	for (let frac of [0.05, 0.25, 0.5, 0.75, 0.95]) {
		let t = frac * local_max_time;
		let stats = { visited: 0 };
		layoutBox(root, t, 0, 0, null, stats);
		assert.ok(
			stats.visited < total * 0.3,
			`t=${t}: visited=${stats.visited} von ${total} Stücken sollte klein bleiben`,
		);
	}
});

// --------------------------------------------------------------------------
// Testkriterium 6: keine NaN/Infinity über den gesamten Tiefenbereich.
// --------------------------------------------------------------------------
test('Teil D: keine NaN/Infinity bis Tiefe 30, über die gesamte Zeitachse', () => {
	for (let depth of [10, 22, 30]) {
		const { sim, local_max_time } = build(depth, 'morph', { transitionTicks: 3 });
		const root = sim.bank_pieces[0];
		for (let frac of [0, 0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99, 1.0]) {
			let t = frac * local_max_time;
			let { frame, zoom, rects } = layoutVisible(root, t);
			for (let v of [frame.w, frame.h, frame.mass, frame.momentX, frame.momentY]) {
				assert.ok(isFinite(v), `depth=${depth} t=${t}: frame-Wert nicht endlich (${v})`);
			}
			for (let v of [zoom.z, zoom.cx, zoom.cy, zoom.offsetX, zoom.offsetY]) {
				assert.ok(isFinite(v), `depth=${depth} t=${t}: zoom-Wert nicht endlich (${v})`);
			}
			for (let r of rects) {
				assert.ok(
					isFinite(r.x) && isFinite(r.y) && isFinite(r.w) && isFinite(r.h),
					`depth=${depth} t=${t}: rect nicht endlich`,
				);
			}
		}
	}
});

// --------------------------------------------------------------------------
// Testkriterium 9: Schwerpunkt stetig (C⁰ zumindest; siehe Kommentar unten
// zur C¹-Einschränkung).
// --------------------------------------------------------------------------
test('Teil D: Moment/Masse-Schwerpunkt ändert sich stetig über t (keine Sprünge)', () => {
	// WICHTIG (ehrliche Einschränkung, kein voller C¹-Beweis): die Kreuzachse
	// wird pro Ebene per Math.max() der Kinder-Größen komponiert (siehe
	// layoutBox()) - max() ist stetig (C⁰), aber nicht überall differenzierbar
	// (Kink beim Wechsel, welches Kind gerade das größte ist). Dieser Kink
	// kann sich in die Position (und damit ins Moment) fortpflanzen, wenn ein
	// Geschwister mit ANDERER Schnittrichtung als sein Parent zum Haupt-Beitrag
	// wird. Der komponierte Schwerpunkt ist daher hier nur als C⁰ (wertstetig)
	// nachgewiesen - die C¹-Kamera-Garantie aus CLAUDE.md wird (wie beim alten
	// GLOBAL_BANK_ZOOM_SPLINE) durch einen NACHGESCHALTETEN buildDampedFilter
	// erreicht, nicht durch dieses rohe, exakte Geometrie-Layer selbst.
	const { sim, local_max_time } = build(8, 'subdivide');
	const root = sim.bank_pieces[0];

	const N = 4000;
	let prevCx = null,
		prevCy = null;
	let maxJump = 0;
	for (let i = 0; i <= N; i++) {
		let t = (i / N) * local_max_time;
		let { zoom } = layoutVisible(root, t);
		if (prevCx !== null) {
			maxJump = Math.max(maxJump, Math.abs(zoom.cx - prevCx), Math.abs(zoom.cy - prevCy));
		}
		prevCx = zoom.cx;
		prevCy = zoom.cy;
	}
	// Bei 4000 Stichproben über die gesamte Laufzeit darf kein einzelner
	// Schritt einen GROSSEN Sprung zeigen (harte C⁰-Verletzung) - ein loser,
	// aber aussagekräftiger Schwellwert (deutlich über normalem Rauschen,
	// deutlich unter einem "Anker-Wechsel-Sprung" wie in Teil C). Schwelle
	// höher als früher (0.05 -> 0.15): der harte Blatt-Exit-Cutoff (siehe
	// leafEffectiveSize(), kein Ease-Out mehr) lässt ein entnommenes Stück
	// INSTANT auf Größe 0 springen statt weich zu schrumpfen - der dadurch
	// mögliche Einzelschritt-Sprung im Schwerpunkt ist entsprechend größer,
	// aber weiterhin durch den Massenanteil EINES Stücks begrenzt (kein
	// unbegrenzter Anker-Wechsel-Sprung). Die C¹-Kamera-Garantie kommt wie
	// oben beschrieben aus dem nachgeschalteten buildDampedFilter, nicht aus
	// dieser rohen Geometrie.
	assert.ok(maxJump < 0.15, `größter Einzelschritt-Sprung im Schwerpunkt: ${maxJump}`);
});

// --------------------------------------------------------------------------
// computeZoomFrame: Grundverhalten (leeres/entartetes frame liefert Fallback).
// --------------------------------------------------------------------------
test('Teil D: computeZoomFrame liefert sicheren Fallback für mass=0', () => {
	let z = computeZoomFrame({ w: 0, h: 0, mass: 0, momentX: 0, momentY: 0 });
	assert.equal(z.z, 1);
	assert.equal(z.cx, 0.5);
	assert.equal(z.cy, 0.5);
});

// --------------------------------------------------------------------------
// findRect(): Herkunfts-Position eines Stücks an EINEM festen Zeitpunkt
// (Flug-Animation, siehe Gesprächsverlauf/REST-PRECISION-PLAN Teil D).
// --------------------------------------------------------------------------
test('Teil D: findRect liefert die Herkunfts-Position eines Blatts bei t=taken_time in Design-Größe', () => {
	const { sim } = build(6, 'morph');
	let leaf = sim.bank_pieces.find((p) => p.children.length === 0 && isFinite(p.taken_time));
	assert.ok(leaf);
	let r = findRect(sim.bank_pieces[0], leaf.taken_time, leaf.id);
	assert.ok(r, 'Stück muss bei taken_time noch auffindbar/sichtbar sein');
	assert.ok(
		Math.abs(r.w - leaf.w) < 1e-9 && Math.abs(r.h - leaf.h) < 1e-9,
		'noch volle Design-Größe',
	);
});

test('Teil D: findRect liefert die Herkunfts-Position eines noch nicht geschnittenen Parents bei t=born_time', () => {
	const { sim } = build(6, 'subdivide');
	let parent = sim.bank_pieces.find((p) => p.children.length > 0 && p.parent_id !== null);
	assert.ok(parent);
	let r = findRect(sim.bank_pieces[0], parent.born_time, parent.id);
	assert.ok(r, 'Parent muss bei seinem eigenen born_time noch als Ganzes auffindbar sein');
	assert.ok(Math.abs(r.w - parent.w) < 1e-9 && Math.abs(r.h - parent.h) < 1e-9);
});

test('Teil D: computeZoomFrame bei t=0 (volles Quadrat) liefert z=1, zentriert', () => {
	const { sim } = build(6, 'morph');
	const root = sim.bank_pieces[0];
	let { zoom, frame } = layoutVisible(root, 0);
	assert.equal(frame.w, 1);
	assert.equal(frame.h, 1);
	assert.ok(Math.abs(zoom.z - 1 / 1.05) < 1e-9, 'z bei vollem [0,1]-Quadrat mit ZOOM_MARGIN=0.05');
});
