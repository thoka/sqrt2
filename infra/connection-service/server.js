// exhibit-relay — minimal, generic WebSocket relay with two-step auth.
//
//   Exponat (Host)  -> POST /api/token (Bearer API_KEY)  -> mint join token
//   Besucher (Guest)-> WS /ws?token=T&pin=P              -> join room, relay JSON
//
// RAM-only (zero persistence like KoalaSync). Admin-Key wird beim ersten
// Start generiert und auf stdout + in /data/admin_key geschrieben.

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? '/data';
const DEFAULT_TTL = Number(process.env.TOKEN_TTL_DEFAULT ?? 3600);
const DEFAULT_SEATS = Number(process.env.MAX_SEATS_DEFAULT ?? 4);
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS ?? 30000);
const TOKEN_BYTES = 18;

fs.mkdirSync(DATA_DIR, { recursive: true });

// --- Admin-Key (einmalig generieren, dann persistent) -------------------
function loadOrCreateAdminKey() {
  const file = `${DATA_DIR}/admin_key`;
  if (process.env.ADMIN_KEY) return process.env.ADMIN_KEY;
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const key = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, key);
  return key;
}
const ADMIN_KEY = loadOrCreateAdminKey();

// --- API-Keys (Exponate) ------------------------------------------------
function loadApiKeys() {
  if (process.env.API_KEYS) return new Set(process.env.API_KEYS.split(',').map((s) => s.trim()).filter(Boolean));
  const key = crypto.randomBytes(24).toString('hex');
  console.log(`[relay] API_KEY nicht gesetzt - generiere temporaeren: ${key}`);
  return new Set([key]);
}
const API_KEYS = loadApiKeys();

// --- Token-Store ---------------------------------------------------------
/** tokenId -> { seats, pin, createdAt, expiresAt, label, hostConnId } */
const tokens = new Map();
/** connId  -> { ws, tokenId, role } */
const conns = new Map();
/** tokenId -> Set<connId> (nur guests zaehlen gegen seats) */
const rooms = new Map();

function guestCount(tokenId) {
  const set = rooms.get(tokenId);
  if (!set) return 0;
  let n = 0;
  for (const id of set) if (conns.get(id)?.role === 'guest') n++;
  return n;
}

// --- HTTP-REST -----------------------------------------------------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
function bearer(req) {
  const h = req.headers['authorization'] ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}
function isAdmin(req) { return bearer(req) === ADMIN_KEY; }
function isApi(req) { const b = bearer(req); return b && API_KEYS.has(b); }

function publicWsUrl(req) {
  const host = req.headers.host ?? `localhost:${PORT}`;
  const proto = req.socket.encrypted ? 'wss' : 'ws';
  return `${proto}://${host}/ws`;
}

async function requestHandler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const p = url.pathname;

    if (p === '/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, version: '0.1.0', rooms: rooms.size });
    }

    // --- Exponat: Token minten ---
    if (p === '/api/token' && req.method === 'POST') {
      if (!isApi(req)) return sendJson(res, 401, { error: 'unauthorized', code: 'no_api_key' });
      const b = await readBody(req);
      const seats = Math.max(1, Math.min(Number(b.seats ?? DEFAULT_SEATS) || DEFAULT_SEATS, 999));
      const pin = b.pin == null ? null : String(b.pin);
      const ttl = Number(b.ttlSec ?? DEFAULT_TTL);
      const id = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
      const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : null;
      tokens.set(id, { seats, pin, createdAt: Date.now(), expiresAt, label: b.label ?? null, hostConnId: null });
      return sendJson(res, 201, {
        token: id,
        wsUrl: publicWsUrl(req),
        seats,
        pin,
        expiresAt,
      });
    }

    if (p === '/api/token/verify' && req.method === 'POST') {
      const b = await readBody(req);
      const t = tokens.get(b.token);
      if (!t) return sendJson(res, 200, { valid: false });
      return sendJson(res, 200, { valid: true, seats: t.seats, occupied: guestCount(b.token), expiresAt: t.expiresAt });
    }

    // PIN rotieren (Host via API-Key): /api/token/:token/pin
    const pinMatch = p.match(/^\/api\/token\/([^/]+)\/pin$/);
    if (pinMatch && req.method === 'PATCH') {
      if (!isApi(req)) return sendJson(res, 401, { error: 'unauthorized', code: 'no_api_key' });
      const id = decodeURIComponent(pinMatch[1]);
      const t = tokens.get(id);
      if (!t) return sendJson(res, 404, { error: 'not_found' });
      const b = await readBody(req);
      t.pin = b.pin == null ? null : String(b.pin);
      return sendJson(res, 200, { ok: true, pin: t.pin });
    }

    // revoke (Host via API-Key): /api/token/:token
    const tokenMatch = p.match(/^\/api\/token\/([^/]+)$/);
    if (tokenMatch && (req.method === 'DELETE' || req.method === 'PATCH')) {
      if (!isApi(req)) return sendJson(res, 401, { error: 'unauthorized', code: 'no_api_key' });
      const id = decodeURIComponent(tokenMatch[1]);
      const t = tokens.get(id);
      if (!t) return sendJson(res, 404, { error: 'not_found' });
      if (req.method === 'DELETE') {
        tokens.delete(id);
        rooms.delete(id);
        return sendJson(res, 200, { ok: true });
      }
      const b = await readBody(req);
      t.pin = b.pin == null ? null : String(b.pin);
      return sendJson(res, 200, { ok: true, pin: t.pin });
    }

    // --- Admin ---
    if (p.startsWith('/admin/')) {
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'unauthorized', code: 'no_admin_key' });
      if (p === '/admin/health' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, rooms: rooms.size, tokens: tokens.size });
      }
      if (p === '/admin/tokens' && req.method === 'GET') {
        const list = [...tokens.entries()].map(([id, t]) => ({
          token: id, seats: t.seats, occupied: guestCount(id),
          pin: t.pin ? true : false, expiresAt: t.expiresAt, label: t.label,
        }));
        return sendJson(res, 200, { tokens: list });
      }
      const admMatch = p.match(/^\/admin\/token\/([^/]+)$/);
      if (admMatch && req.method === 'DELETE') {
        const id = decodeURIComponent(admMatch[1]);
        tokens.delete(id); rooms.delete(id);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { error: 'not_found' });
    }

    sendJson(res, 404, { error: 'not_found' });
  } catch (err) {
    sendJson(res, 400, { error: 'bad_request', message: String(err?.message ?? err) });
  }
}

