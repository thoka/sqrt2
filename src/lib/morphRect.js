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
// Alles ist eine reine Funktion (kein DOM/Store) - Unit-getestet.

function logRatio(w, h) {
	// Seitenverhaeltnis im log-Raum: multiplikativ -> additiv.
	return Math.log(w / h);
}

// morphRect: liefert die gezeichnette Form (pw, ph) und den Drehwinkel
// (in Radian) eines fliegenden Stücks zum Phasenparameter t in [0,1].
//
//   sw, sh : Start-Breite/-Höhe (Bank-Herkunft)
//   ew, eh : Ziel-Breite/-Höhe (Zell-Ziel)
//   t      : geglätteter Phasenparameter [0,1] (smoothstep bereits draußen)
//   rotWeight : 0..1 - wie stark Drehung der Streckung vorgezogen wird
//
// Invariante: pw * ph == A(t) exakt (Fläche folgt glatt A0->A1, kein
// Pulsieren). Bei A0 == A1 ist die Fläche exakt konstant.
export function morphRect(sw, sh, ew, eh, t, rotWeight) {
	// t in [0,1] klemmen (t=0 und t=1 müssen erhalten bleiben - daher
	// KEIN clampDt aus timeStep, das dt=0 auf maxDt umdeutet).
	let ts = t;
	if (!(ts > 0)) ts = 0;
	if (ts > 1) ts = 1;
	// KEIN interner smoothstep - der Render-Pfad (fly_t) glättet bereits.

	const A0 = sw * sh;
	const A1 = ew * eh;

	const rs = logRatio(sw, sh); // Start-Seitenverhältnis (log)
	const rt = logRatio(ew, eh); // Ziel-Seitenverhältnis (log)
	const rtRot = logRatio(eh, ew); // Ziel-Seitenverhältnis bei 90° Drehung (log)

	// Verzerrung (Seitenverhältnis-Differenz im log-Raum)
	const e_s = Math.abs(rs - rt); // reine Streckung
	const e_r = Math.abs(rs - rtRot); // 90°-Dreh-Ziel
	const g = Math.max(0, e_s - e_r); // wieviel Verzerrung Drehung spart

	// Effektiver Dreh-Anteil 0..1. Bei Quadrat-Start (rs==0, also e_s==e_r,
	// g==0) wird nicht gedreht - Drehung sinnfrei bei sw==sh.
	let rho = 0;
	if (e_s > 1e-9) rho = Math.min(1, Math.max(0, (rotWeight * g) / e_s));

	// Ziel-Seitenverhältnis gemischt (im log-Raum): rein gestreckt (rt)
	// <-> gedreht (rtRot)
	const rTarget = rho * rtRot + (1 - rho) * rt;
	// Fläche folgt glatt A0 -> A1
	const A = A0 * (1 - ts) + A1 * ts;
	// Seitenverhältnis vom Start zum (gemischten) Ziel morph (log -> exp)
	const rMix = Math.exp(rs * (1 - ts) + rTarget * ts);
	// Invariante: pw*ph == A
	const ph = Math.sqrt(Math.max(1e-12, A / rMix));
	const pw = A / ph;

	// Drehwinkel: 0 bei Start -> ±90° beim Ankommen (monoton).
	// Der Render-Pfad glättet fly_textern via smoothstep.
	let rot = 0;
	if (rho > 1e-9) {
		const dir = rtRot >= rs ? 1 : -1;
		rot = (Math.PI / 2) * rho * dir * ts;
	}
	return { pw, ph, rot, rho };
}
