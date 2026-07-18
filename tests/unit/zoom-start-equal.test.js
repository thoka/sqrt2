// Test für TODO "Skalierung": am Anfang (t=0) füllt das Wurzel-Stück die
// gesamte Bank-Fläche [0,1] aus - der Zoom-Faktor muss exakt 1 sein, damit das
// rechte weiße Rest-Quadrat genau so groß wie das Ziel-Quadrat gezeichnet wird
// (Symptom: "Rand" aus margin=0.05 verkleinerte das Rest-Quadrat auf ~0.95).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeZoomFrame } from '../../src/lib/recursive-layout.js';

test('computeZoomFrame: volle 1x1-Box (t=0) liefert z=1 trotz margin', () => {
	// Einzig sichtbares Stück füllt den ganzen Bank-Raum: w=h=1, Masse=1,
	// Schwerpunkt in der Mitte.
	const frame = { w: 1, h: 1, mass: 1, momentX: 0.5, momentY: 0.5 };
	for (const margin of [0, 0.05, 0.1]) {
		const z = computeZoomFrame(frame, margin).z;
		assert.ok(Math.abs(z - 1) < 1e-12, `margin=${margin}: z sollte 1 sein, war ${z}`);
	}
});

test('computeZoomFrame: kleines, zentriertes Stück erhält zoomierenden margin-Puffer (z>1)', () => {
	// So wie layoutCentered es liefert: das sichtbare Ergebnis ist in die
	// Mitte verschoben (boundX=boundY=0.45), ein kleines 0.1x0.1-Stück
	// liegt zentriert (cx=cy=0.5). z_exact = 0.5/0.05 = 10; mit margin=0.05
	// leicht darunter (10/1.05 ≈ 9.52) aber immer noch > 1 - der Puffer
	// bleibt erhalten.
	const frame = { w: 0.1, h: 0.1, mass: 0.01, momentX: 0.005, momentY: 0.005 };
	const zPlain = computeZoomFrame(frame, 0, 0.45, 0.45).z;
	const zMargin = computeZoomFrame(frame, 0.05, 0.45, 0.45).z;
	assert.ok(Math.abs(zPlain - 10) < 1e-9, `zPlain=${zPlain}`);
	assert.ok(
		zMargin > 1 && zMargin < zPlain,
		`margin-Puffer sollte z auf >1 senken, war ${zMargin}`,
	);
	assert.ok(Math.abs(zMargin - 10 / 1.05) < 1e-9, `zMargin=${zMargin}`);
});
