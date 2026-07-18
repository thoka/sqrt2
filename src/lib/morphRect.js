// Flug-Morph: Überblendung der Rest-Stück-Form vom Bank-Herkunfts-Rechteck
// zum Ziel-Rechteck beim Flug (siehe docs/FLIGHT-MORPH-SPEC.md).
//
// Problem des alten Codes: Breite/Höhe wurden unabhängig linear gelerp ->
// die Fläche pw*ph pulsiert während des Flugs. Hier wird stattdessen
//   - die FLÄCHE glatt von A0 nach A1 überführt (monoton, kein Pulsieren),
//   - das SEITENVERHÄLTNIS separiert davon gemorpht,
//   - optional eine 90°-DREHUNG eingemischt (statt/zu-samt Streckung),
//     damit Format-Wechsel wie 1:b -> b:1 ohne Verzerrung gelöst werden.
//
// WICHTIG: rho/rot werden aus den LOGISCHEN Dimensionen berechnet
// (zoom-unabhängig), pw/ph aus den Screen-Space Dimensionen.
// Sonst ändert sich der Rotationswinkel mit dem Zoom.
//
// Alles ist eine reine Funktion (kein DOM/Store) - Unit-getestet.

function logRatio(w, h) {
	// Seitenverhaeltnis im log-Raum: multiplikativ -> additiv.
	return Math.log(w / h);
}

// computeRotation: berechnet rho und rot aus logischen Dimensionen.
// Wird vom Render-Pfad aufgerufen, bevor morphRect die Screen-Space
// Form berechnet.
export function computeRotation(logSw, logSh, logEw, logEh, rotWeight) {
	const rs = logRatio(logSw, logSh);
	const rt = logRatio(logEw, logEh);
	const rtRot = logRatio(logEh, logEw);
	const e_s = Math.abs(rs - rt);
	const e_r = Math.abs(rs - rtRot);
	const g = Math.max(0, e_s - e_r);
	let rho = 0;
	if (e_s > 1e-9) rho = Math.min(1, Math.max(0, (rotWeight * g) / e_s));
	const dir = rtRot >= rs ? 1 : -1;
	return { rho, dir, rs, rt, rtRot };
}

// morphRect: liefert die gezeichnete Form (pw, ph) eines fliegenden
// Stücks zum Phasenparameter t in [0,1].
//
//   sw, sh : Screen-Space Start-Breite/-Höhe
//   ew, eh : Screen-Space Ziel-Breite/-Höhe
//   t      : geglätteter Phasenparameter [0,1] (smoothstep bereits draußen)
//   rho    : effektiver Dreh-Anteil 0..1 (aus computeRotation)
//   dir    : Drehrichtung +1/-1 (aus computeRotation)
//   rotWeight : 0..1 (nur für rTarget-Mischung, NICHT für rho-Berechnung)
//
// Invariante: pw * ph == A(t) exakt (Fläche folgt glatt A0->A1, kein
// Pulsieren). Bei A0 == A1 ist die Fläche exakt konstant.
export function morphRect(sw, sh, ew, eh, t, rho, dir) {
	// t in [0,1] klemmen (t=0 und t=1 müssen erhalten bleiben - daher
	// KEIN clampDt aus timeStep, das dt=0 auf maxDt umdeutet).
	let ts = t;
	if (!(ts > 0)) ts = 0;
	if (ts > 1) ts = 1;
	// KEIN interner smoothstep - der Render-Pfad (fly_t) glättet bereits.

	const A0 = sw * sh;
	const A1 = ew * eh;

	const rs = logRatio(sw, sh); // Start-Seitenverhältnis (log, screen)
	const rt = logRatio(ew, eh); // Ziel-Seitenverhältnis (log, screen)
	const rtRot = logRatio(eh, ew);

	// Ziel-Seitenverhältnis: bei reiner Drehung bleibt die Form konstant
	// (rtRot = gedrehte Ziel-Proportion), bei reiner Streckung wird zum
	// Ziel gemorpht (rt). rho mischt linear dazwischen.
	const rTarget = rho * rtRot + (1 - rho) * rt;
	// Fläche folgt glatt A0 -> A1
	const A = A0 * (1 - ts) + A1 * ts;
	// Seitenverhältnis vom Start zum (gemischten) Ziel morph (log -> exp)
	const rMix = Math.exp(rs * (1 - ts) + rTarget * ts);
	// Invariante: pw*ph == A
	const ph = Math.sqrt(Math.max(1e-12, A / rMix));
	const pw = A / ph;

	return { pw, ph };
}

// Rotationswinkel berechnen (aus logischen Dimensionen, zoom-unabhängig).
// Aufruf im Render-Pfad: rot = rotationAngle(cr, ts)
export function rotationAngle(cr, ts) {
	if (cr.rho < 1e-9) return 0;
	return (Math.PI / 2) * cr.rho * cr.dir * ts;
}
