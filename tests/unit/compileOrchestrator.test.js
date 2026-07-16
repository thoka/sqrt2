// Tests für compileOrchestrator.js (ASYNC-COMPILE-PLAN, Schritt 4) -
// Testkriterien 4 (Fallback-Pfad) und 5 (Job-Ersetzung race-frei).
// Die Worker-Ebene wird über die injizierbare WorkerFactory simuliert,
// damit Job-Ersetzung ohne echten Worker getestet werden kann.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { compileSystemData } from '../../src/lib/compiler.js';

const BASE_CONFIG = {
	base: 10,
	depth: 3,
	transformMode: 'S',
	bankZoomThresholdPowers: 0,
	zoomSpeedCoef: 0.012,
	compactionEnabled: false,
	compactionTransitionTicks: 3,
};

// Da compileOrchestrator.js beim Import sofort runJob(get(configStore))
// ausführt und configStore abonniert, bauen wir pro Test ein frisches Modul
// via isolateModules auf, mit einer vorbereiteten WorkerFactory.
async function freshOrchestrator(workerFactory) {
	// Frischer Modul-Import mit Cache-Bust via query, damit der
	// Modul-Top-Level-State (configStore-Subscription, currentJobId) pro
	// Test neu initialisiert wird.
	const mod = await import(`../../src/lib/compileOrchestrator.js?t=${Date.now()}-${Math.random()}`);
	mod.setWorkerFactory(workerFactory);
	return mod;
}

// Fake-Worker, der seine Nachricht asynchron (per microtask/macrotask)
// liefert - damit race-Szenarien realistisch sind.
class FakeWorker {
	constructor(config) {
		this.config = config;
		this.onmessage = null;
		this.onerror = null;
		this._terminated = false;
		this.post = (jobId) => {
			// Simuliere Worker-Latenz: liefer erst nach kurzem Delay, es sei
			// denn, wir wurden zwischenzeitlich terminierte.
			setTimeout(() => {
				if (this._terminated) return;
				const data = compileSystemData(this.config);
				this.onmessage({ data: { jobId, ok: true, data } });
			}, this._delay || 20);
		};
	}
	postMessage({ jobId }) {
		this.post(jobId);
	}
	terminate() {
		this._terminated = true;
	}
}

test('Fallback-Pfad (Worker undefined): Orchestrator liefert gleiches Ergebnis wie Worker-Pfad', async () => {
	const modNull = await freshOrchestrator(() => null);
	// configStore auf bekannte Config setzen.
	const { configStore } = await import('../../src/lib/stores.js');
	configStore.set({ ...BASE_CONFIG });
	// runCompile erzwingt neuen Job im Fallback (synchron).
	modNull.runCompile();
	const fallbackCompiled = get(modNull.compiledStore);
	assert.ok(fallbackCompiled && fallbackCompiled.TOTAL_STEPS > 0);
	assert.strictEqual(get(modNull.compileStatusStore).state, 'idle');

	// Zum Vergleich: echter Worker-Pfad (FakeWorker).
	const modWorker = await freshOrchestrator((config) => new FakeWorker(config));
	configStore.set({ ...BASE_CONFIG });
	modWorker.runCompile();
	// Warten bis FakeWorker geliefert hat.
	await new Promise((r) => setTimeout(r, 80));
	const workerCompiled = get(modWorker.compiledStore);
	assert.ok(workerCompiled && workerCompiled.TOTAL_STEPS > 0);

	assert.deepStrictEqual(workerCompiled.GLOBAL_N_ARR, fallbackCompiled.GLOBAL_N_ARR);
	assert.strictEqual(workerCompiled.MAX_TIME, fallbackCompiled.MAX_TIME);
});

test('Job-Ersetzung race-frei: späterer Job verdrängt früheren endgültig', async () => {
	// Zwei Configs, deren Worker künstlich verzögert sind. Zweiter Job wird
	// gestartet, BEVOR der erste liefert. Am Ende darf NIE ein Zwischenergebnis
	// des ersten Jobs (depth=20) im Store landen - nur depth=5.
	const cfgSlow = { ...BASE_CONFIG, depth: 20 };
	const cfgFast = { ...BASE_CONFIG, depth: 5 };

	const factory = (config) => {
		const w = new FakeWorker(config);
		// Erster Job (depth=20) extra langsam, damit der zweite (depth=5)
		// garantiert zuerst liefert.
		if (config.depth === 20) w._delay = 200;
		else w._delay = 10;
		return w;
	};
	const mod = await freshOrchestrator(factory);
	const { configStore } = await import('../../src/lib/stores.js');

	configStore.set({ ...cfgSlow });
	mod.runCompile();
	// Kurz danach den schnellen Job starten (bevor depth=20 geliefert hat).
	await new Promise((r) => setTimeout(r, 30));
	configStore.set({ ...cfgFast });
	mod.runCompile();

	// Warten bis beide (theoretisch) geliefert hätten.
	await new Promise((r) => setTimeout(r, 400));

	const result = get(mod.compiledStore);
	// Endergebnis muss exakt der späteren Config (depth=5) entsprechen, nie
	// dem zuerst gestarteten depth=20. GLOBAL_N_ARR.length === depth + 1.
	assert.strictEqual(
		result.GLOBAL_N_ARR.length,
		5 + 1,
		'Endergebnis muss exakt depth=5 entsprechen',
	);
	// Niemals die tiefere Config (depth=20) im Endzustand:
	assert.notStrictEqual(result.GLOBAL_N_ARR.length, 20 + 1);
});

test('Job-Ersetzung: kein Worker-Leck (max. 1 aktiver Worker)', async () => {
	// Fünf schnelle Änderungen hintereinander - zu keinem Zeitpunkt dürfen
	// mehr als 1 aktive Worker existieren (terminate-basiert).
	const factory = (config) => new FakeWorker(config);
	const mod = await freshOrchestrator(factory);
	const { configStore } = await import('../../src/lib/stores.js');

	for (let d = 1; d <= 5; d++) {
		configStore.set({ ...BASE_CONFIG, depth: d });
		mod.runCompile();
	}
	// Sofort prüfen: maximal 1 aktiver Worker (der letzte).
	assert.ok(
		mod.getActiveWorkerCount() <= 1,
		`aktive Worker = ${mod.getActiveWorkerCount()}, erwartet <= 1`,
	);
	// Nach allen Delays darf es auch nicht mehr werden.
	await new Promise((r) => setTimeout(r, 300));
	assert.ok(
		mod.getActiveWorkerCount() <= 1,
		`aktive Worker nach Delay = ${mod.getActiveWorkerCount()}, erwartet <= 1`,
	);
});
