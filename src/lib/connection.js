// Netzwerk-Transport für den Cross-Device-Sync (CONNECTION_SERVICE_SPEC.md
// §6 + §12 Schritt 3/4). Stellt dieselbe schmale Schnittstelle bereit wie
// der BroadcastChannel-Adapter in syncedStore.js: `{ post(msg), onMessage(cb),
// close() }`. Mehrere Stores (configStore + playbackStore) teilen sich über
// EINE WsRoom-Instanz dieselbe WebSocket-Verbindung; eingehende `app`-
// Payloads werden an alle registrierten Receiver weitergegeben (jeder Store
// filtert selbst nach `msg.key`, siehe syncedStore.js).
//
// Der Relay ist "dumm" (Spec §2): er versteht nur joined/presence/app/error
// und broadcastet `app`-Nachrichten an alle Raum-Mitglieder. Unsere
// syncedStore-Nachrichten (request/state/update mit `key`+`seq`) reisen als
// `payload` eines `app`-Frames - die Anwendungssemantik liegt vollständig
// beim Client, identisch zur BroadcastChannel-Logik.
//
// Bewusst kein DOM-Zugriff außer `WebSocket`/`fetch`/`URL` - damit das Modul
// wie compiler.js/bank-core.js per node --test testbar ist (die live WS-
// Verbindung wird in den Connection-Service-Tests abgedeckt).

// Baut die vollständige WS-URL inkl. Token/Role/PIN (Query-Parameter gemäß
// Spec §6). `baseWsUrl` ist die vom Relay gelieferte `wsUrl` (z.B.
// `wss://host/ws`) - der Pfad `/ws` bleibt erhalten.
export function buildWsUrl(baseWsUrl, { token, role = 'guest', pin = null } = {}) {
	const u = new URL(baseWsUrl);
	u.searchParams.set('token', token);
	u.searchParams.set('role', role);
	if (pin != null) u.searchParams.set('pin', pin);
	return u.toString();
}

// Gast-Link (für den QR-Code): öffnet die Svelte-Fernsteuerung auf
// demselben Deployment wie das Haupttool, aber verbindet per WS mit dem
// Relay. `pageOrigin` ist i.d.R. `location.origin`, der Pfad wird relativ
// zur aktuellen Seite aufgelöst (berücksichtigt z.B. `base: '/sqrt2/'`).
export function buildGuestLink({ pageOrigin, pagePath = 'remote.html', wsUrl, token, pin }) {
	const u = new URL(pagePath, pageOrigin);
	u.searchParams.set('ws', wsUrl);
	u.searchParams.set('token', token);
	if (pin != null) u.searchParams.set('pin', pin);
	return u.toString();
}

// Exponat: Join-Token beim Relay minten (POST /api/token, Bearer API_KEY).
// Liefert `{ token, wsUrl, seats, pin, expiresAt }`.
export async function mintHostToken({ baseUrl, apiKey, seats = 4, pin = null, label = null }) {
	const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({ seats, pin, label }),
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.error || `mint_failed_${res.status}`);
	}
	return res.json();
}

// PIN rotieren (Host via API-Key): PATCH /api/token/:token/pin.
export async function rotatePin({ baseUrl, apiKey, token, pin }) {
	const res = await fetch(
		`${baseUrl.replace(/\/$/, '')}/api/token/${encodeURIComponent(token)}/pin`,
		{
			method: 'PATCH',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
			body: JSON.stringify({ pin }),
		},
	);
	if (!res.ok) throw new Error(`pin_rotate_failed_${res.status}`);
	return res.json();
}

// Token widerrufen (Host via API-Key): DELETE /api/token/:token.
export async function revokeToken({ baseUrl, apiKey, token }) {
	const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/token/${encodeURIComponent(token)}`, {
		method: 'DELETE',
		headers: { authorization: `Bearer ${apiKey}` },
	});
	if (!res.ok) throw new Error(`revoke_failed_${res.status}`);
	return res.json();
}

// Erzeugt eine zufällige PIN (Standard 4–6 Ziffern, siehe Spec §3 F4).
export function randomPin(len = 4) {
	let s = '';
	for (let i = 0; i < len; i++) s += String(Math.floor(Math.random() * 10));
	return s;
}

// Eröffnet EINE WebSocket-Verbindung zum Relay und kapselt sie als Transport.
// `url` ist die vollständige WS-URL (inkl. Token/Role/PIN). `onStatus(s, detail)`
// meldet Verbindungs-/Präsenz-Ereignisse: 'connecting' | 'open' | 'joined'
// (detail = joined-Msg) | 'presence' (detail = presence-Msg, darin
// `occupied`) | 'closed' | 'error' (detail = error-Msg bzw. Reason-String).
// Mehrere Stores registrieren via onMessage() - alle erhalten die `app`-
// Payloads. Outgoing Messages werden gepuffert, bis die Verbindung offen ist.
export function createWsRoom({ url, onStatus } = {}) {
	const receivers = new Set();
	let ws = null;
	let status = 'idle';
	let closed = false;
	let queue = [];

	function setStatus(s, detail) {
		status = s;
		if (onStatus) onStatus(s, detail);
	}

	function sendRaw(msg) {
		if (ws && ws.readyState === 1) {
			try {
				ws.send(JSON.stringify({ type: 'app', payload: msg }));
			} catch {
				/* send failure: ignore */
			}
		}
	}

	function connect() {
		if (closed || ws) return;
		setStatus('connecting');
		let socket;
		try {
			socket = new WebSocket(url);
		} catch (e) {
			setStatus('error', String(e));
			return;
		}
		ws = socket;
		socket.onopen = () => {
			setStatus('open');
			const pending = queue;
			queue = [];
			for (const m of pending) sendRaw(m);
		};
		socket.onmessage = (ev) => {
			let msg;
			try {
				// Browser liefert String, node `ws` ggf. Buffer - beides
				// verarbeitbar (siehe Integrationstest test-sqrt2-sync.mjs).
				const raw = typeof ev.data === 'string' ? ev.data : ev.data.toString();
				msg = JSON.parse(raw);
			} catch {
				return;
			}
			if (msg?.type === 'app' && msg.payload) {
				for (const cb of receivers) cb(msg.payload);
			} else if (msg?.type === 'joined') {
				setStatus('joined', msg);
			} else if (msg?.type === 'presence') {
				setStatus('presence', msg);
			} else if (msg?.type === 'error') {
				setStatus('error', msg);
			}
		};
		socket.onclose = () => {
			ws = null;
			setStatus('closed');
		};
		socket.onerror = () => setStatus('error', 'websocket_error');
	}

	return {
		post(msg) {
			if (ws && ws.readyState === 1) sendRaw(msg);
			else if (!closed) {
				queue.push(msg);
				connect();
			}
		},
		onMessage(cb) {
			receivers.add(cb);
			return () => receivers.delete(cb);
		},
		status: () => status,
		close() {
			closed = true;
			if (ws) ws.close();
			receivers.clear();
		},
	};
}
