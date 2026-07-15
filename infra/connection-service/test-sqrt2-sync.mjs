// Integrationstest: sqrt2-Store-Sync über das ECHTE Relay (End-to-End).
// Beweist, dass die Transport-Abstraktion (syncedStore.js + connection.js)
// tatsächlich durch den Relay-Server relayed - nicht nur im Loopback.
//
// Startet einen echten Relay-Server (Plain http/ws), mintet ein Token,
// baut eine Host- und eine Gast-Seite auf (je configStore + playbackStore,
// gekapselt via syncedStore + createWsRoom) und prüft, dass Änderungen auf
// beiden Seiten synchron ankommen (BroadcastChannel als Fast-Path ist hier
// bewusst NICHT im Spiel - reine Netzwerk-Verbindung).
//
//   node test-sqrt2-sync.mjs   (aus infra/connection-service/)
import { startServer, wait, makeChecker } from './test-helpers.mjs';
import { WebSocket } from 'ws';
import { writable } from 'svelte/store';
import { syncedStore } from '../../src/lib/syncedStore.js';
import { createWsRoom, mintHostToken, buildWsUrl } from '../../src/lib/connection.js';

// connection.js nutzt globalThis.WebSocket - im Browser vorhanden, hier mit
// dem node-fähigen `ws` füllen.
globalThis.WebSocket = WebSocket;

const API_KEY = 'testkey';

// Snapshot eines Stores (subscribe + sofort unsub).
function snap(store) {
	let v;
	store.subscribe((x) => {
		v = x;
	})();
	return v;
}

// Eröffnet einen WsRoom und liefert ein Promise, das erst auflöst, wenn die
// Verbindung offen ist (sonst würden erste Änderungen in der Queue hängen
// bleiben und der Gast würde sie verpassen).
function openRoom(url) {
	return new Promise((resolve) => {
		const room = createWsRoom({
			url,
			onStatus: (s) => {
				if (s === 'open' || s === 'joined') resolve(room);
			},
		});
		// erste post() triggert connect()
		room.post({ type: 'request', key: '_probe' });
	});
}

const main = async () => {
	const handle = await startServer();
	const checker = makeChecker();
	const { check } = checker;

	// 1) Exponat mintet Token (ohne PIN, 4 Seats)
	const mint = await mintHostToken({
		baseUrl: `http://localhost:${process.env.PORT ?? 8099}`,
		apiKey: API_KEY,
		seats: 4,
		pin: null,
		label: 'sqrt2-e2e',
	});
	check('token gemintet', !!mint.token && !!mint.wsUrl);

	// 2) Host-Seite (config + playback) an den Relay-Raum binden
	const hostWs = buildWsUrl(mint.wsUrl, { token: mint.token, role: 'host' });
	const hostRoom = await openRoom(hostWs);
	const hostConfig = writable({ base: 10, depth: 16 });
	const hostPlayback = writable({ time: 0, isPlaying: false });
	syncedStore(hostConfig, 'config', [hostRoom]);
	syncedStore(hostPlayback, 'playback', [hostRoom]);

	// 3) Gast-Seite (eigenes Fenster/Gerät) am selben Token binden
	const guestWs = buildWsUrl(mint.wsUrl, { token: mint.token, role: 'guest' });
	const guestRoom = await openRoom(guestWs);
	const guestConfig = writable({ base: 10, depth: 16 });
	const guestPlayback = writable({ time: 0, isPlaying: false });
	syncedStore(guestConfig, 'config', [guestRoom]);
	syncedStore(guestPlayback, 'playback', [guestRoom]);

	// beide Seiten müssen offen sein, bevor wir Änderungen schicken
	await wait(200);

	// 4) Host -> Gast: configStore-Änderung relayed
	hostConfig.set({ base: 7, depth: 9 });
	await wait(200);
	check('Host->Gast: config.base=7', snap(guestConfig).base === 7 && snap(guestConfig).depth === 9);

	// 5) Gast -> Host: playbackStore-Änderung relayed (bidirektional)
	guestPlayback.update((p) => ({ ...p, time: 3.5, isPlaying: true }));
	await wait(200);
	check('Gast->Host: playback.time=3.5', snap(hostPlayback).time === 3.5 && snap(hostPlayback).isPlaying === true);

	// 6) Zweite Gast-Seite konvergiert auf den Stand der ersten (Initial-State
	//    via Handshake request/state)
	const guest2Room = await openRoom(guestWs);
	const guest2Config = writable({ base: 10, depth: 16 });
	syncedStore(guest2Config, 'config', [guest2Room]);
	await wait(250);
	check('Neuer Gast holt sich aktuellen Stand (base=7)', snap(guest2Config).base === 7);

	// 7) Aufräumen
	hostRoom.close();
	guestRoom.close();
	guest2Room.close();
	await wait(100);
	await handle.stop();

	const failed = checker.failures;
	console.log(failed === 0 ? '\nSQRT2-SYNC E2E: ALL PASS' : `\nSQRT2-SYNC E2E: ${failed} FAILURE(S)`);
	process.exit(failed === 0 ? 0 : 1);
};

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
