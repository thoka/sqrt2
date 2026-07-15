// Unit-Tests für den Netzwerk-Transport / die Session-Helfer
// (src/lib/connection.js, CONNECTION_SERVICE_SPEC.md §6 + §12 3/4).
// Live-WS-Relay-Tests liegen in infra/connection-service/test-*.mjs;
// hier werden die clientseitigen Bausteine (URL-Bau, REST-Helfer mit
// gemocktem fetch, WS-Room-Dispatch mit gemocktem WebSocket) geprüft.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildWsUrl,
	buildGuestLink,
	randomPin,
	mintHostToken,
	rotatePin,
	revokeToken,
	createWsRoom,
} from '../../src/lib/connection.js';

after(() => {
	// keine offenen Handles
});

// --- buildWsUrl ----------------------------------------------------------
test('buildWsUrl: hängt token/role/pin als Query an', () => {
	const u = buildWsUrl('wss://host:8080/ws', { token: 'ABC', role: 'host', pin: '1234' });
	const p = new URL(u);
	assert.equal(p.pathname, '/ws');
	assert.equal(p.searchParams.get('token'), 'ABC');
	assert.equal(p.searchParams.get('role'), 'host');
	assert.equal(p.searchParams.get('pin'), '1234');
});

test('buildWsUrl: PIN wird weggelassen, wenn null', () => {
	const u = buildWsUrl('ws://h/ws', { token: 'T', role: 'guest', pin: null });
	assert.equal(new URL(u).searchParams.has('pin'), false);
});

// --- buildGuestLink -------------------------------------------------------
test('buildGuestLink: baut relativen Pfad + ws/token/pin-Parameter', () => {
	const link = buildGuestLink({
		pageOrigin: 'https://exhibit.example',
		pagePath: '/sqrt2/remote-control.html',
		wsUrl: 'wss://relay:8080/ws',
		token: 'TOK',
		pin: '99',
	});
	const p = new URL(link);
	assert.equal(p.origin, 'https://exhibit.example');
	assert.equal(p.pathname, '/sqrt2/remote-control.html');
	assert.equal(p.searchParams.get('ws'), 'wss://relay:8080/ws');
	assert.equal(p.searchParams.get('token'), 'TOK');
	assert.equal(p.searchParams.get('pin'), '99');
});

// --- randomPin -----------------------------------------------------------
test('randomPin: liefert Ziffern-String der gewünschten Länge', () => {
	for (const len of [4, 6]) {
		const pin = randomPin(len);
		assert.equal(pin.length, len);
		assert.match(pin, /^[0-9]+$/);
	}
});

// --- REST-Helfer (gemocktes fetch) --------------------------------------
function mockFetch(handler) {
	const real = globalThis.fetch;
	globalThis.fetch = handler;
	return () => {
		globalThis.fetch = real;
	};
}

test('mintHostToken: POST /api/token mit Bearer + Body', async () => {
	let captured = null;
	const restore = mockFetch(async (url, opts) => {
		captured = { url, opts };
		return {
			ok: true,
			json: async () => ({
				token: 'T1',
				wsUrl: 'wss://h/ws',
				seats: 4,
				pin: '12',
				expiresAt: null,
			}),
		};
	});
	try {
		const r = await mintHostToken({
			baseUrl: 'https://h:8080/',
			apiKey: 'KEY',
			seats: 4,
			pin: '12',
		});
		assert.equal(r.token, 'T1');
		assert.equal(captured.url, 'https://h:8080/api/token');
		assert.equal(captured.opts.method, 'POST');
		assert.equal(captured.opts.headers.authorization, 'Bearer KEY');
		assert.equal(JSON.parse(captured.opts.body).pin, '12');
	} finally {
		restore();
	}
});

test('mintHostToken: wirft bei !ok mit Server-Fehler', async () => {
	const restore = mockFetch(async () => ({
		ok: false,
		status: 401,
		json: async () => ({ error: 'no_api_key' }),
	}));
	try {
		await assert.rejects(() => mintHostToken({ baseUrl: 'https://h', apiKey: 'x' }), /no_api_key/);
	} finally {
		restore();
	}
});

