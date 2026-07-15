// Fensterübergreifender Sync für writable-Stores über BroadcastChannel
// (TOOLING_SPEC.md Phase 5, §3.3). Bewusst NICHT für compiledStore (siehe
// Spec §3.1: das Neu-Berechnen aus dem kleinen configStore ist schnell und
// deterministisch, die Übertragung der riesigen bank_pieces-Ergebnisse wäre
// es nicht). Nur configStore + playbackStore werden synchronisiert.
//
// Echo-Zyklen werden vermieden: lokale Änderungen (set/update) werden
// gepostet; eingehende Nachrichten werden mit einem Guard-Flag gesetzt, das
// ein erneutes Posten unterdrückt. Fehlt BroadcastChannel (z.B. SSR/Node),
// ist der Store ein normaler lokaler Store - kein Fehler, kein Sync.
//
// Handshake: ein neuer Tab fragt per {type:'request'} nach dem aktuellen
// Zustand; bestehende Peers antworten mit {type:'state'}. So konvergiert ein
// frisch geöffneter Tab sofort auf den Stand der schon laufenden Tabs.
//
// Kollisionsschutz: jede Änderung trägt eine monoton steigende Sequenz-
// nummer (pro Store). Eingehende Nachrichten werden NUR übernommen, wenn
// ihre Seq größer ist als die lokale - so wird eine frische lokale Änderung
// nicht durch den verzögerten "Initial-State" eines neu geöffneten Tabs
// überschrieben (klassisches Last-Writer-Wins mit Lamport-artiger Ordnung).
//
// UNIFIED TRANSPORT (seit Connection-Service, Spec §12 Schritt 3): ein Store
// kann über MEHRERE Transporte synchronisiert werden (BroadcastChannel als
// Same-Browser-Fast-Path + WebSocket-Relay für Cross-Device). Jeder Transport
// erfüllt dieselbe schmale Schnittstelle `{ post(msg), onMessage(cb), close() }`
// - der Adapter kennt keinen spezifischen Transport, nur diese drei Methoden.
// So ist später ein weiterer Transport (Firebase o.ä.) ohne Komponenten-
// Änderung anbindbar (TOOLING_SPEC.md §3.3 "der Adapter ist der einzige Ort,
// der den Transport kennt").
import { configStore, playbackStore } from './stores.js';

const CHANNEL = 'sqrt2-state';

// Getrackte offene Kanäle - nur für Test-Teardown (closeAllSync()), damit
// ein offener BroadcastChannel den Node-Prozess nicht am Leben hält.
const openChannels = new Set();

function openChannel(name) {
	try {
		return new BroadcastChannel(name);
	} catch {
		return null;
	}
}

// BroadcastChannel als Transport-Kapsel (mehrere Receiver möglich, damit
// mehrere Stores denselben Kanalnamen teilen können - jeder BroadcastChannel
// ist eine eigene Instanz, BroadcastChannel liefert niemals an die postende
// Instanz selbst zurück, Echo-Zyklen sind damit ausgeschlossen).
function broadcastTransport(channel) {
	const cbs = new Set();
	channel.onmessage = (e) => {
		for (const cb of cbs) cb(e.data);
	};
	return {
		post: (m) => {
			try {
				channel.postMessage(m);
			} catch {
				/* ignore */
			}
		},
		onMessage: (cb) => {
			cbs.add(cb);
			return () => cbs.delete(cb);
		},
		close: () => channel.close(),
	};
}

// Pro-Store-Adapter-Zustand (über WeakMap, damit der Store nicht verändert
// werden muss außer den bewusst überschriebenen set/update).
const adapterState = new WeakMap();

function broadcastLocal(st, msg) {
	for (const t of st.transports) {
		try {
			t.post(msg);
		} catch {
			/* ignore transport failure */
		}
	}
}

function handleIncoming(st, msg) {
	if (!msg || msg.key !== st.key) return;
	if (msg.type === 'request') {
		// Ein Peer fragt nach dem aktuellen Zustand - mit dem Snapshot antworten.
		let snapshot;
		const unsub = st.store.subscribe((v) => {
			snapshot = v;
		});
		unsub();
		broadcastLocal(st, { type: 'state', key: st.key, value: snapshot, seq: st.seq });
		return;
	}
	// 'state' (Antwort auf unser request) oder 'update' (Peer hat sich
	// geändert) -> nur übernehmen, wenn die Nachricht neuer ist als unser
	// lokaler Stand (verhindert das Überschreiben einer frischen lokalen
	// Änderung durch verzögerten Initial-State eines neuen Tabs/Peers).
	if (typeof msg.seq === 'number' && msg.seq <= st.seq) return;
	st.seq = msg.seq;
	st.applyingRemote = true;
	st.store.set(msg.value);
	st.applyingRemote = false;
}

