// Persistenter Regressionstest für den Auto-Zoom-Sichtbarkeitsbug aus
// sqrt2.html ("bei Auto-Zoom=6 und Default-Einstellungen ist die dritte
// Nachkommastelle nicht zu sehen"): der alte kausale Glättungs-Filter
// (kritisch gedämpfte Sprungantwort) hinkte einem neuen Checkpoint eine
// Zeitkonstante lang hinterher - GENAU in diesem Fenster konnte eine
// gerade erst sichtbare, tiefe Ziffernstelle unter die konfigurierte
// Mindestbreite fallen. Der Fix in sqrt2.html ersetzt den Filter durch
// buildMonotoneSpline() (siehe smoothing.js) - dieser Test verifiziert mit
// dem ECHTEN Bank-Algorithmus (bank-core.js), dass die Spline ALLEIN die
// Sichtbarkeits-Garantie trägt, ohne die zusätzliche "harte" Sicherheits-
// Kopie, die sqrt2.html vorher zusätzlich brauchte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBankSimulation, buildSystem } from '../../bank-core.js';
import { buildMonotoneSpline } from '../../smoothing.js';

// Repliziert NUR die Schalen-Start-Zeit-Berechnung aus compileSystem() in
// sqrt2.html, für den dortigen Default-Flugmodus 'morph' (cellMode='morph'),
// bei dem buildSystem() ausschließlich count===1-Events liefert (die
// Zerschneiden-Gruppen-Logik kommt hier nie zum Tragen, siehe dort) - der
// exakte Wert von SHELL_GAP/0.15 ist für DIESEN Test nicht sicherheitskritisch
// (siehe unten), es zählt nur, dass shell_start_time monoton wächst.
function computeShellStartTimes(events, TOTAL_STEPS) {
	const SHELL_GAP = 1.0;
	let shell_start_time = new Array(TOTAL_STEPS).fill(0);
	let global_time = 1.0;
	let lastS = 0;
	for (let e of events) {
		let S = Math.max(e.u, e.v);
		if (S !== lastS) {
			global_time += SHELL_GAP;
			shell_start_time[S] = global_time;
			lastS = S;
		}
		global_time += 0.15;
	}
	return shell_start_time;
}

// Repliziert widthAt()/computeAutoZoomTAB() aus sqrt2.html 1:1 (reine
// Formel, siehe dort für die ausführliche Herleitung/Kommentare).
function makeAutoZoomTools(axes, TOTAL_STEPS, N_MAX, BASE, P_FINAL, scale) {
	function widthAt(t_AB, targetExp) {
		let b_eff = Math.pow(BASE, 1.0 - t_AB);
		if (b_eff < 1.000001) b_eff = 1.000001;
		let sumA = 1.0;
		for (let i = 1; i < TOTAL_STEPS; i++) sumA += Math.pow(b_eff, -axes[i].exp);
		let DYN_W = sumA + Math.pow(b_eff, -(N_MAX + 1));
		let V_SCALE_TARGET = P_FINAL / DYN_W;
		return Math.pow(b_eff, -targetExp) * V_SCALE_TARGET * scale;
	}
	function computeAutoZoomTAB(thresholdPx, targetExp) {
		if (thresholdPx <= 0 || TOTAL_STEPS <= 1) return 0;
		const STEPS = 200;
		let prevT = 0,
			prevWidth = widthAt(0, targetExp);
		if (prevWidth >= thresholdPx) return 0;
		let bestT = 0,
			bestWidth = prevWidth;
		for (let i = 1; i <= STEPS; i++) {
			let t = i / STEPS;
			let w = widthAt(t, targetExp);
			if (w > bestWidth) {
				bestT = t;
				bestWidth = w;
			}
			if (w >= thresholdPx) {
				let frac = (thresholdPx - prevWidth) / (w - prevWidth);
				return prevT + frac * (t - prevT);
			}
			prevT = t;
			prevWidth = w;
		}
		return bestT;
	}
	return { widthAt, computeAutoZoomTAB };
}

