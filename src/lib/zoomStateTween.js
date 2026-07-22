// zoomStateTween.js - treibt den weichen Uebergang zwischen den drei
// Voreinstellungen der Alternativen Rand-Zoom-Steuerung (Admin-Checkbox
// `edgeZoomControlMode`, Radio-Buttons im Grundeinstellungen-Tab, siehe
// docs/Alternative Zoom-Steuerung,md "Schalter-Tweening").
//
// Bewegt NUR zoomEngagement + abstraction (die beiden Groessen, die die
// 3 Zustaende tatsaechlich unterscheiden). zoomLevel bleibt bewusst
// AUSSERHALB dieses Embeddings - es ist in KEINEM der 3 Preset-Punkte
// festgelegt, bleibt also beim Zustandswechsel unveraendert stehen (wie
// ein Lautstaerkeregler, der beim Stummschalten seinen Wert behaelt) und
// ist unabhaengig vom aktiven Zustand jederzeit als eigener Regler nutzbar.
//
// TREIBER (3. Anlauf): quasi-mechanisches Trapez-Geschwindigkeitsprofil
// (Bang-Bang-Regelung eines Doppel-Integrators - Position, Geschwindigkeit
// UND Beschleunigung als echter Zustand). Die vorherigen zwei Anlaeufe
// hatten je einen eigenen Bug:
//   1. Ease-Ramp (Fortschritt s, bei Retargeting auf s=0 zurueckgesetzt) -
//      Geschwindigkeit sprang bei jedem Retargeting auf 0 -> sichtbare
//      "Blitze" beim schnellen Umschalten.
//   2. Kritisch gedaempfte Feder MIT hartem Snap kurz vor dem Ziel (um das
//      lange asymptotische Ausklingen abzukuerzen) - der Snap selbst war
//      aber wieder ein Sprung in Position UND Geschwindigkeit ("das ging
//      nach hinten los", User-Feedback) - Symptom nur verlagert, nicht
//      behoben.
// Beide Bugs sind strukturell derselbe Fehler: ein Verfahren, das
// Position/Geschwindigkeit an IRGENDEINEM Punkt (Retargeting oder Snap)
// UNSTETIG aendert. Ein Trapezprofil vermeidet das grundsaetzlich:
// Beschleunigung (anfahren) -> Grenzgeschwindigkeit (cruisen) ->
// Verzoegerung (abbremsen), Position UND Geschwindigkeit bleiben dabei
// IMMER stetig, und es kommt in ENDLICHER Zeit EXAKT mit Geschwindigkeit 0
// am Ziel an (kein asymptotisches Ausklingen, kein Snap noetig). Bei
// Retargeting mitten in der Bewegung wird nur die BREMS-/BESCHLEUNIGUNGS-
// ENTSCHEIDUNG neu getroffen (siehe trapStep()) - Position/Geschwindigkeit
// laufen dabei unveraendert weiter, das System bremst/dreht so um, wie ein
// reales mechanisches System es taete.
import { configStore } from './configStore.js';

// Kalibrierung: fuer eine VOLLE 0->1-Bewegung (der groesstmoegliche Sprung
// in diesem Embedding) soll die Gesamtzeit ungefaehr `duration` Sekunden
// betragen (Regler "Zustands-Übergang: Dauer", 0..10s), mit einem
// klassischen Trapez-Profil: Beschleunigungs-/Verzoegerungsphase je 1/4
// der Dauer, Rest cruist bei maxSpeed. Aufgeloest nach maxSpeed/maxAccel
// (siehe docs/Alternative Zoom-Steuerung,md fuer die Herleitung) - bei
// sehr kurzen Distanzen (z.B. Retargeting kurz vor dem alten Ziel) wird
// trapStep() automatisch zu einem Dreiecksprofil (nie maxSpeed erreicht,
// direkt von Beschleunigung in Verzoegerung), OHNE dass das hier eigens
// behandelt werden muss - das folgt automatisch aus der Bremsweg-Regel.
const ACCEL_PHASE_FRACTION = 0.25;

// Preset je Zustand - NUR die Felder angeben, die dieser Zustand
// tatsaechlich festlegt. "gleichmaessig" laesst engagement bewusst offen
// (bleibt unveraendert): sobald abstraction=1 ist, dominiert die lineare
// Mischung in TargetBankCanvas.svelte ohnehin, engagement ist dann
// irrelevant - siehe docs/Alternative Zoom-Steuerung,md fuer die
// Begruendung (macht jeden der 3 paarweisen Uebergaenge zu einer
// Ein-Skalar-Bewegung).
const ZOOM_STATE_TARGETS = {
	flaechentreu: { engagement: 0, abstraction: 0 },
	rand: { engagement: 1, abstraction: 0 },
	gleichmaessig: { abstraction: 1 },
};

