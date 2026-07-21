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
// TREIBER (2. Anlauf): kritisch gedaempfter Geschwindigkeits-Integrator
// (Position UND Geschwindigkeit als echter Zustand - "Game Programming
// Gems 4.8"/Unitys Mathf.SmoothDamp). Der ERSTE Anlauf war bewusst ein
// einfacherer Ease-Ramp (Fortschritt s, bei Retargeting auf s=0
// zurueckgesetzt) - User-Entscheidung "einfachere Loesung zuerst". Das
// erzeugte aber sichtbare "Blitze" beim schnellen Umschalten: s=0
// bedeutet Geschwindigkeit exakt 0, ein Retargeting waehrend eine
// Bewegung noch eine REALE Geschwindigkeit hatte, erzeugte also einen
// Geschwindigkeits-Knick - und weil `engagement`/`abstraction`
// EXPONENTIELL in die Darstellung eingehen (`BASE^(1-t_AB)`, siehe
// TargetBankCanvas.svelte), machte sich dieser Knick als sichtbarer
// Sprung bemerkbar, nicht nur als leichte Unrundheit.
//
// Dieser Integrator traegt Geschwindigkeit ECHT ueber jedes Retargeting
// hinweg fort (nur die ZIEL-Werte aendern sich bei retarget(), Position
// und Geschwindigkeit laufen unveraendert weiter) - dadurch ist JEDES
// Retargeting, zu JEDEM Zeitpunkt, garantiert geschwindigkeitsstetig
// (keine Blitze mehr, beliebig schnelles Hin-und-Herschalten moeglich).
//
// smoothTime/maxSpeed werden aus configStore.zoomStateTransitionDuration
// abgeleitet (Regler "Zustands-Übergang: Dauer" im Animation-Tab, 0..10s):
// smoothTime steuert das Anfahren/Abbremsen an den Enden, maxSpeed
// deckelt die Geschwindigkeit dazwischen so, dass eine VOLLE 0->1-Bewegung
// (der groesstmoegliche Sprung in diesem Embedding) bei konstanter
// Maximalgeschwindigkeit ungefaehr `duration` Sekunden braucht - der
// Regler bleibt dadurch als "ungefaehre Uebergangsdauer" interpretierbar,
// auch wenn die Feder den Zielwert nur asymptotisch (nie exakt exakt)
// erreicht.
import { configStore } from './configStore.js';

// Kalibrierungsfaktor smoothTime -> tatsaechliche Einschwingzeit (~1%
// Restfehler, ausgehend aus der Ruhe): per Simulation ermittelt (siehe
// docs/Alternative Zoom-Steuerung,md), NICHT 1:1 (eine kritisch gedaempfte
// Feder braucht laenger als ihre eigene smoothTime, um praktisch am Ziel
// anzukommen).
const SETTLE_TIME_FACTOR = 3.65;

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

// Ein Integrations-Schritt (Position + Geschwindigkeit) - reine Funktion,
// unabhaengig testbar. Kanonischer SmoothDamp-Algorithmus (Game
// Programming Gems 4.8): kritisch gedaempft (kein Ueberschwingen bei
// EINEM Ziel), mit Geschwindigkeitsdeckel (maxSpeed) und expliziter
// Ueberschwing-Sicherung (verhindert Artefakte, wenn maxSpeed/grosse dt
// das Ziel sonst "ueberspringen" wuerden).
export function springStep(value, velocity, target, smoothTime, maxSpeed, dt) {
	if (dt <= 0) return { value, velocity };
	smoothTime = Math.max(0.0001, smoothTime);
	const omega = 2 / smoothTime;
	const x = omega * dt;
	const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
	let change = value - target;
	const originalTarget = target;

	const maxChange = maxSpeed * smoothTime;
	change = Math.max(-maxChange, Math.min(maxChange, change));
	const clampedTarget = value - change;

	const temp = (velocity + omega * change) * dt;
	let newVelocity = (velocity - omega * temp) * exp;
	let newValue = clampedTarget + (change + temp) * exp;

	// Ueberschwingen verhindern: wenn das Ziel auf dem Weg "ueberholt"
	// wuerde, stattdessen exakt dort stoppen (Standard-SmoothDamp-Sicherung).
	if (originalTarget - value > 0 === newValue > originalTarget) {
		newValue = originalTarget;
		newVelocity = (newValue - originalTarget) / dt;
	}
	return { value: newValue, velocity: newVelocity };
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
	let smoothTime = 1.0;
	let maxSpeed = 1.0;

	const SETTLE_EPS = 1e-3;

	function tick(now) {
		let dt = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
		lastFrameTime = now;

		let e = springStep(
			engagementValue,
			engagementVelocity,
			targetEngagement,
			smoothTime,
			maxSpeed,
			dt,
		);
		let a = springStep(
			abstractionValue,
			abstractionVelocity,
			targetAbstraction,
			smoothTime,
			maxSpeed,
			dt,
		);
		engagementValue = e.value;
		engagementVelocity = e.velocity;
		abstractionValue = a.value;
		abstractionVelocity = a.velocity;
		configStore.update((c) => ({
			...c,
			zoomEngagement: engagementValue,
			abstraction: abstractionValue,
		}));

		let settled =
			Math.abs(engagementValue - targetEngagement) < SETTLE_EPS &&
			Math.abs(engagementVelocity) < SETTLE_EPS &&
			Math.abs(abstractionValue - targetAbstraction) < SETTLE_EPS &&
			Math.abs(abstractionVelocity) < SETTLE_EPS;
		if (settled) {
			rafId = null;
			return;
		}
		rafId = requestAnimationFrame(tick);
	}

	function retarget(c, now) {
		let duration = Math.max(0.05, c.zoomStateTransitionDuration ?? 1.0);
		// smoothTime ist NICHT direkt "duration" - eine kritisch gedaempfte
		// Feder braucht empirisch (per Simulation ermittelt) ca. das 3.65-
		// fache von smoothTime, um auf ~1% Restfehler zu kommen. Ohne diese
		// Umrechnung waere der Regler "Zustands-Übergang: Dauer" grob falsch
		// kalibriert (ein voller 0->1-Uebergang dauerte ca. 3.65x laenger als
		// eingestellt). maxSpeed bewusst grosszuegig (nicht an duration
		// gekoppelt) - dient nur als Sicherheitsnetz gegen extreme
		// Geschwindigkeiten bei sehr kurzen Dauern, bindet im Normalfall nicht.
		smoothTime = duration / SETTLE_TIME_FACTOR;
		maxSpeed = 20;
		let preset = ZOOM_STATE_TARGETS[c.zoomState] ?? ZOOM_STATE_TARGETS.rand;

		if (rafId === null) {
			// Keine Bewegung im Gange - Position/Geschwindigkeit auf einen
			// zwischenzeitlich ANDERS (z.B. direkt per Regler) gesetzten
			// Live-Wert nachziehen, sonst wuerde die naechste Bewegung von
			// einer veralteten Position aus starten. WAEHREND einer laufenden
			// Bewegung (rafId !== null) passiert das explizit NICHT - Position
			// UND Geschwindigkeit laufen unveraendert weiter, nur die Ziele
			// aendern sich (das ist der eigentliche Fix gegen die "Blitze").
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