test('rotatePin: PATCH /api/token/:token/pin', async () => {
	let captured = null;
	const restore = mockFetch(async (url, opts) => {
		captured = { url, opts };
		return { ok: true, json: async () => ({ ok: true, pin: '55' }) };
	});
	try {
		const r = await rotatePin({ baseUrl: 'https://h/', apiKey: 'K', token: 'T', pin: '55' });
		assert.equal(r.pin, '55');
		assert.equal(captured.url, 'https://h/api/token/T/pin');
		assert.equal(captured.opts.method, 'PATCH');
		assert.equal(JSON.parse(captured.opts.body).pin, '55');
	} finally {
		restore();
	}
});

test('revokeToken: DELETE /api/token/:token', async () => {
	let captured = null;
	const restore = mockFetch(async (url, opts) => {
		captured = { url, opts };
		return { ok: true, json: async () => ({ ok: true }) };
	});
	try {
		await revokeToken({ baseUrl: 'https://h', apiKey: 'K', token: 'T' });
		assert.equal(captured.url, 'https://h/api/token/T');
		assert.equal(captured.opts.method, 'DELETE');
	} finally {
		restore();
	}
});

// --- createWsRoom (gemocktes WebSocket) ----------------------------------
class FakeSocket {
	constructor(url) {
		this.url = url;
		this.readyState = 0;
		this.sent = [];
		this.closed = false;
		FakeSocket.instances.push(this);
	}
	open() {
		this.readyState = 1;
		this.onopen && this.onopen();
	}
	send(d) {
		if (this.readyState === 1) this.sent.push(d);
	}
	close() {
		this.closed = true;
		this.readyState = 3;
		this.onclose && this.onclose();
	}
}
FakeSocket.instances = [];

let realWs;
before(() => {
	realWs = globalThis.WebSocket;
	globalThis.WebSocket = FakeSocket;
});
after(() => {
	globalThis.WebSocket = realWs;
	FakeSocket.instances = [];
});

test('createWsRoom: postet erst nach open als app-Frame (Queueing)', () => {
	FakeSocket.instances = [];
	const room = createWsRoom({ url: 'ws://h/ws?token=T&role=host' });
	room.post({ type: 'update', key: 'config', value: { x: 1 }, seq: 1 });
	const sock = FakeSocket.instances.at(-1);
	assert.equal(sock.sent.length, 0, 'vor open darf nichts gesendet werden');
	sock.open();
	assert.equal(sock.sent.length, 1);
	const frame = JSON.parse(sock.sent[0]);
	assert.equal(frame.type, 'app');
	assert.deepEqual(frame.payload, { type: 'update', key: 'config', value: { x: 1 }, seq: 1 });
	room.close();
});

test('createWsRoom: eingehende app-Payloads erreichen onMessage-Receiver', () => {
	FakeSocket.instances = [];
	const room = createWsRoom({ url: 'ws://h/ws?token=T' });
	room.post({ type: 'request', key: 'config' }); // erzwingt connect() -> Socket
	const got = [];
	room.onMessage((msg) => got.push(msg));
	const sock = FakeSocket.instances.at(-1);
	sock.open();
	sock.onmessage({
		data: JSON.stringify({
			type: 'app',
			payload: { type: 'update', key: 'config', value: { x: 2 }, seq: 2 },
		}),
	});
	assert.deepEqual(got, [{ type: 'update', key: 'config', value: { x: 2 }, seq: 2 }]);
	room.close();
});

test('createWsRoom: presence/error melden via onStatus', () => {
	FakeSocket.instances = [];
	const events = [];
	const room = createWsRoom({
		url: 'ws://h/ws?token=T',
		onStatus: (s, d) => events.push([s, d]),
	});
	room.post({ type: 'request', key: 'config' }); // erzwingt connect()
	const sock = FakeSocket.instances.at(-1);
	sock.open();
	sock.onmessage({ data: JSON.stringify({ type: 'presence', event: 'join', occupied: 2 }) });
	sock.onmessage({ data: JSON.stringify({ type: 'error', code: 'pin_mismatch' }) });
	assert.deepEqual(events.at(-2), ['presence', { type: 'presence', event: 'join', occupied: 2 }]);
	assert.deepEqual(events.at(-1), ['error', { type: 'error', code: 'pin_mismatch' }]);
	room.close();
});
