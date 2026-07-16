// Testscript: API-Zugang zum Connection-Server (REST).
// Startet einen eigenen Relay-Server (Plain http/ws) und prueft die
// Exponat-Admin-Endpunkte aus Sicht eines Exponats (API-Key) bzw. Admins.
//
//   npm run test:api        # nur dieser Test
//   npm run smoke           # kombiniert mit test-connection.mjs
import { startServer, req, makeChecker } from './test-helpers.mjs';

const API_KEY = 'testkey';
const ADMIN_KEY = 'testadmin';
const ALLOWED = 'https://exhibit.example.com';

const main = async () => {
	const handle = await startServer();
	const checker = makeChecker();
	const { check } = checker;

	// 1) Oeffentliche Endpunkte
	const health = await req('GET', '/health');
	check(
		'health ok + version',
		health.status === 200 && health.json.ok === true && !!health.json.version,
	);

	const status = await req('GET', '/', null, null, { origin: ALLOWED });
	check(
		'status page 200 html',
		status.status === 200 && /text\/html/.test(status.headers.get('content-type')),
	);
	check('status page content', /exhibit-relay/.test(status.text) && /Seats/.test(status.text));
	check(
		'status page cors allowed origin',
		status.headers.get('access-control-allow-origin') === ALLOWED,
	);

	// 2) CORS
	const foreign = await req('GET', '/health', null, null, { origin: 'https://evil.example.com' });
	check('cors foreign origin denied', !foreign.headers.get('access-control-allow-origin'));

	const pre = await fetch(`http://localhost:${process.env.PORT ?? 8099}/api/token`, {
		method: 'OPTIONS',
		headers: { origin: ALLOWED, 'access-control-request-method': 'POST' },
	});
	check(
		'cors preflight 204 + ACAO',
		pre.status === 204 && pre.headers.get('access-control-allow-origin') === ALLOWED,
	);

	// 3) Exponat: Token minten (API-Key)
	const noKey = await req('POST', '/api/token', { seats: 2, pin: '1234' });
	check('mint without api-key -> 401', noKey.status === 401);

	const mint = await req(
		'POST',
		'/api/token',
		{ seats: 2, pin: '1234', label: 'exponat-1' },
		API_KEY,
	);
	check('mint 201', mint.status === 201);
	const { token, seats, pin, wsUrl } = mint.json;
	check('mint seats=2', seats === 2);
	check('mint pin=1234', pin === '1234');
	check('mint returns wsUrl', typeof wsUrl === 'string' && wsUrl.includes('/ws'));

	// 4) Token verifizieren
	const verify = await req('POST', '/api/token/verify', { token }, API_KEY);
	check(
		'verify valid',
		verify.status === 200 && verify.json.valid === true && verify.json.seats === 2,
	);

	const verifyBad = await req('POST', '/api/token/verify', { token: 'nope' });
	check(
		'verify unknown token -> valid:false',
		verifyBad.status === 200 && verifyBad.json.valid === false,
	);

	// 5) PIN rotieren (Host via API-Key)
	const rot = await req('PATCH', `/api/token/${token}/pin`, { pin: '5555' }, API_KEY);
	check('pin rotation 200', rot.status === 200 && rot.json.ok === true && rot.json.pin === '5555');

	// 6) Admin: Liste + Health
	const adminNoKey = await req('GET', '/admin/tokens');
	check('admin gated -> 401', adminNoKey.status === 401);

	const adminList = await req('GET', '/admin/tokens', null, ADMIN_KEY);
	check('admin lists tokens', adminList.status === 200 && Array.isArray(adminList.json.tokens));
	check(
		'admin list enthaelt token',
		adminList.json.tokens.some((t) => t.token === token),
	);

	const adminHealth = await req('GET', '/admin/health', null, ADMIN_KEY);
	check(
		'admin health',
		adminHealth.status === 200 &&
			adminHealth.json.ok === true &&
			typeof adminHealth.json.rooms === 'number',
	);

	// 7) Admin-UI
	const uiNoKey = await req('GET', '/admin');
	check('admin ui gated -> 401', uiNoKey.status === 401);
	const uiKey = await req('GET', `/admin?k=${ADMIN_KEY}`, null, ADMIN_KEY);
	check(
		'admin ui served 200 html',
		uiKey.status === 200 &&
			/text\/html/.test(uiKey.headers.get('content-type')) &&
			/Admin/.test(uiKey.text),
	);

	// 8) Token revoken (Admin + Exponat)
	const revokeExpo = await req('DELETE', `/api/token/${token}`, null, API_KEY);
	check('exponat revoke 200', revokeExpo.status === 200 && revokeExpo.json.ok === true);
	const verifyRevoked = await req('POST', '/api/token/verify', { token });
	check('revoked token invalid', verifyRevoked.json.valid === false);

	const mint2 = await req('POST', '/api/token', { seats: 1 }, API_KEY);
	const t2 = mint2.json.token;
	const adminRevoke = await req('DELETE', `/admin/token/${t2}`, null, ADMIN_KEY);
	check('admin revoke 200', adminRevoke.status === 200 && adminRevoke.json.ok === true);

	// 9) Rate-Limit auf Minting (RATE_LIMIT_MAX=6, bereits 3 Tokens gemintet)
	let rateLimited = 0,
		retryHeaders = 0;
	for (let i = 0; i < 8; i++) {
		const r = await req('POST', '/api/token', { seats: 1 }, API_KEY);
		if (r.status === 429) {
			rateLimited++;
			if (r.headers.get('retry-after')) retryHeaders++;
		}
	}
	check('rate limit triggers 429', rateLimited >= 1);
	check('rate limit returns retry-after', retryHeaders >= 1);

	await handle.stop();
	const failed = checker.failures;
	console.log(failed === 0 ? '\nAPI TESTS: ALL PASS' : `\nAPI TESTS: ${failed} FAILURE(S)`);
	process.exit(failed === 0 ? 0 : 1);
};

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
