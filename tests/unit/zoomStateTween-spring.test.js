// Persistente Tests für springStep() aus src/lib/zoomStateTween.js - reine
// Funktion (kein DOM/rAF noetig), daher hier via node:test statt vitest
// (siehe CLAUDE.md "Svelte-Komponenten-Tests"). Die rAF-abhaengige
// Integrations-Seite (initZoomStateTween() + configStore) wird separat in
// src/lib/zoomStateTween.test.js getestet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { springStep } from '../../src/lib/zoomStateTween.js';

test('springStep(): dt<=0 ist ein No-op', () => {
	let r = springStep(0.2, 0.5, 1, 1.0, 1.0, 0);
	assert.deepStrictEqual(r, { value: 0.2, velocity: 0.5 });
});

test('springStep(): naehert sich dem Ziel monoton an (kein Ueberschwingen bei ruhendem Start)', () => {
	let value = 0,
		velocity = 0;
	const target = 1,
		smoothTime = 0.5,
		maxSpeed = 10;
	let prev = value;
	for (let i = 0; i < 300; i++) {
		({ value, velocity } = springStep(value, velocity, target, smoothTime, maxSpeed, 1 / 60));
		assert.ok(value >= prev - 1e-9, `Wert sollte nicht zurueckfallen (Schritt ${i})`);
		assert.ok(value <= target + 1e-6, `Wert sollte Ziel nicht ueberschwingen (Schritt ${i})`);
		prev = value;
	}
	assert.ok(Math.abs(value - target) < 1e-3, 'sollte nach 5s nahe am Ziel sein');
});

test('springStep(): Retargeting mitten in der Bewegung setzt die Geschwindigkeit NICHT zurueck (Fix gegen "Blitze")', () => {
	let value = 0,
		velocity = 0;
	const smoothTime = 0.5,
		maxSpeed = 10;
	// Bewegung Richtung 1 anstossen, bis eine spuerbare Geschwindigkeit da ist.
	for (let i = 0; i < 10; i++) {
		({ value, velocity } = springStep(value, velocity, 1, smoothTime, maxSpeed, 1 / 60));
	}
	assert.ok(velocity > 0.1, 'sollte nach 10 Schritten eine spuerbare Geschwindigkeit haben');
	let velocityBeforeRetarget = velocity;

	// Retargeting auf ein NEUES Ziel (0) - im Gegensatz zu einem Ease-Ramp-
	// Neustart (der Geschwindigkeit auf 0 zwingen wuerde) darf sich die
	// Geschwindigkeit hier nur GLATT aendern (durch die Beschleunigung
	// Richtung des neuen Ziels), nicht abrupt auf 0 springen.
	let stepAfterRetarget = springStep(value, velocity, 0, smoothTime, maxSpeed, 1 / 60);
	// Bei einem einzelnen kleinen Zeitschritt (1/60s) kann sich die
	// Geschwindigkeit nicht schlagartig umkehren - sie bleibt nahe ihrem
	// Wert vor dem Retargeting (glatte Beschleunigung, kein Sprung auf 0).
	assert.ok(
		Math.abs(stepAfterRetarget.velocity - velocityBeforeRetarget) < velocityBeforeRetarget * 0.5,
		`Geschwindigkeit sollte sich nur graduell aendern: vorher=${velocityBeforeRetarget}, nachher=${stepAfterRetarget.velocity}`,
	);
});

test('springStep(): respektiert maxSpeed (Geschwindigkeitsdeckel)', () => {
	let value = 0,
		velocity = 0;
	const smoothTime = 0.1,
		maxSpeed = 0.5; // max 0.5 Einheiten/Sekunde
	let maxObservedSpeed = 0;
	for (let i = 0; i < 600; i++) {
		({ value, velocity } = springStep(value, velocity, 1, smoothTime, maxSpeed, 1 / 60));
		maxObservedSpeed = Math.max(maxObservedSpeed, Math.abs(velocity));
	}
	// Etwas Toleranz fuer die kritisch gedaempfte Anfahrt/Ueberschwing-
	// Sicherung, aber deutlich unterhalb einer ungedeckelten Geschwindigkeit.
	assert.ok(maxObservedSpeed < maxSpeed * 1.5, `maxObservedSpeed=${maxObservedSpeed}`);
});

test('springStep(): kommt aus der Ruhe am Ziel an (isSettled-Kriterium erfuellbar)', () => {
	let value = 0,
		velocity = 0;
	for (let i = 0; i < 600; i++) {
		({ value, velocity } = springStep(value, velocity, 1, 0.3, 5, 1 / 60));
	}
	assert.ok(Math.abs(value - 1) < 1e-3);
	assert.ok(Math.abs(velocity) < 1e-3);
});
