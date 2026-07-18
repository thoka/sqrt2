// ============================================================================
// NUMBER-RENDERER.JS - eigene Zahlendarstellung (statt MathJax)
// ============================================================================
// HUD/Flug-Stottern-Ursache war MathJax' pro-Frame `typesetPromise`
// (teuer, blockiert den Main-Thread, siehe INTERFACE-TODO.md
// "Eigener Renderer für Zahlendarstellung"). Diese Bibliothek rendert
// l / l² / R in Basis-B-Notation als schlichtes, monospace-
// ausgerichtetes HTML - KEINE externe Bibliothek, KEIN pro-Frame-Typeset.
//
// Eingabe: bereits formatierte BigInt-String in Basis B (wie bisher aus
// computeLiveL uebernommen: Ganzzahl- und Nachkommateil durch '.'
// getrennt, fuehrende Nullen im Nachkommateil erhalten, haengende
// Nullen bereits abgeschnitten). Ausgabe: HTML, das l/l²/R UNTEREINANDER
// mit LINKSBUENDIGEM Label und dezimalpunkt-ALIGNTER Ziffernspalte
// darstellt.

// Spaltet "12.3" -> { int: "12", frac: "3" }. Ohne Punkt -> frac="".
export function splitBaseNumber(s) {
	let dot = s.indexOf('.');
	if (dot < 0) return { int: s, frac: '' };
	return { int: s.slice(0, dot), frac: s.slice(dot + 1) };
}

// HTML-escapen (die BigInt-Strings enthalten nur [0-9A-Z.], aber
// Verteidigung gegen zukuenftige Label-Einspeisung).
function esc(s) {
	return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

// Eine Zeile (Label + Zahl) als Grid-Zeile. int/frac werden in
// SPANs mit KLASSEN gepackt, damit CSS die Ausrichtung uebernimmt
// (int rechtsbuendig, frac linksbuendig -> Dezimalpunkte aller
// Zeilen stehen exakt untereinander).
function rowHTML(label, valueStr) {
	let { int, frac } = splitBaseNumber(valueStr);
	let fracHTML = frac ? `<span class="np-frac">.${esc(frac)}</span>` : '';
	return `<div class="np-row"><span class="np-label">${esc(label)}</span><span class="np-int">${esc(int)}</span>${fracHTML}</div>`;
}

// Komplettes Panel-HTML fuer l / l² / R.
// `verbose`: true zeigt Wort-Praefixe ("Länge ", "Fläche ", "Rest ").
export function buildNumberPanelHTML(P_str, P2_str, rem_str, BASE, verbose) {
	let lengthLabel = verbose ? 'Länge ' : 'l';
	let areaLabel = verbose ? 'Fläche ' : 'l²';
	let restLabel = verbose ? 'Rest ' : 'R';
	let baseTag = `<sub>${BASE}</sub>`;
	return (
		rowHTML(lengthLabel, P_str) +
		rowHTML(areaLabel, P2_str) +
		rowHTML(restLabel, rem_str) +
		`<span class="np-base">${baseTag}</span>`
	);
}
