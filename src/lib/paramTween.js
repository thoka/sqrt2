// ============================================================================
// PARAMTWEEN.JS - Echtzeit-Tweener fuer LIVE, beliebig oft retargetbare
// Parameter (z.B. Uebergaenge zwischen UI-Voreinstellungen).
// ============================================================================
// ABGRENZUNG zu smoothing.js (siehe CLAUDE.md "Automatisierte Parameter-
// aenderungen"): smoothing.js glaettet ueber die kompilierte Animations-
// Zeitachse (u_time), deren Stuetzpunkte VOR dem Rendern bereits alle
// bekannt sind (buildMonotoneSpline/buildDampedFilter werten dieselbe,
// fertige Stuetzpunkt-Folge nicht-kausal an jedem u_time aus). Hier dagegen
// loest eine DISKRETE Nutzeraktion (z.B. Radio-Button-Klick) zu einer VORHER
// UNBEKANNTEN Echtzeit einen automatisierten Uebergang aus - und genau das
// ist der in CLAUDE.md von "direkter Nutzerinteraktion" abgegrenzte Fall
// (kein Maus-Drag, sondern eine Zustandsauswahl), der aber trotzdem C1-
// stetig bleiben muss, AUCH wenn der Nutzer erneut waehlt, waehrend die
// vorige Animation noch laeuft (Retargeting zu einer beliebigen Zeit).
//
// Eine Superposition von Sprungantworten (wie buildDampedFilter) reicht
// dafuer NICHT: sie startet jede Sprungantwort mit Steigung exakt 0, ein
// Retargeting waehrend eine vorige Antwort noch eine Restgeschwindigkeit
// hat, wuerde also einen Kink in der Ableitung erzeugen. Stattdessen ein
// klassischer kritisch gedaempfter Feder-Integrator MIT explizitem
// Geschwindigkeits-Zustand (dasselbe Funktionsprinzip wie Unitys
// `Mathf.SmoothDamp`/Game Programming Gems 4.8 "Critically Damped Ease-In/
// Ease-Out") - dadurch ist JEDES Retargeting, zu JEDEM Zeitpunkt, per
// Konstruktion C1 (Wert UND Geschwindigkeit bleiben stetig), weil einfach
// am aktuellen Zustand weiter integriert wird statt eine neue, bei Null
// startende Antwort zu ueberlagern.
// ============================================================================

// Ein Tween-Schritt: bewegt {value, velocity} um `dt` Sekunden in Richtung
// `target`, kritisch gedaempft mit Zeitkonstante `smoothTime` (grob: Zeit,
// bis der Wert dem Ziel sichtbar nahe gekommen ist - siehe createSpringTween()
// fuer die zustandsbehaftete Nutzung). Reine Funktion, daher unabhaengig
// testbar.
export function springStep(value, velocity, target, smoothTime, dt) {
	if (dt <= 0) return { value, velocity };
	if (smoothTime <= 0) return { value: target, velocity: 0 };
	const omega = 2 / smoothTime;
	const x = omega * dt;
	// Standard-Approximation der exakten Exponentialloesung (Game
	// Programming Gems 4.8) - fehlerfrei genug fuer UI-Uebergaenge, ohne
	// pro Schritt ein Exp() auszuwerten.
	const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
	const change = value - target;
	const temp = (velocity + omega * change) * dt;
	const newVelocity = (velocity - omega * temp) * exp;
	const newValue = target + (change + temp) * exp;
	return { value: newValue, velocity: newVelocity };
}

// Zustandsbehaftetes Objekt um springStep() herum - haelt Wert/Geschwindigkeit/
// Ziel selbst, damit Aufrufer (siehe zoomStateTween.js) nicht selbst
// Zustands-Buchhaltung betreiben muessen.
//
// smoothTime: Sekunden bis (fast) am Ziel (siehe springStep()).
// eps: Schwelle fuer isSettled - unterhalb dieser Differenz zu Ziel/Wert UND
// Geschwindigkeit gilt der Tween als "angekommen" (zum Stoppen einer
// rAF-Schleife, siehe zoomStateTween.js). Skaliert mit dem Wertebereich des
// jeweiligen Parameters (z.B. 1e-3 fuer einen [0,1]-Wert, groesser fuer
// einen [0,100]-Wert).
export function createSpringTween(initialValue, smoothTime, eps = 1e-3) {
	let value = initialValue;
	let velocity = 0;
	let target = initialValue;
	return {
		setTarget(v) {
			target = v;
		},
		// Springt OHNE Animation auf einen neuen Ist-Wert (Geschwindigkeit
		// 0) - fuer den Fall, dass der Wert ZWISCHEN zwei Tweens auf anderem
		// Weg (z.B. direkte Regler-Bedienung) veraendert wurde und der
		// naechste Tween nicht von einer veralteten Position aus starten soll.
		syncTo(v) {
			value = v;
			velocity = 0;
		},
		step(dt) {
			({ value, velocity } = springStep(value, velocity, target, smoothTime, dt));
			return value;
		},
		get value() {
			return value;
		},
		get isSettled() {
			return Math.abs(value - target) < eps && Math.abs(velocity) < eps;
		},
	};
}
