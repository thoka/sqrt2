// Web Worker: Compile-Job. Bekommt { jobId, config }, rechnet den teuren
// Teil (compileSystemData) im Worker-Thread und postet das rein
// strukturierbare Ergebnis zurück. Closures (finalizeCompiled) werden
// bewusst NICHT hier gebaut - das passiert im Main-Thread-Orchestrator
// (compileOrchestrator.js), damit die Worker-Antwort per structuredClone
// transportabel bleibt.
import { compileSystemData } from './compiler.js';

self.onmessage = (ev) => {
	const { jobId, config } = ev.data;
	try {
		const data = compileSystemData(config);
		self.postMessage({ jobId, ok: true, data });
	} catch (err) {
		self.postMessage({
			jobId,
			ok: false,
			error: err && err.message ? err.message : String(err),
		});
	}
};