// Ein Bang-Bang-Trapez-Schritt (Position + Geschwindigkeit, Beschleunigung
// implizit ueber die Entscheidung "beschleunigen/cruisen/bremsen") - reine
// Funktion, unabhaengig testbar. Regel: bremsen, sobald entweder (a) die
// Bewegung nicht mehr Richtung Ziel zeigt, oder (b) der verbleibende Weg
// nicht mehr ausreicht, um mit maxAccel aus der aktuellen Geschwindigkeit
// exakt zum Stillstand zu kommen (klassische Bremsweg-Formel
// v²/(2·maxAccel)) - sonst beschleunigen Richtung Ziel (bis maxSpeed
// erreicht ist, danach cruisen). Kommt dadurch immer EXAKT mit
// Geschwindigkeit 0 am Ziel an, in endlicher Zeit, ohne Ueberschwingen.
export function trapStep(position, velocity, target, maxSpeed, maxAccel, dt) {
	if (dt <= 0) return { position, velocity };
	let remaining = target - position;
	if (remaining === 0 && velocity === 0) return { position, velocity };

	let towardTarget = Math.sign(remaining) || Math.sign(velocity) || 1;
	let brakingDistance = (velocity * velocity) / (2 * maxAccel);
	let movingTowardTarget =
		velocity === 0 || Math.sign(velocity) === Math.sign(remaining || velocity);
	let needBraking =
		velocity !== 0 && (!movingTowardTarget || Math.abs(remaining) <= brakingDistance);

	let accel;
	if (needBraking) {
		accel = -Math.sign(velocity) * maxAccel;
	} else if (Math.abs(velocity) < maxSpeed) {
		accel = towardTarget * maxAccel;
	} else {
		accel = 0; // Grenzgeschwindigkeit erreicht - cruisen.
	}

	let newVelocity = velocity + accel * dt;
	if (Math.abs(newVelocity) > maxSpeed) newVelocity = Math.sign(newVelocity) * maxSpeed;
	let newPosition = position + velocity * dt + 0.5 * accel * dt * dt;

	// Ueberschwingen verhindern: sobald das Ziel ueberschritten/erreicht
	// wurde (Vorzeichenwechsel des Restwegs) oder wir numerisch nah genug
	// UND langsam genug sind, exakt dort einrasten (Geschwindigkeit 0).
	let newRemaining = target - newPosition;
	let crossedTarget = remaining !== 0 && Math.sign(newRemaining) !== Math.sign(remaining);
	let numericallyArrived = Math.abs(newRemaining) < 1e-4 && Math.abs(newVelocity) < 1e-3;
	if (crossedTarget || numericallyArrived) {
		newPosition = target;
		newVelocity = 0;
	}
	return { position: newPosition, velocity: newVelocity };
}

let started = false;

// Registriert den Treiber genau einmal (configStore ist ein globaler
// Singleton). Kein Effekt ohne requestAnimationFrame (Node-Unit-Tests unter
// tests/unit/ laufen ohne DOM) - dort bleibt edgeZoomControlMode ohnehin
// auf Default (aus).
export function initZoomStateTween() {
	if (started) return;
	if (typeof requestAnimationFrame === 'undefined') return;
	started = true;

	let rafId = null;
	let lastKey = null;
	let lastFrameTime = 0;

	let engagementValue = 1.0;
	let engagementVelocity = 0;
	let abstractionValue = 0.0;
	let abstractionVelocity = 0;
	let targetEngagement = 1.0;
	let targetAbstraction = 0.0;
	let maxSpeed = 1.0;
	let maxAccel = 1.0;

	function tick(now) {
		let dt = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
		lastFrameTime = now;

		let e = trapStep(engagementValue, engagementVelocity, targetEngagement, maxSpeed, maxAccel, dt);
		let a = trapStep(
			abstractionValue,
			abstractionVelocity,
			targetAbstraction,
			maxSpeed,
			maxAccel,
			dt,
		);
		engagementValue = e.position;
		engagementVelocity = e.velocity;
		abstractionValue = a.position;
		abstractionVelocity = a.velocity;
		configStore.update((c) => ({
			...c,
			zoomEngagement: engagementValue,
			abstraction: abstractionValue,
		}));

		let settled = engagementValue === targetEngagement && abstractionValue === targetAbstraction;
		if (settled) {
			rafId = null;
			return;
		}
		rafId = requestAnimationFrame(tick);
	}

	function retarget(c, now) {
		let duration = Math.max(0.05, c.zoomStateTransitionDuration ?? 1.0);
		// Herleitung (volle 0->1-Bewegung, Trapezprofil mit
		// Beschleunigungs-/Verzoegerungsphase von je ACCEL_PHASE_FRACTION*
		// duration): siehe docs/Alternative Zoom-Steuerung,md.
		let accelTime = duration * ACCEL_PHASE_FRACTION;
		maxSpeed = 1 / (duration - accelTime);
		maxAccel = maxSpeed / accelTime;
		let preset = ZOOM_STATE_TARGETS[c.zoomState] ?? ZOOM_STATE_TARGETS.rand;

		if (rafId === null) {
			// Keine Bewegung im Gange - Position/Geschwindigkeit auf einen
			// zwischenzeitlich ANDERS (z.B. direkt per Regler) gesetzten
			// Live-Wert nachziehen, sonst wuerde die naechste Bewegung von
			// einer veralteten Position aus starten. WAEHREND einer laufenden
			// Bewegung (rafId !== null) passiert das explizit NICHT - Position
			// UND Geschwindigkeit laufen unveraendert weiter, nur die Ziele
			// aendern sich (trapStep() entscheidet dann neu, ob weiter
			// beschleunigt oder gebremst/umgedreht werden muss - genau wie ein
			// reales mechanisches System, das seine Meinung mitten in der
			// Bewegung aendert).
			engagementValue = c.zoomEngagement;
			engagementVelocity = 0;
			abstractionValue = c.abstraction;
			abstractionVelocity = 0;
		}
		targetEngagement = preset.engagement ?? c.zoomEngagement;
		targetAbstraction = preset.abstraction ?? c.abstraction;

		if (rafId === null) {
			lastFrameTime = now;
			rafId = requestAnimationFrame(tick);
		}
	}

	configStore.subscribe((c) => {
		if (!c.edgeZoomControlMode) {
			lastKey = null; // beim naechsten Einschalten frisch synchronisieren
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			return;
		}
		let key = c.edgeZoomControlMode + '|' + c.zoomState;
		if (key === lastKey) return; // eigene tick()-Schreibvorgaenge loesen keinen neuen Uebergang aus
		lastKey = key;
		retarget(c, performance.now());
	});
}
