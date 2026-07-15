// Unit-Tests für den BroadcastChannel-Sync-Adapter (TOOLING_SPEC.md Phase 5).
// Node 18+ stellt BroadcastChannel global bereit, daher lässt sich der reale
// Transport zwischen zwei Stores in einem Prozess testen (jeder Store bekommt
// seinen eigenen Kanalnamen, damit die Tests isoliert laufen).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writable } from 'svelte/store';
import { syncedStore, closeAllSync } from '../../src/lib/syncedStore.js';

// Offene BroadcastChannel-Kanäle würden den Node-Prozess am Leben halten.
after(() => closeAllSync());

function uniqueChannel() {
	return 'unit-' + Math.random().toString(36).slice(2);
}

// Liefert den aktuellen Wert eines Stores (subscribe+sofort-unsub).
function snapshot(store) {
	let v;
	store.subscribe((x) => {
		v = x;
	})();
	return v;
}

test('syncedStore: lokale Änderung erreicht den Peer-Store (config-Richtung)', async () => {
	const ch = uniqueChannel();
	const a = writable({ base: 10 });
	const b = writable({ base: 10 });
	syncedStore(a, 'cfg', ch);
	syncedStore(b, 'cfg', ch);

	a.set({ base: 7 });
	await new Promise((r) => setTimeout(r, 60));
	assert.equal(snapshot(b).base, 7);
});

test('syncedStore: Änderung am Peer wird zurückgespielt (beide Richtungen)', async () => {
	const ch = uniqueChannel();
	const a = writable({ base: 10 });
	const b = writable({ base: 10 });
	syncedStore(a, 'cfg', ch);
	syncedStore(b, 'cfg', ch);

	a.set({ base: 7 });
	await new Promise((r) => setTimeout(r, 60));
	assert.equal(snapshot(b).base, 7);

	b.set({ base: 2 });
	await new Promise((r) => setTimeout(r, 60));
	assert.equal(snapshot(a).base, 2);
});

test('syncedStore: benutzerdefinierter Transport (WS-Relay-Ersatz) sync beide Richtungen', async () => {
	// Loopback-Transport: post() liefert an alle registrierten Receiver
	// (inkl. des eigenen) - simuliert einen Relay, der an alle Raum-
	// Mitglieder broadcastet. Beweist, dass syncedStore beliebige
	// Transport-Objekte {post,onMessage,close} annimmt (Connection-Service,
	// Spec §12 Schritt 3), nicht nur BroadcastChannel.
	function loopback() {
		const cbs = new Set();
		return {
			post: (m) => {
				for (const cb of cbs) cb(m);
			},
			onMessage: (cb) => cbs.add(cb),
			close: () => {},
		};
	}
	const t = loopback();
	const a = writable({ base: 10 });
	const b = writable({ base: 10 });
	syncedStore(a, 'cfg', [t]);
	syncedStore(b, 'cfg', [t]);

	a.set({ base: 7 });
	await new Promise((r) => setTimeout(r, 40));
	assert.equal(snapshot(b).base, 7);

	b.set({ base: 3 });
	await new Promise((r) => setTimeout(r, 40));
	assert.equal(snapshot(a).base, 3);
});

test('syncedStore: ohne BroadcastChannel bleibt der Store lokal nutzbar', () => {
	// simuliert die SSR/Node-Ohne-Channel-Situation, indem wir den Konstruktor
	// kurzzeitig ausblenden - der Store darf dann nicht brechen.
	const orig = globalThis.BroadcastChannel;
	globalThis.BroadcastChannel = undefined;
	try {
		const s = writable({ x: 1 });
		syncedStore(s, 'k', uniqueChannel());
		s.set({ x: 9 });
		assert.equal(snapshot(s).x, 9);
	} finally {
		globalThis.BroadcastChannel = orig;
	}
});
