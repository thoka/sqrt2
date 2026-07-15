// Smoke-Test für exhibit-relay: Token-Minting, WS-Relay, Seat-Limit, PIN.
import { WebSocket } from 'ws';

const BASE = `http://localhost:${process.env.PORT ?? 8080}`;
const API_KEY = process.env.API_KEYS ?? 'testkey';
const ADMIN_KEY = process.env.ADMIN_KEY ?? 'testadmin';

function req(method, path, body, auth) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = `Bearer ${auth}`;
  return fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
}

const openWs = (token, role = 'guest', pin = null) =>
  new Promise((resolve, reject) => {
    const u = `ws://localhost:${process.env.PORT ?? 8080}/ws?token=${token}&role=${role}${pin ? `&pin=${pin}` : ''}`;
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
  check('seat limit enforced', c.ws._closed?.c !== undefined && a.msgs.concat(b.msgs).some((m) => m.type === 'error' && m.code === 'seats_exhausted') === false ? true : c.ws._closed !== undefined);
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
  check('health ok', h.status === 200 && h.json.ok === true);

  a.ws.close(); b.ws.close(); host.ws.close();
  await wait(100);
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => { console.error(e); process.exit(1); });
