// mathJaxImageCache.js — PERSISTENTER Cache (IndexedDB) für die von
// MathJax gerenderten Achsen-Beschriftungs-SVGs (siehe mathJaxRenderer.js/
// mathJaxLabelCache.js). Überlebt Seiten-Reloads: "Das sollte beim zweiten
// Aufruf der Seite ja alles im Cache sein" (docs/Beschriftung.md) - beim
// ersten Besuch rendert MathJax jeden neuen Ausdruck einmal, ab dem
// zweiten Besuch (gleiches Gerät) kommen alle bereits gesehenen Ausdrücke
// direkt aus IndexedDB, MathJax muss dafür nicht mehr laufen.
const DB_NAME = 'sqrt2-mathjax-cache';
const STORE = 'labels';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
	if (dbPromise) return dbPromise;
	if (typeof indexedDB === 'undefined') return (dbPromise = Promise.resolve(null));
	dbPromise = new Promise((resolve) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(STORE);
		};
		req.onsuccess = () => resolve(req.result);
		// IndexedDB ist eine Optimierung, kein Korrektheits-Erfordernis - bei
		// Fehler (z.B. privater Modus ohne Storage) einfach ohne Persistenz
		// weiterlaufen (nur der In-Memory-Cache aus mathJaxLabelCache.js
		// bleibt, jeder Seitenaufruf rendert dann neu).
		req.onerror = () => resolve(null);
	});
	return dbPromise;
}

export async function getPersistedSvg(key) {
	const db = await openDb();
	if (!db) return null;
	return new Promise((resolve) => {
		const tx = db.transaction(STORE, 'readonly');
		const req = tx.objectStore(STORE).get(key);
		req.onsuccess = () => resolve(req.result ?? null);
		req.onerror = () => resolve(null);
	});
}

export async function putPersistedSvg(key, svgString) {
	const db = await openDb();
	if (!db) return;
	return new Promise((resolve) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).put(svgString, key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => resolve();
	});
}
