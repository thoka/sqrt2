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

// Umhüllt einen existierenden writable-Store mit Sync. Gibt denselben Store
// zurück (set/update werden so überschrieben, dass sie broadcasten).
// `channelName` ist parameterisierbar, damit Unit-Tests isoliert arbeiten
// können; der Default 'sqrt2-state' ist der Produktions-Kanal (Spec §3.3).
export function syncedStore(store, key, channelName = CHANNEL) {
	const channel = openChannel(channelName);
	if (!channel) return store; // kein BroadcastChannel -> lokal wie vorher
	openChannels.add(channel);

	let seq = 0;
	let applyingRemote = false;

	channel.onmessage = (e) => {
		const msg = e.data;
		if (!msg || msg.key !== key) return;
		if (msg.type === 'request') {
			// Ein Peer fragt nach dem aktuellen Zustand - mit dem Snapshot antworten.
			let snapshot;
			const unsub = store.subscribe((v) => {
				snapshot = v;
			});
			unsub();
			channel.postMessage({ type: 'state', key, value: snapshot, seq });
			return;
		}
		// 'state' (Antwort auf unser request) oder 'update' (Peer hat sich
		// geändert) -> nur übernehmen, wenn die Nachricht neuer ist als unser
		// lokaler Stand (verhindert das Überschreiben einer frischen lokalen
		// Änderung durch verzögerten Initial-State eines neuen Tabs).
		if (typeof msg.seq === 'number' && msg.seq <= seq) return;
		seq = msg.seq;
		applyingRemote = true;
		store.set(msg.value);
		applyingRemote = false;
	};

	// Bestehende Peers nach ihrem aktuellen Zustand fragen.
	channel.postMessage({ type: 'request', key });

	const origSet = store.set.bind(store);
	store.set = (value) => {
		const r = origSet(value);
		if (!applyingRemote) channel.postMessage({ type: 'update', key, value, seq: ++seq });
		return r;
	};
	const origUpdate = store.update.bind(store);
	store.update = (fn) => {
		let next;
		const r = origUpdate((cur) => {
			next = fn(cur);
			return next;
		});
		if (!applyingRemote) channel.postMessage({ type: 'update', key, value: next, seq: ++seq });
		return r;
	};
	return store;
}

let initialized = false;
// Bindet configStore + playbackStore einmalig an den Sync-Kanal. Idempotent
// (pro Seite/Modul-Instanz) - kann bedenkenlos aus mehreren Entry-Points
// (sqrt2.html, remote-control.html) aufgerufen werden.
export function initSync() {
	if (initialized) return;
	initialized = true;
	syncedStore(configStore, 'config', CHANNEL);
	syncedStore(playbackStore, 'playback', CHANNEL);
}

// Schließt alle offenen Sync-Kanäle. Nur für Tests nötig (ein offener
// BroadcastChannel hält den Node-Prozess am Leben); im Browser bleiben die
// Kanäle für die Laufzeit der Seite offen.
export function closeAllSync() {
	for (const c of openChannels) c.close();
	openChannels.clear();
}
