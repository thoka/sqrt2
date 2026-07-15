// Smoke-Test für exhibit-relay: Token-Minting, WS-Relay, Seat-Limit, PIN,
// Status-Page, CORS, Admin-UI.
//
// Plain: startet einen eigenen Server (gesteuertes Env) auf PORT.
// TLS:   TLS=1 -> verbindet gegen extern gestarteten Server mit TLS_CERT/TLS_KEY
//        (NODE_TLS_REJECT_UNAUTHORIZED=0). Dann muss der Server extern laufen.
import { spawn } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const TLS = process.env.TLS === '1';
if (TLS) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const WS_PROTO = TLS ? 'wss' : 'ws';
const HTTP_PROTO = TLS ? 'https' : 'http';
const PORT = TLS ? Number(process.env.PORT ?? 8080) : 8099;
const BASE = `${HTTP_PROTO}://localhost:${PORT}`;
const API_KEY = process.env.API_KEYS ?? 'testkey';
const ADMIN_KEY = process.env.ADMIN_KEY ?? 'testadmin';
const ALLOWED = process.env.ALLOWED_ORIGINS ?? 'https://exhibit.example.com';

let server;
async function startServer() {
  if (TLS) return; // TLS-Modus: externen Server nutzen (TLS_CERT/TLS_KEY)
  const dataDir = mkdtempSync(join(tmpdir(), 'relay-'));
  server = spawn(process.execPath, ['server.js'], {
    cwd: new URL('.', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      API_KEYS: API_KEY,
      ADMIN_KEY,
      ALLOWED_ORIGINS: ALLOWED,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  // kurz warten, bis der Port horcht
  await new Promise((r) => setTimeout(r, 600));
  return dataDir;
}
function stopServer(dataDir) {
  if (server) server.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}

function req(method, path, body, auth, headers = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (auth) h.authorization = `Bearer ${auth}`;
  return fetch(BASE + path, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    const text = await r.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { status: r.status, json, headers: r.headers, text };
  });
}

const openWs = (token, role = 'guest', pin = null) =>
  new Promise((resolve, reject) => {
    const u = `${WS_PROTO}://localhost:${PORT}/ws?token=${token}&role=${role}${pin ? `&pin=${pin}` : ''}`;
    const ws = new WebSocket(u);
    const msgs = [];
    ws.on('message', (m) => msgs.push(JSON.parse(m.toString())));
    ws.on('open', () => resolve({ ws, msgs }));
    ws.on('error', reject);
    ws.on('close', (c, r) => (ws._closed = { c, r: r.toString() }));
  });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failures++; };

const main = async () => {
  const dataDir = await startServer();

  // 1) Token minten (mit API-Key)
  const mint = await req('POST', '/api/token', { seats: 2, pin: '1234' }, API_KEY);
  check('mint 201', mint.status === 201);
  const { token, seats, pin } = mint.json;
  check('seats=2', seats === 2);
  check('pin=1234', pin === '1234');

  // 2) Zwei Gäste joinen
  const a = await openWs(token, 'guest', '1234');
  const b = await openWs(token, 'guest', '1234');
  await wait(100);
  check('guest A joined', a.msgs.some((m) => m.type === 'joined'));
  check('guest B joined', b.msgs.some((m) => m.type === 'joined'));

  // 3) App-Message wird relayed A -> B
  a.ws.send(JSON.stringify({ type: 'app', payload: { hello: 'world' } }));
  await wait(100);
  check('relay A->B', b.msgs.some((m) => m.type === 'app' && m.payload?.hello === 'world'));

  // 4) Dritter Gast -> seats_exhausted (limit 2)
  const c = await openWs(token, 'guest', '1234');
  await wait(100);
  check('seat limit enforced', c.ws._closed !== undefined);
  c.ws.close?.();

  // 5) Falsche PIN -> pin_mismatch
  const wrong = await openWs(token, 'guest', '9999');
  await wait(100);
  check('wrong pin rejected', wrong.ws._closed !== undefined);

  // 6) Host join + PIN-Rotation via API
  const host = await openWs(token, 'host');
  await wait(100);
  check('host joined', host.msgs.some((m) => m.type === 'joined' && m.role === 'host'));
  const rot = await req('PATCH', `/api/token/${token}/pin`, { pin: '5555' }, API_KEY);
  check('pin rotation', rot.status === 200 && rot.json.pin === '5555');
  const oldPin = await openWs(token, 'guest', '1234');
  await wait(100);
  check('old pin now rejected', oldPin.ws._closed !== undefined);

  // 7) Admin-Liste
  const admin = await req('GET', '/admin/tokens', null, ADMIN_KEY);
  check('admin lists tokens', admin.status === 200 && Array.isArray(admin.json.tokens));

  // 8) Health
  const h = await req('GET', '/health');
  check('health ok', h.status === 200 && h.json.ok === true && h.json.version);

  // 9) Status-Page (§8) als HTML
  const status = await req('GET', '/', null, null, { origin: ALLOWED });
  check('status page 200 html', status.status === 200 && /text\/html/.test(status.headers.get('content-type')));
  check('status page content', /exhibit-relay/.test(status.text) && /Seats/.test(status.text));

  // 10) CORS: erlaubtes Origin bekommt ACAO
  check('cors allowed origin', status.headers.get('access-control-allow-origin') === ALLOWED);

  // 11) CORS: fremdes Origin -> kein ACAO
  const foreign = await req('GET', '/health', null, null, { origin: 'https://evil.example.com' });
  check('cors foreign denied', !foreign.headers.get('access-control-allow-origin'));

  // 12) CORS: OPTIONS-Preflight
  const pre = await fetch(BASE + '/api/token', {
    method: 'OPTIONS',
    headers: { origin: ALLOWED, 'access-control-request-method': 'POST' },
  });
  check('cors preflight 204', pre.status === 204 && pre.headers.get('access-control-allow-origin') === ALLOWED);

  // 13) Admin-UI ohne Key -> 401
  const uiNoKey = await req('GET', '/admin');
  check('admin ui gated', uiNoKey.status === 401);

  // 14) Admin-UI mit Key (Bearer + ?k=) -> 200 HTML
  const uiKey = await req('GET', `/admin?k=${ADMIN_KEY}`, null, ADMIN_KEY);
  check('admin ui served', uiKey.status === 200 && /Admin/.test(uiKey.text));

  a.ws.close(); b.ws.close(); host.ws.close();
  await wait(100);
  stopServer(dataDir);
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => { console.error(e); stopServer(); process.exit(1); });
