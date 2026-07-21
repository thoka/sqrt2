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
// Treiber: bewusst ein einfacher, gleichmaessig durchlaufender Ease-Ramp
// (smoothstep(elapsed/DURATION)), KEINE Feder (siehe CLAUDE.md
// "Schalter-Tweening" + docs/Alternative Zoom-Steuerung,md fuer die
// Diskussion, warum eine Feder hier nicht zeitsymmetrisch ist) - User-
// Entscheidung "einfachere Loesung zuerst, ohne eine aufwaendigere spaeter
// zu blockieren". Bei Retargeting waehrend eines laufenden Uebergangs wird
// die Rampe einfach bei s=0 neu gestartet (kleiner Steigungsknick moeglich,
// akzeptierter Trade-off) - der Wert selbst bleibt dabei stetig (C0), weil
// "von" immer der aktuelle Live-Wert aus configStore ist (der waehrend
// eines laufenden Uebergangs exakt der zuletzt geschriebene Zwischenwert
// ist).
import { configStore } from './configStore.js';

const DURATION = 0.35; // Sekunden - typische UI-Uebergangsdauer

// Preset je Zustand - NUR die Felder angeben, die dieser Zustand
// tatsaechlich festlegt. "gleichmaessig" laesst engagement bewusst offen
// (bleibt unveraendert): sobald abstraction=1 ist, dominiert der max() in
// TargetBankCanvas.svelte ohnehin, engagement ist dann irrelevant - siehe
// docs/Alternative Zoom-Steuerung,md fuer die Begruendung (macht jeden der
// 3 paarweisen Uebergaenge zu einer Ein-Skalar-Bewegung, damit
// zeitsymmetrisch).
const ZOOM_STATE_TARGETS = {
	flaechentreu: { engagement: 0, abstraction: 0 },
	rand: { engagement: 1, abstraction: 0 },
	gleichmaessig: { abstraction: 1 },
};

function smoothstep(s) {
	if (s <= 0) return 0;
	if (s >= 1) return 1;
	return s * s * (3 - 2 * s);
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
	let transitionFrom = null;
	let transitionTo = null;
	let startTime = 0;

	function tick(now) {
		let s = DURATION <= 0 ? 1 : Math.max(0, Math.min(1, (now - startTime) / DURATION));
		let eased = smoothstep(s);
		let engagement =
			transitionFrom.engagement + (transitionTo.engagement - transitionFrom.engagement) * eased;
		let abstraction =
			transitionFrom.abstraction + (transitionTo.abstraction - transitionFrom.abstraction) * eased;
		configStore.update((c) => ({ ...c, zoomEngagement: engagement, abstraction }));
		if (s >= 1) {
			rafId = null;
			return;
		}
		rafId = requestAnimationFrame(tick);
	}

	function retarget(c, now) {
		let preset = ZOOM_STATE_TARGETS[c.zoomState] ?? ZOOM_STATE_TARGETS.rand;
		// "von" ist immer der aktuelle Live-Wert - waehrend eines laufenden
		// Uebergangs ist das exakt der zuletzt von tick() geschriebene
		// Zwischenwert (Wert bleibt dadurch C0-stetig, auch bei schnellem
		// Umklicken). Felder, die das neue Preset nicht festlegt, bleiben
		// unveraendert (Ziel = aktueller Wert).
		transitionFrom = { engagement: c.zoomEngagement, abstraction: c.abstraction };
		transitionTo = {
			engagement: preset.engagement ?? c.zoomEngagement,
			abstraction: preset.abstraction ?? c.abstraction,
		};
		startTime = now;
		if (rafId === null) rafId = requestAnimationFrame(tick);
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
