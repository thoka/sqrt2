// compileOrchestrator.js (ASYNC-COMPILE-PLAN, Schritt 4).
//
// Ersetzt den alten `derived(configStore, compileSystem)`-Pfad: bei jeder
// configStore-Änderung wird ein frischer Compile-Job gestartet. Läuft ein
// alter Job noch, wird dessen Worker per terminate() hart beendet (kein
// Ergebnis mehr von ihm) - einfach, robust, kein Eingriff in bank-core.js.
//
// Exportiert:
//   - compiledStore (writable): das finalisierte Compile-Ergebnis
//     (Closures gebaut auf dem Main-Thread via finalizeCompiled).
//   - compileStatusStore (writable): { state:'idle'|'compiling', startedAt }
//     treibt die Progress-Anzeige.
//   - errandWorkerCount / resetWorkerCount (nur Dev/Test): Zähl-Hook, damit
//     E2E/Unit prüfen können, dass nie >1 aktiver Worker existiert.
import { writable, get } from 'svelte/store';
import { configStore } from './configStore.js';
import { compileSystem, finalizeCompiled } from './compiler.js';

let currentJobId = 0;
let activeWorker = null;

// Anzahl aktiver Worker-Instanzen (für Test/E2E: nie > 1).
let activeWorkerCount = 0;
export function getActiveWorkerCount() {
	return activeWorkerCount;
}

let warnedFallback = false;

// WorkerFactory: standardmäßig echte `Worker`-Instanzen; in Tests/Node
// injizierbar (siehe createCompileOrchestrator), damit Job-Ersetzung ohne
// echten Worker race-frei getestet werden kann.
let workerFactory = () => {
	if (typeof Worker === 'undefined') return null;
	// Vite/Workerd: ?worker-Suffix; hier relativ zur Datei.
	return new Worker(new URL('./compile.worker.js', import.meta.url), { type: 'module' });
};

export function setWorkerFactory(factory) {
	workerFactory = factory;
}

export const compiledStore = writable(null);
export const compileStatusStore = writable({ state: 'idle', startedAt: 0, error: null });

// Manuelles Re-Trigger (z.B. nachdem configStore extern ersetzt wurde).
export function runCompile() {
	runJob(get(configStore));
}

function terminateActiveWorker() {
	if (activeWorker) {
		try {
			activeWorker.terminate();
		} catch {
			/* ignore */
		}
		activeWorker = null;
		activeWorkerCount = Math.max(0, activeWorkerCount - 1);
	}
	if (typeof window !== 'undefined') window.__activeWorkers = activeWorkerCount;
}

function runJob(config) {
	const jobId = ++currentJobId;
	terminateActiveWorker();

	compileStatusStore.set({ state: 'compiling', startedAt: Date.now(), error: null });

	const worker = workerFactory(config);
	if (!worker) {
		// Fallback ohne Worker-Support (z.B. Node, typeof Worker === 'undefined'):
		// synchron kompilieren, mit einmaliger console.warn.
		if (!warnedFallback) {
			console.warn(
				'[compileOrchestrator] Kein Worker verfügbar - synchroner Fallback (compileSystem).',
			);
			warnedFallback = true;
		}
		const compiled = compileSystem(config);
		// Nur anwenden, wenn zwischenzeitlich kein neuerer Job gestartet wurde
		// (bei rein synchronem Pfad unmöglich, aber zur Symmetrie).
		if (jobId === currentJobId) {
			compiledStore.set(compiled);
			compileStatusStore.set({ state: 'idle', startedAt: 0, error: null });
		}
		return;
	}

	activeWorker = worker;
	activeWorkerCount++;
	if (typeof window !== 'undefined') window.__activeWorkers = activeWorkerCount;
	worker.onmessage = (ev) => {
		const msg = ev.data;
		if (msg.jobId !== currentJobId) {
			// Veralteter Worker (sollte durch terminate() nicht mehr passieren,
			// aber defensiv): Ergebnis verwerfen.
			return;
		}
		terminateActiveWorker();
		if (msg.ok) {
			const compiled = finalizeCompiled(msg.data);
			compiledStore.set(compiled);
			compileStatusStore.set({ state: 'idle', startedAt: 0, error: null });
		} else {
			compileStatusStore.set({
				state: 'idle',
				startedAt: 0,
				error: msg.error || 'unbekannter Fehler',
			});
		}
	};
	worker.onerror = (err) => {
		if (jobId !== currentJobId) return;
		terminateActiveWorker();
		compileStatusStore.set({
			state: 'idle',
			startedAt: 0,
			error: err && err.message ? err.message : 'Worker-Fehler',
		});
	};
	worker.postMessage({ jobId, config });
}

// Initialen Compile starten (mit der aktuellen configStore-Startconfig).
runJob(get(configStore));

// configStore-Änderungen abonnieren (configStore selbst bleibt synchron/
// sofort - Tippen/URL-Export warten NICHT auf den Compile).
// Nur recompilieren, wenn sich FELDER aendern, die den Compile
// tatsaechlich beeinflussen (Basis, Tiefe, Transform, Zoom-Schwellen,
// Kompaktierung). Reine Laufzeit-Felder wie playSpeed/playback duerfen
// KEINEN teuren Recompile ausloesen (s. INTERFACE-TODO "Geschwindigkeits-
// regler loest Recompile aus").
// Der erste subscribe-Feuer liefert sofort den Initialwert - den überspringen
// wir, da wir runJob oben bereits manuell gestartet haben.
function compileRelevantKey(c) {
	return JSON.stringify([
		c.base,
		c.depth,
		c.transformMode,
		c.bankZoomThresholdPowers,
		c.zoomSpeedCoef,
		c.compactionEnabled,
		c.compactionTransitionTicks,
		c.flightRotation,
	]);
}
let firstSubscribe = true;
let _lastCompileKey;
configStore.subscribe((config) => {
	if (firstSubscribe) {
		firstSubscribe = false;
		_lastCompileKey = compileRelevantKey(config);
		return;
	}
	let key = compileRelevantKey(config);
	if (key === _lastCompileKey) return; // kein recompile-noetiges Feld geaendert
	_lastCompileKey = key;
	runJob(config);
});
