// Testscript: Connection (WebSocket-Relay) gegen den Connection-Server.
// Startet einen eigenen Relay-Server (Plain http/ws) und prueft aus Sicht
// eines Exponats (Host) und der Besucher (Gasts), dass JSON relayed wird,
// Seats/PIN greifen und Presence korrekt broadcastet wird.
//
//   npm run test:connection  # nur dieser Test
//   npm run smoke            # kombiniert mit test-api.mjs
import { startServer, req, openWs, wait, makeChecker } from './test-helpers.mjs';

const API_KEY = 'testkey';

const main = async () => {
	const handle = await startServer();
	const checker = makeChecker();
	const { check } = checker;

	// 1) Exponat mintet Token (mit PIN), joint als Host
	const mint = await req('POST', '/api/token', { seats: 2, pin: '1234' }, API_KEY);
	check('mint 201', mint.status === 201);
	const { token } = mint.json;

	const host = await openWs(token, 'host');
	await wait(100);
	check(
		'host joined',
		host.msgs.some((m) => m.type === 'joined' && m.role === 'host'),
	);
	check(
		'host not counted against seats',
		host.msgs.some((m) => m.type === 'joined' && m.seats === 2 && m.occupied === 0),
	);

	// 2) Zwei Gaeste joinen + relay A -> B (und Host empfaengt broadcast)
	const a = await openWs(token, 'guest', '1234');
	const b = await openWs(token, 'guest', '1234');
	await wait(100);
	check(
		'guest A joined',
		a.msgs.some((m) => m.type === 'joined' && m.role === 'guest'),
	);
	check(
		'guest B joined',
		b.msgs.some((m) => m.type === 'joined' && m.role === 'guest'),
	);
	check(
		'presence join broadcast',
		host.msgs.some((m) => m.type === 'presence' && m.event === 'join'),
	);

	a.ws.send(JSON.stringify({ type: 'app', payload: { hello: 'world' } }));
	await wait(100);
	check(
		'relay A->B (app)',
		b.msgs.some((m) => m.type === 'app' && m.payload?.hello === 'world'),
	);
	check(
		'relay A->host (app)',
		host.msgs.some((m) => m.type === 'app' && m.payload?.hello === 'world'),
	);

	// 3) Dritter Gast -> seats_exhausted (Limit 2 Gaeste)
	const c = await openWs(token, 'guest', '1234');
	await wait(100);
	check(
		'seat limit enforced (seats_exhausted)',
		c.ws._closed !== undefined && c.ws._closed.c !== undefined,
	);
	c.ws.close?.();

	// 4) Falsche PIN -> pin_mismatch
	const wrong = await openWs(token, 'guest', '9999');
	await wait(100);
	check('wrong pin rejected', wrong.ws._closed !== undefined);
	wrong.ws.close?.();

	// 5) PIN-Rotation invalidiert alten PIN. Hinweis: der falsche PIN aus
	//    Schritt 4 + der alte PIN hier loesen den Backoff-Lock aus (grace=1),
	//    darum vor dem korrekten neuen PIN die Sperre abwarten.
	const rot = await req('PATCH', `/api/token/${token}/pin`, { pin: '5555' }, API_KEY);
	check('pin rotation ok', rot.status === 200);
	const oldPin = await openWs(token, 'guest', '1234');
	await wait(100);
	check('old pin now rejected', oldPin.ws._closed !== undefined);
	oldPin.ws.close?.();
	a.ws.close();
	b.ws.close();
	await wait(150);
	await wait(700); // PIN-Backoff-Sperre (baseMs=500) ablaufen lassen
	const newPin = await openWs(token, 'guest', '5555');
	await wait(100);
	check(
		'new pin accepted',
		newPin.msgs.some((m) => m.type === 'joined'),
	);

	// 6) Presence leave broadcast beim Disconnect (newPin ist der einzige Gast)
	const beforeLeave = host.msgs.filter((m) => m.type === 'presence').length;
	newPin.ws.close();
	await wait(120);
	const hostPresence = host.msgs.filter((m) => m.type === 'presence');
	check(
		'presence leave broadcast',
		hostPresence.length > beforeLeave && hostPresence.some((m) => m.event === 'leave'),
	);

	// 7) PIN-Brute-Force-Backoff (frischer Token, grace=1)
	const bt = await req('POST', '/api/token', { seats: 4, pin: '0000' }, API_KEY);
	const btok = bt.json?.token;
	check('backoff token minted', !!btok);
	const w1 = await openWs(btok, 'guest', '1111');
	await wait(80);
	const w2 = await openWs(btok, 'guest', '2222');
	await wait(80);
	const w3 = await openWs(btok, 'guest', '3333');
	await wait(80);
	const codeOf = (ws) => ws.msgs.find((m) => m.type === 'error')?.code;
	check('pin mismatch #1', codeOf(w1) === 'pin_mismatch');
	check('pin mismatch #2', codeOf(w2) === 'pin_mismatch');
	check('pin locked #3', codeOf(w3) === 'pin_locked');
	await wait(700);
	const ok = await openWs(btok, 'guest', '0000');
	await wait(120);
	check(
		'correct pin joins after lock',
		ok.msgs.some((m) => m.type === 'joined'),
	);
	w1.ws.close?.();
	w2.ws.close?.();
	w3.ws.close?.();
	ok.ws.close?.();

	host.ws.close();
	await wait(100);
	await handle.stop();
	const failed = checker.failures;
	console.log(
		failed === 0 ? '\nCONNECTION TESTS: ALL PASS' : `\nCONNECTION TESTS: ${failed} FAILURE(S)`,
	);
	process.exit(failed === 0 ? 0 : 1);
};

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