// --- WebSocket-Relay -----------------------------------------------------
// TLS ueber Tailscale-Zertifikate: `tailscale cert <host>.<tailnet>.ts.net`
// schreibt .crt/.key; per TLS_CERT/TLS_KEY einhaengen -> https + wss://.
const tlsOn = !!(process.env.TLS_CERT && process.env.TLS_KEY);
const httpServer = tlsOn
  ? https.createServer(
      { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) },
      requestHandler,
    )
  : http.createServer(requestHandler);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const tokenId = url.searchParams.get('token');
  const role = url.searchParams.get('role') === 'host' ? 'host' : 'guest';
  const pin = url.searchParams.get('pin') ?? null;
  const connId = crypto.randomUUID();

  const fail = (code, msg) => {
    try { ws.send(JSON.stringify({ type: 'error', code, message: msg })); } catch {}
    ws.close();
  };

  const t = tokenId ? tokens.get(tokenId) : null;
  if (!t) return fail('bad_token', 'unknown or revoked token');
  if (t.expiresAt && Date.now() > t.expiresAt) return fail('expired', 'token expired');
  if (role === 'guest' && t.pin && pin !== t.pin) return fail('pin_mismatch', 'wrong PIN');
  if (role === 'guest' && guestCount(tokenId) >= t.seats) return fail('seats_exhausted', 'room full');

  let set = rooms.get(tokenId);
  if (!set) { set = new Set(); rooms.set(tokenId, set); }
  set.add(connId);
  conns.set(connId, { ws, tokenId, role });
  if (role === 'host') t.hostConnId = connId;

  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  const broadcast = (obj, includeSelf = false) => {
    for (const id of set) {
      if (!includeSelf && id === connId) continue;
      const c = conns.get(id);
      if (c?.ws.readyState === ws.OPEN) c.ws.send(JSON.stringify(obj));
    }
  };

  ws.send(JSON.stringify({ type: 'joined', role, seats: t.seats, occupied: guestCount(tokenId) }));
  broadcast({ type: 'presence', event: 'join', role, occupied: guestCount(tokenId) }, true);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg?.type === 'app') {
      broadcast({ type: 'app', from: role === 'host' ? 'host' : connId, payload: msg.payload });
    }
  });

  ws.on('close', () => {
    set.delete(connId);
    conns.delete(connId);
    if (t.hostConnId === connId) t.hostConnId = null;
    if (set.size === 0) rooms.delete(tokenId);
    else broadcast({ type: 'presence', event: 'leave', role, occupied: guestCount(tokenId) }, true);
  });
});

// Heartbeat: t<-- Verbindungen aufraeumen
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

httpServer.listen(PORT, () => {
  console.log('========================================================');
  console.log(' exhibit-relay gestartet');
  console.log(` ADMIN_KEY (nur einmal, in ${DATA_DIR}/admin_key):`);
  console.log(`   ${ADMIN_KEY}`);
  const scheme = tlsOn ? 'https/wss' : 'http/ws';
  console.log(` ${scheme} auf Port ${PORT}  (/health, /api/token, /ws)`);
  console.log('========================================================');
});
