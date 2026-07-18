// Unit-Tests fuer den eigenen Zahl-Renderer (statt MathJax) -
// siehe docs/INTERFACE-TODO.md "Eigener Renderer fuer Zahlendarstellung"
// (Ursache des Flug-Stotterns: pro-Frame MathJax typesetPromise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBaseNumber, buildNumberPanelHTML } from '../../src/lib/numberRenderer.js';

test('splitBaseNumber: trennt Ganzzahl- und Nachkommateil am Punkt', () => {
	assert.deepStrictEqual(splitBaseNumber('1.4142'), { int: '1', frac: '4142' });
	assert.deepStrictEqual(splitBaseNumber('123'), { int: '123', frac: '' });
	assert.deepStrictEqual(splitBaseNumber('0.5A'), { int: '0', frac: '5A' });
});

test('buildNumberPanelHTML: enthaelt l, l2 und R mit Basis-Tag, OHNE MathJax-Markup', () => {
	const html = buildNumberPanelHTML('1.4142', '1.9999', '0.0058', 10, false);
	assert.ok(html.includes('>l<'), 'Label l vorhanden');
	assert.ok(html.includes('>l²<'), 'Label l² vorhanden');
	assert.ok(html.includes('>R<'), 'Label R vorhanden');
	// jede Zahl als eigene Zeile mit int/frac-Spans
	assert.ok(html.includes('np-int'), 'np-int-Span vorhanden');
	assert.ok(html.includes('np-frac'), 'np-frac-Span vorhanden');
	assert.ok(html.includes('<sub>10</sub>'), 'Basis-Tag vorhanden');
	// KEIN MathJax-Rest (keine \\[ \\] oder \\begin{aligned})
	assert.ok(!html.includes('begin{aligned}'), 'kein MathJax-aligned');
	assert.ok(!html.includes('\\['), 'kein MathJax-Delimiter');
});

test('buildNumberPanelHTML: verbose zeigt Wort-Praefixe', () => {
	const html = buildNumberPanelHTML('1.4', '1.9', '0.0', 10, true);
	assert.ok(html.includes('Länge'), 'Praefix Laenge');
	assert.ok(html.includes('Fläche'), 'Praefix Flaeche');
	assert.ok(html.includes('Rest'), 'Praefix Rest');
});

test('buildNumberPanelHTML: Basis > 10 nutzt Buchstaben-Ziffern', () => {
	const html = buildNumberPanelHTML('1.A3', '2.F1', '0.0C', 16, false);
	// int-Span enthaelt "1", frac-Span enthaelt ".A3" (Hex-Ziffern erhalten)
	assert.ok(html.includes('np-int">1<'), 'int-Span mit 1');
	assert.ok(html.includes('np-frac">.A3<'), 'frac-Span mit Hex-Ziffern .A3');
	assert.ok(html.includes('<sub>16</sub>'), 'Basis 16 Tag');
});

test('buildNumberPanelHTML: ohne Nachkommateil (ganzzahlig) bleibt valide', () => {
	const html = buildNumberPanelHTML('2', '4', '0', 10, false);
	assert.ok(html.includes('np-int'), 'int-Span');
	assert.ok(!html.includes('np-frac'), 'keine frac-Span bei ganzzahlig');
});