function checkNoInvisibleDigit(BASE, N_MAX, thresholdPx, scale) {
	let sim = createBankSimulation(BASE, N_MAX, 'fixed');
	let { events } = buildSystem(BASE, N_MAX, 'fixed', 'morph');
	let axes = sim.axes;
	let TOTAL_STEPS = axes.length;
	let P_FINAL = axes.reduce((sum, a) => sum + Math.pow(BASE, -a.exp), 0);
	let shellStart = computeShellStartTimes(events, TOTAL_STEPS);
	let { widthAt, computeAutoZoomTAB } = makeAutoZoomTools(
		axes,
		TOTAL_STEPS,
		N_MAX,
		BASE,
		P_FINAL,
		scale,
	);

	// { onlyChanges: true } spiegelt sqrt2.html's tatsächliche Konstruktion
	// von GLOBAL_AUTO_ZOOM_SPLINE (siehe compileSystem()) - wichtig für
	// diesen Test, weil es die Zeitpunkte VERSCHIEBT, an denen die Rampe zum
	// nächsten Exponenten beginnt (siehe smoothing.js) - die Sichtbarkeits-
	// Garantie muss auch dafür weiter gelten.
	let spline = buildMonotoneSpline(
		shellStart.map((t, S) => ({ t, v: axes[S].exp })),
		{ onlyChanges: true },
	);

	// Kritischste Momente: GENAU der Zeitpunkt, an dem eine neue Schale
	// beginnt (hier hinkte der alte Filter am stärksten hinterher) - plus
	// ein paar Zeitpunkte kurz danach.
	for (let S = 1; S < TOTAL_STEPS; S++) {
		for (let dt of [0, 0.01, 0.05, 0.2]) {
			let time = shellStart[S] + dt;
			let smoothedExp = spline(time);
			let t_AB = computeAutoZoomTAB(thresholdPx, smoothedExp);

			// "Wahrer" gerade sichtbarer Exponent zu diesem Zeitpunkt (höchste
			// Schale, deren Startzeit erreicht ist) - das ist die Stelle, die
			// laut Einstellung mindestens thresholdPx breit sein soll.
			let trueStep = 0;
			for (let s = 1; s < TOTAL_STEPS; s++) {
				if (time >= shellStart[s]) trueStep = s;
				else break;
			}
			let trueExp = axes[trueStep].exp;

			// Toleranz: computeAutoZoomTAB() selbst sucht nur über ein 200-
			// Stützstellen-Raster mit linearer Interpolation (siehe dort) -
			// das erzeugt naturgemäß eine kleine, für die Pixel-Darstellung
			// irrelevante Restabweichung (empirisch < 0.1% relativ, siehe
			// Gesprächsverlauf), UNABHÄNGIG von der Spline-Änderung dieses
			// Tests. 1% relative Toleranz liegt bequem darüber, ist aber
			// immer noch >100× enger als der eigentliche Bug (der lag bei
			// -92%, siehe Bugreport) - fängt also echte Regressionen zuverlässig.
			let allowedWidth = thresholdPx * 0.99;
			let actualWidth = widthAt(t_AB, trueExp);
			assert.ok(
				actualWidth >= allowedWidth,
				`BASE=${BASE} N_MAX=${N_MAX}: Ziffernstelle exp=${trueExp} nur ${actualWidth.toFixed(3)}px breit ` +
					`(Soll >= ${thresholdPx}px, Toleranz bis ${allowedWidth.toFixed(3)}px) bei t=${time.toFixed(3)} ` +
					`(Schale ${S}, dt=${dt}) - Spline-Exponent war ${smoothedExp.toFixed(3)} statt ${trueExp}`,
			);
		}
	}
}

test('Auto-Zoom (Spline allein, ohne Hard-Floor-Patch): keine Ziffernstelle wird nach ihrem Erscheinen unsichtbar - BASE=10, N_MAX=16, Schwelle 6px (Original-Bugreport)', () => {
	checkNoInvisibleDigit(10, 16, 6, 500);
});

test('Auto-Zoom: dieselbe Garantie gilt auch für andere Basis/Tiefe/Schwelle/Bildschirmgrößen-Kombinationen', () => {
	checkNoInvisibleDigit(10, 8, 3, 800);
	checkNoInvisibleDigit(2, 20, 10, 400);
	checkNoInvisibleDigit(16, 10, 20, 1200);
	checkNoInvisibleDigit(10, 16, 3, 500); // neuer Default-Wert des Auto-Zoom-Feldes
});
