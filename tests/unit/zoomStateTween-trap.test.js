// Persistente Tests für trapStep() aus src/lib/zoomStateTween.js - reine
// Funktion (kein DOM/rAF noetig), daher hier via node:test statt vitest
// (siehe CLAUDE.md "Svelte-Komponenten-Tests"). Die rAF-abhaengige
// Integrations-Seite (initZoomStateTween() + configStore) wird separat in
// src/lib/zoomStateTween.test.js getestet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trapStep } from '../../src/lib/zoomStateTween.js';

test('trapStep(): dt<=0 ist ein No-op', () => {
	let r = trapStep(0.2, 0.5, 1, 1.0, 1.0, 0);
	assert.deepStrictEqual(r, { position: 0.2, velocity: 0.5 });
});

test('trapStep(): naehert sich dem Ziel monoton an, kein Ueberschwingen bei ruhendem Start', () => {
	let position = 0,
		velocity = 0;
	const target = 1,
		maxSpeed = 2,
		maxAccel = 8;
	let prev = position;
	for (let i = 0; i < 300; i++) {
		({ position, velocity } = trapStep(position, velocity, target, maxSpeed, maxAccel, 1 / 60));
		assert.ok(position >= prev - 1e-9, `Wert sollte nicht zurueckfallen (Schritt ${i})`);
		assert.ok(position <= target + 1e-9, `Wert sollte Ziel nicht ueberschwingen (Schritt ${i})`);
		prev = position;
	}
	assert.strictEqual(
		position,
		target,
		'sollte das Ziel EXAKT erreichen (kein asymptotisches Ausklingen)',
	);
	assert.strictEqual(velocity, 0, 'sollte mit Geschwindigkeit exakt 0 ankommen');
});

test('trapStep(): kommt in endlicher Zeit EXAKT am Ziel an und bleibt danach dort stehen', () => {
	let position = 0,
		velocity = 0;
	const target = 1,
		maxSpeed = 2,
		maxAccel = 8;
	let arrivedAtStep = -1;
	for (let i = 0; i < 300; i++) {
		({ position, velocity } = trapStep(position, velocity, target, maxSpeed, maxAccel, 1 / 60));
		if (arrivedAtStep === -1 && position === target && velocity === 0) arrivedAtStep = i;
	}
	assert.ok(
		arrivedAtStep >= 0 && arrivedAtStep < 299,
		'sollte deutlich vor Testende exakt ankommen',
	);
	// Weitere Schritte am (bereits erreichten) Ziel sind ein echter No-op.
	let after = trapStep(position, velocity, target, maxSpeed, maxAccel, 1 / 60);
	assert.deepStrictEqual(after, { position: target, velocity: 0 });
});

test('trapStep(): respektiert maxSpeed (Geschwindigkeitsdeckel)', () => {
	let position = 0,
		velocity = 0;
	const maxSpeed = 0.5,
		maxAccel = 5;
	let maxObservedSpeed = 0;
	for (let i = 0; i < 600; i++) {
		({ position, velocity } = trapStep(position, velocity, 1, maxSpeed, maxAccel, 1 / 60));
		maxObservedSpeed = Math.max(maxObservedSpeed, Math.abs(velocity));
	}
	assert.ok(maxObservedSpeed <= maxSpeed + 1e-9, `maxObservedSpeed=${maxObservedSpeed}`);
});

test('trapStep(): Retargeting mitten in der Bewegung bleibt geschwindigkeitsstetig (Fix gegen "Blitze")', () => {
	let position = 0,
		velocity = 0;
	const maxSpeed = 2,
		maxAccel = 8;
	// Bewegung Richtung 1 anstossen, bis eine spuerbare Geschwindigkeit da ist.
	for (let i = 0; i < 10; i++) {
		({ position, velocity } = trapStep(position, velocity, 1, maxSpeed, maxAccel, 1 / 60));
	}
	assert.ok(velocity > 0.1, 'sollte nach 10 Schritten eine spuerbare Geschwindigkeit haben');
	let velocityBeforeRetarget = velocity;

	// Retargeting auf ein NEUES Ziel (0) - die Geschwindigkeit darf sich in
	// einem einzelnen kleinen Zeitschritt nur um maxAccel*dt aendern, NIE
	// abrupt springen (kein Reset auf 0, keine Verdopplung).
	let stepAfterRetarget = trapStep(position, velocity, 0, maxSpeed, maxAccel, 1 / 60);
	assert.ok(
		Math.abs(stepAfterRetarget.velocity - velocityBeforeRetarget) <= maxAccel * (1 / 60) + 1e-9,
		`Geschwindigkeit sollte sich nur um maxAccel*dt aendern: vorher=${velocityBeforeRetarget}, nachher=${stepAfterRetarget.velocity}`,
	);
});

test('trapStep(): nach Retargeting mitten in der Bewegung dennoch exakte Ankunft am NEUEN Ziel', () => {
	let position = 0,
		velocity = 0;
	const maxSpeed = 2,
		maxAccel = 8,
		dt = 1 / 60;
	// Richtung 1 anfahren...
	for (let i = 0; i < 15; i++) {
		({ position, velocity } = trapStep(position, velocity, 1, maxSpeed, maxAccel, dt));
	}
	assert.ok(velocity > 0, 'Bewegung ist im Gange');
	// ...dann mitten in der Bewegung auf 0 umschalten (Richtungswechsel).
	for (let i = 0; i < 300; i++) {
		({ position, velocity } = trapStep(position, velocity, 0, maxSpeed, maxAccel, dt));
	}
	assert.strictEqual(position, 0, 'sollte trotz Richtungswechsel exakt am neuen Ziel ankommen');
	assert.strictEqual(velocity, 0);
});

test('trapStep(): kurze Distanz bildet automatisch ein Dreiecksprofil (erreicht maxSpeed nie, keine Sonderbehandlung noetig)', () => {
	let position = 0,
		velocity = 0;
	const maxSpeed = 10, // absichtlich hoch angesetzt - darf bei dieser kurzen Distanz nie erreicht werden
		maxAccel = 1,
		dt = 1 / 240;
	let maxObservedSpeed = 0;
	for (let i = 0; i < 2000; i++) {
		({ position, velocity } = trapStep(position, velocity, 0.05, maxSpeed, maxAccel, dt));
		maxObservedSpeed = Math.max(maxObservedSpeed, Math.abs(velocity));
	}
	assert.ok(position === 0.05 && velocity === 0, 'sollte trotzdem exakt ankommen');
	assert.ok(
		maxObservedSpeed < maxSpeed * 0.9,
		`sollte maxSpeed nie annaehernd erreichen, war aber ${maxObservedSpeed}`,
	);
});
