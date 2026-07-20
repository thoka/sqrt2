// zoomStateTween.js - treibt den weichen Uebergang zwischen den drei
// Voreinstellungen der Alternativen Rand-Zoom-Steuerung (Admin-Checkbox
// `edgeZoomControlMode`, Radio-Buttons im Grundeinstellungen-Tab, siehe
// docs/Alternative Zoom-Steuerung,md).
//
// modeAB/autoZoomMinPx bleiben die tatsaechlichen, vom Canvas gelesenen
// Laufzeit-Felder (siehe TargetBankCanvas.svelte) - dieses Modul schreibt
// beim Zustandswechsel lediglich schrittweise (per rAF) auf sie, bis der
// jeweilige Preset-Wert erreicht ist. Fuer die Feder-Mathematik selbst siehe
// paramTween.js (dort auch die Abgrenzung zu smoothing.js begruendet).
import { configStore } from './configStore.js';
import { createSpringTween } from './paramTween.js';

const SMOOTH_TIME = 0.35; // Sekunden - typische UI-Uebergangsdauer

// Preset je Zustand. "rand" haelt modeAB NICHT fest, sondern nimmt den vom
// Nutzer zuletzt gewaehlten Feinregler-Wert (randZoomLevel, Animation-Tab) -
// ein Zwischenausflug nach "flaechentreu"/"gleichmaessig" (die modeAB
// ueberschreiben) darf diesen Wert nicht verwerfen.
const PRESETS = {
	flaechentreu: () => ({ modeAB: 0, autoZoomMinPx: 0 }),
	rand: (c) => ({ modeAB: c.randZoomLevel, autoZoomMinPx: 3 }),
	gleichmaessig: () => ({ modeAB: 1, autoZoomMinPx: 100 }),
};

function presetFor(c) {
	return (PRESETS[c.zoomState] ?? PRESETS.rand)(c);
}

let started = false;

// Registriert den Treiber genau einmal (configStore ist ein globaler
// Singleton - mehrere Aufrufe waeren redundant). Kein Effekt ohne
// requestAnimationFrame (Node-Unit-Tests unter tests/unit/ laufen ohne DOM) -
// dort bleibt edgeZoomControlMode ohnehin auf Default (aus).
export function initZoomStateTween() {
	if (started) return;
	if (typeof requestAnimationFrame === 'undefined') return;
	started = true;

	let modeABTween = null;
	let autoZoomTween = null;
	let rafId = null;
	let lastFrameTime = 0;
	let lastKey = null;

	function tick(now) {
		let dt = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
		lastFrameTime = now;
		let mv = modeABTween.step(dt);
		let av = autoZoomTween.step(dt);
		configStore.update((c) => ({ ...c, modeAB: mv, autoZoomMinPx: av }));
		if (modeABTween.isSettled && autoZoomTween.isSettled) {
			rafId = null;
			return;
		}
		rafId = requestAnimationFrame(tick);
	}

	function retarget(c) {
		let target = presetFor(c);
		if (!modeABTween) modeABTween = createSpringTween(c.modeAB, SMOOTH_TIME, 1e-3);
		if (!autoZoomTween) autoZoomTween = createSpringTween(c.autoZoomMinPx, SMOOTH_TIME, 0.1);
		if (rafId === null) {
			// Keine Animation aktiv - Feder ggf. auf einen zwischenzeitlich
			// ANDERS (z.B. per Feinregler direkt) gesetzten Live-Wert
			// nachziehen, sonst wuerde der naechste Uebergang von einer
			// veralteten Position aus starten.
			modeABTween.syncTo(c.modeAB);
			autoZoomTween.syncTo(c.autoZoomMinPx);
		}
		modeABTween.setTarget(target.modeAB);
		autoZoomTween.setTarget(target.autoZoomMinPx);
		if (rafId === null) {
			lastFrameTime = performance.now();
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
		retarget(c);
	});
}
