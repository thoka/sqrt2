// Persistente Tests für src/lib/paramTween.js - reines Modul (kein DOM), daher
// hier via node:test statt vitest/jsdom (siehe CLAUDE.md "Svelte-Komponenten-Tests").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { springStep, createSpringTween } from '../../src/lib/paramTween.js';

test('springStep(): dt<=0 ist ein No-op', () => {
	let r = springStep(0.2, 0.5, 1, 0.35, 0);
	assert.deepStrictEqual(r, { value: 0.2, velocity: 0.5 });
});

test('springStep(): smoothTime<=0 springt sofort exakt auf das Ziel (Geschwindigkeit 0)', () => {
	let r = springStep(0.2, 0.5, 1, 0, 0.016);
	assert.deepStrictEqual(r, { value: 1, velocity: 0 });
});

test('springStep(): naehert sich dem Ziel monoton an (kein Ueberschwingen bei ruhendem Start)', () => {
	let value = 0,
		velocity = 0;
	const target = 1,
		smoothTime = 0.35;
	let prev = value;
	for (let i = 0; i < 200; i++) {
		({ value, velocity } = springStep(value, velocity, target, smoothTime, 1 / 60));
		assert.ok(value >= prev - 1e-9, `Wert sollte nicht zurueckfallen (Schritt ${i})`);
		assert.ok(value <= target + 1e-6, `Wert sollte Ziel nicht ueberschwingen (Schritt ${i})`);
		prev = value;
	}
	assert.ok(Math.abs(value - target) < 1e-3, 'sollte nach 200 Schritten (~3.3s) nahe am Ziel sein');
});

test('createSpringTween(): step() naehert sich dem Ziel an, isSettled erst nahe am Ziel true', () => {
	let tween = createSpringTween(0, 0.35);
	tween.setTarget(1);
	assert.strictEqual(tween.isSettled, false);
	for (let i = 0; i < 300; i++) tween.step(1 / 60);
	assert.ok(tween.isSettled, 'sollte nach 5s (viele Zeitkonstanten) angekommen sein');
	assert.ok(Math.abs(tween.value - 1) < 1e-3);
});

test('createSpringTween(): Retargeting mitten in der Bewegung bleibt stetig (kein Sprung im Wert)', () => {
	let tween = createSpringTween(0, 0.35);
	tween.setTarget(1);
	for (let i = 0; i < 10; i++) tween.step(1 / 60); // Bewegung ist im Gange, Geschwindigkeit > 0
	let valueBefore = tween.value;
	tween.setTarget(0); // Nutzer waehlt waehrend der Animation den Ausgangszustand erneut
	let valueAfterRetarget = tween.step(1e-9); // infinitesimal kleiner Schritt: Wert darf sich nicht sprunghaft aendern
	assert.ok(
		Math.abs(valueAfterRetarget - valueBefore) < 1e-6,
		'Retargeting darf keinen Wert-Sprung erzeugen (C0 mindestens)',
	);
});

test('createSpringTween(): syncTo() setzt Wert/Geschwindigkeit ohne Animation', () => {
	let tween = createSpringTween(0, 0.35);
	tween.setTarget(1);
	for (let i = 0; i < 10; i++) tween.step(1 / 60);
	tween.syncTo(0.5);
	assert.strictEqual(tween.value, 0.5);
	// Nach syncTo() ist die Geschwindigkeit 0 - ein einzelner Schritt bewegt
	// sich daher nur um das, was springStep() aus Stillstand heraus liefert.
	let stepped = tween.step(1 / 60);
	let expected = springStep(0.5, 0, 1, 0.35, 1 / 60).value;
	assert.ok(Math.abs(stepped - expected) < 1e-9);
});