function ensureAdapter(store, key) {
	let st = adapterState.get(store);
	if (!st) {
		st = { store, key, transports: new Set(), seq: 0, applyingRemote: false };
		adapterState.set(store, st);
		const origSet = store.set.bind(store);
		const origUpdate = store.update.bind(store);
		store.set = (value) => {
			const r = origSet(value);
			if (!st.applyingRemote) broadcastLocal(st, { type: 'update', key, value, seq: ++st.seq });
			return r;
		};
		store.update = (fn) => {
			let next;
			const r = origUpdate((cur) => {
				next = fn(cur);
				return next;
			});
			if (!st.applyingRemote)
				broadcastLocal(st, { type: 'update', key, value: next, seq: ++st.seq });
			return r;
		};
	}
	return st;
}

// Normalisiert das dritte Argument zu einer Liste von Transport-Objekten:
// String -> BroadcastChannel (dieser Name), Array -> gemischt (String oder
// Transport-Objekt), undefined -> Default-Kanal.
function normalizeTransports(channelOrTransports) {
	if (Array.isArray(channelOrTransports)) {
		return channelOrTransports
			.map((x) => (typeof x === 'string' ? bcTransportFromName(x) : x))
			.filter(Boolean);
	}
	if (typeof channelOrTransports === 'string') {
		const t = bcTransportFromName(channelOrTransports);
		return t ? [t] : [];
	}
	return [];
}

function bcTransportFromName(name) {
	const ch = openChannel(name);
	if (!ch) return null;
	openChannels.add(ch);
	return broadcastTransport(ch);
}

// Umhüllt einen existierenden writable-Store mit Sync über einen oder mehrere
// Transporte. Gibt denselben Store zurück. Idempotent pro (Store, Transport):
// ein bereits angebundener Transport wird nicht doppelt registriert.
export function syncedStore(store, key, channelOrTransports = CHANNEL) {
	const st = ensureAdapter(store, key);
	const transports = normalizeTransports(channelOrTransports);
	let added = false;
	for (const t of transports) {
		if (st.transports.has(t)) continue;
		st.transports.add(t);
		t.onMessage((msg) => handleIncoming(st, msg));
		added = true;
	}
	if (added) {
		// Peers (gleicher Browser via BC, Cross-Device via Relay) nach dem
		// aktuellen Zustand fragen, damit wir sofort konvergieren.
		broadcastLocal(st, { type: 'request', key });
	}
	return store;
}

let initializedBC = false;
// Bindet configStore + playbackStore einmalig an den BroadcastChannel-Sync.
// Idempotent (pro Seite/Modul-Instanz) - kann bedenkenlos aus mehreren
// Entry-Points (index.html, remote-control.html) aufgerufen werden.
export function initSync() {
	if (initializedBC) return;
	initializedBC = true;
	syncedStore(configStore, 'config', CHANNEL);
	syncedStore(playbackStore, 'playback', CHANNEL);
}

// Bindet configStore + playbackStore an EINEN gemeinsamen Netzwerk-Transport
// (z.B. die WebSocket-Verbindung zum Relay, siehe connection.js). Beide
// Stores teilen sich dieselbe Verbindung; eingehende Payloads werden vom
// Transport an beide Stores weitergegeben, jeder filtert selbst nach `key`.
// Ein erneuter Aufruf mit einem NEUEN Transport entfernt den alten zuerst
// (damit eine neue Sitzung die alte ersetzt, ohne doppelt zu broadcasten).
let networkTransport = null;
export function initNetworkSync(transport) {
	if (networkTransport === transport) return;
	if (networkTransport) {
		const a = adapterState.get(configStore);
		const b = adapterState.get(playbackStore);
		if (a) a.transports.delete(networkTransport);
		if (b) b.transports.delete(networkTransport);
		try {
			networkTransport.close();
		} catch {
			/* ignore */
		}
	}
	networkTransport = transport;
	syncedStore(configStore, 'config', [transport]);
	syncedStore(playbackStore, 'playback', [transport]);
}

// Schließt alle offenen Sync-Kanäle. Nur für Tests nötig (ein offener
// BroadcastChannel hält den Node-Prozess am Leben); im Browser bleiben die
// Kanäle für die Laufzeit der Seite offen.
export function closeAllSync() {
	for (const c of openChannels) c.close();
	openChannels.clear();
}
