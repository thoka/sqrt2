// ============================================================================
// NUMBER-RENDERER.JS - eigene Zahlendarstellung (statt MathJax)
// ============================================================================
// HUD/Flug-Stottern-Ursache war MathJax' pro-Frame `typesetPromise`
// (teuer, blockiert den Main-Thread) - und nach dessen Entfernung das
// stuendige DOM-`innerHTML`-Umschreiben inkl. erzwungenem Reflow
// (`scrollWidth`/`clientWidth` in updateNumberPanelScale). Beides ist weg:
// die Zahlentafel (l / l² / R) wird JETZT direkt auf dem BANK-CANVAS
// gemalt (ctx.fillText), siehe TargetBankCanvas.svelte renderFrame().
//
// Dieses Modul liefert NUR die reine BigInt->String-Formatierung
// (Basis-B-Notation, Punkt-Format, Trailing-Zero-Trim) - keine DOM-,
// keine Canvas-Abhaengigkeit, daher isoliert testbar.

// Spaltet "12.3" -> { int: "12", frac: "3" }. Ohne Punkt -> frac="".
export function splitBaseNumber(s) {
	let dot = s.indexOf('.');
	if (dot < 0) return { int: s, frac: '' };
	return { int: s.slice(0, dot), frac: s.slice(dot + 1) };
}

// Formatiert die exakten BigInt-Werte aus computeLiveL() in Basis-B-
// Notation: l = N_l/GRID (N_MAX Stellen), l² = N_l²/GRID²,
// R = N_R/AREA_SCALE (K_MAX Stellen). Liefert die drei bereits
// punkt-formatierten + trailing-Zero-getrimmten Strings.
// (Mathe exakt aus der Simulation, siehe docs/REST-PRECISION-PLAN.)
export function formatLiveNumbers(N_l, N_R, GRID, AREA_SCALE, BASE) {
	let m = GRID.toString(BASE).length - 1; // = N_MAX
	let kmax = AREA_SCALE.toString(BASE).length - 1; // = K_MAX

	// Seitenlaenge P = N_l / GRID
	let P_str = N_l.toString(BASE).toUpperCase();
	if (m > 0) P_str = '0'.repeat(Math.max(0, m + 1 - P_str.length)) + P_str;
	if (m > 0) P_str = P_str.slice(0, P_str.length - m) + '.' + P_str.slice(P_str.length - m);

	// Flaeche P^2 = N_l^2 / GRID^2
	let P2 = N_l * N_l;
	let P2_str = P2.toString(BASE).toUpperCase();
	if (m > 0) {
		let digits = 2 * m;
		P2_str = '0'.repeat(Math.max(0, digits + 1 - P2_str.length)) + P2_str;
		P2_str = P2_str.slice(0, P2_str.length - digits) + '.' + P2_str.slice(P2_str.length - digits);
	}

	// Rest R = N_R / AREA_SCALE (= 2 - l², aber hier direkt gezaehlt)
	let rem_str = N_R.toString(BASE).toUpperCase();
	if (kmax > 0) {
		rem_str = '0'.repeat(Math.max(0, kmax + 1 - rem_str.length)) + rem_str;
		rem_str = rem_str.slice(0, rem_str.length - kmax) + '.' + rem_str.slice(rem_str.length - kmax);
	}

	// Haengende Nullen abschneiden: die letzte Ziffer soll nie eine 0 sein
	// (z.B. 1.410 -> 1.41, 1.40 -> 1.4). Betrifft l, l² und R.
	const trimTrailing = (s) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);
	P_str = trimTrailing(P_str);
	P2_str = trimTrailing(P2_str);
	rem_str = trimTrailing(rem_str);

	return { P_str, P2_str, rem_str };
}

// Nenner fuer die Achsen-Beschriftung der Ziel-Quadrate (TODO.md
// "Darstellung"): Zaehler ist in beiden Beschriftungen (Formel unten, Wert
// links) immer "1" - nur der NENNER unterscheidet sich (Basis^Exponent,
// exakt als BigInt, kein Float-Rundungsfehler). Fuer exp=0 (weisses
// Grundquadrat) wird KEIN Bruch gezeichnet (Aufrufer zeigt stattdessen "1"),
// dieser Fall wird hier trotzdem korrekt bedient (Denominator "1").
export function formatAxisDenominator(base, exp) {
	return (BigInt(base) ** BigInt(exp)).toString();
}
