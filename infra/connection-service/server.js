// exhibit-relay — minimal, generic WebSocket relay with two-step auth.
//
//   Exponat (Host)  -> POST /api/token (Bearer API_KEY)  -> mint join token
//   Besucher (Guest)-> WS /ws?token=T&pin=P              -> join room, relay JSON
//
// RAM-only (zero persistence like KoalaSync). Admin-Key wird beim ersten
// Start generiert und auf stdout + in DATA_DIR/admin_key geschrieben.
//
// AB HIER (Option "ein Server"): der Relay ist als ----------------------------------------------------------------------
// BIBLIOTHEK gebaut. `createRelay(config)` liefert `{ requestHandler,
// attachWs(httpServer), close() }` - OHNE eigenen Port. So laeuft der Relay
// embedded im selben Node-Prozess wie der Exponat-Webserver (ein Origin,
// kein CORS, kein zweiter Prozess). `server.js` ist nur ein duenner Entry,
// der `createRelay` mit einem eigenen http(s)-Server verdrahtet - fuer den
// Fall, dass jemand den Relay doch standalone betreiben will.

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { FixedWindowLimiter, PinBackoff } from './ratelimit.js';

// --- Relay als Bibliothek -------------------------------------------------
// `createRelay(config)` baut den kompletten Relay-Zustand auf und liefert
// die Stuecke, die ein Host-Server einhaengen muss:
//   - requestHandler: (req, res) => void  -> an http(s).createServer uebergeben
//   - attachWs(server): haengt einen WebSocketServer an einen bestehenden
//     http(s)-Server (selber Port/Origin wie die Oberflaeche)
//   - close(): raeumt Timer/State auf
// config (alle optional, Defaults aus Env): { dataDir, apiKeys (Array/commalist),
//   adminKey, tokenTtlDefault, maxSeatsDefault, heartbeatMs, rateLimit*,
//   pinBackoff*, tlsCert, tlsKey }
export function createRelay(config = {}) {
  const DATA_DIR = config.dataDir ?? process.env.DATA_DIR ?? './data';
  const DEFAULT_TTL = Number(config.tokenTtlDefault ?? process.env.TOKEN_TTL_DEFAULT ?? 3600);
  const DEFAULT_SEATS = Number(config.maxSeatsDefault ?? process.env.MAX_SEATS_DEFAULT ?? 4);
  const HEARTBEAT_MS = Number(config.heartbeatMs ?? process.env.HEARTBEAT_MS ?? 30000);
  const TOKEN_BYTES = 18;
  const VERSION = '0.3.0';
  const STARTED_AT = Date.now();

  // Brute-Force-Schutz (§9): Rate-Limit pro API-Key beim Token-Minting sowie
  // exponentielles Backoff bei falscher PIN.
  const RATE_LIMIT_MAX = Number(config.rateLimitMax ?? process.env.RATE_LIMIT_MAX ?? 120);
  const RATE_LIMIT_WINDOW_MS = Number(
    config.rateLimitWindowMs ?? process.env.RATE_LIMIT_WINDOW_MS ?? 60000,
  );
  const mintLimiter = new FixedWindowLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  const pinBackoff = new PinBackoff({
    baseMs: Number(config.pinBackoffBaseMs ?? process.env.PIN_BACKOFF_BASE_MS ?? 1000),
    maxMs: Number(config.pinBackoffMaxMs ?? process.env.PIN_BACKOFF_MAX_MS ?? 60000),
    grace: Number(config.pinBackoffGrace ?? process.env.PIN_BACKOFF_GRACE ?? 8),
  });

  // CORS entfaellt bei embedded Betrieb (selber Origin) - die Helfer bleiben
  // als No-Ops bestehen, damit ein standalone server.js sie nicht braucht.
  const ALLOWED_ORIGINS = new Set(
    (config.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // --- Admin-Key (einmalig generieren, dann persistent) -------------------
  function loadOrCreateAdminKey() {
    const file = `${DATA_DIR}/admin_key`;
    if (config.adminKey) return config.adminKey;
    if (process.env.ADMIN_KEY) return process.env.ADMIN_KEY;
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    const key = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, key);
    return key;
  }
  const ADMIN_KEY = loadOrCreateAdminKey();

  // --- API-Keys (Exponate) ------------------------------------------------
  function loadApiKeys() {
    const fromConfig = config.apiKeys
      ? Array.isArray(config.apiKeys)
        ? config.apiKeys
        : String(config.apiKeys).split(',').map((s) => s.trim()).filter(Boolean)
      : null;
    if (fromConfig && fromConfig.length) return new Set(fromConfig);
    if (process.env.API_KEYS)
      return new Set(process.env.API_KEYS.split(',').map((s) => s.trim()).filter(Boolean));
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

  // Aggregat-Statistik fuer Status-Page (§8).
  function totalSeats() {
    let n = 0;
    for (const t of tokens.values()) n += t.seats;
    return n;
  }
  function totalOccupied() {
    let n = 0;
    for (const id of tokens.keys()) n += guestCount(id);
    return n;
  }
  function totalHosts() {
    let n = 0;
    for (const c of conns.values()) if (c.role === 'host') n++;
    return n;
  }
  function connsTotal() {
    return conns.size;
  }

  // CORS-Header abhaengig vom Request-Origin (§9). Nur bekannte Origins.
  // Bei embedded Betrieb (selber Origin) meist leer -> keine CORS-Antwort.
  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin || ALLOWED_ORIGINS.size === 0 || !ALLOWED_ORIGINS.has(origin)) return {};
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'vary': 'origin',
    };
  }

  // --- HTTP-REST -----------------------------------------------------------
  function sendJson(res, status, obj, req) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      ...corsHeaders(req),
    });
    res.end(body);
  }

  function sendHtml(res, status, html, req) {
    const body = Buffer.from(html, 'utf8');
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': body.length,
      ...corsHeaders(req),
    });
    res.end(body);
  }

  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function statusPageHtml(req) {
    const scheme = req.socket.encrypted ? 'https/wss' : 'http/ws';
    const uptimeSec = Math.floor((Date.now() - STARTED_AT) / 1000);
    const rooms = tokens.size;
    const occupied = totalOccupied();
    const seats = totalSeats();
    const conns = connsTotal();
    return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>exhibit-relay</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#1a1a1a}
h1{font-size:1.4rem}table{border-collapse:collapse;margin-top:1rem}
td,th{padding:.35rem .9rem;text-align:left;border-bottom:1px solid #eee}
code{background:#f3f3f3;padding:.1rem .35rem;border-radius:4px}
.ok{color:#0a7d2c}.muted{color:#888}</style></head>
<body>
<h1>exhibit-relay <span class="muted">${escapeHtml(VERSION)}</span></h1>
<p>Generischer Echtzeit-Relay-Dienst für Exponate. Transport: <code>${escapeHtml(scheme)}</code></p>
<table>
<tr><th>Aktive Räume</th><td>${rooms}</td></tr>
<tr><th>Belegte / verfügbare Seats</th><td>${occupied} / ${seats - occupied} <span class="muted">(gesamt ${seats})</span></td></tr>
<tr><th>Verbindungen</th><td>${conns} <span class="muted">(${totalHosts()} Host(s))</span></td></tr>
<tr><th>Uptime</th><td>${uptimeSec}s</td></tr>
</table>
<p class="muted">Maschinenlesbar: <a href="/health">/health</a> (JSON).</p>
<p><a href="/admin">Admin-UI</a> (nur mit Admin-Berechtigung).</p>
</body></html>`;
  }

  // Admin-UI: schlanke, dependency-freie Seite, nutzt ausschliesslich die
  // REST-API (§8). Admin-Key wird als Bearer mitgeschickt.
  function adminUiHtml(req) {
    const scheme = req.socket.encrypted ? 'https/wss' : 'http/ws';
    return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>exhibit-relay — Admin</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#1a1a1a}
h1{font-size:1.4rem}table{border-collapse:collapse;width:100%;margin-top:1rem}
td,th{padding:.4rem .7rem;text-align:left;border-bottom:1px solid #eee}
code{background:#f3f3f3;padding:.1rem .35rem;border-radius:4px;word-break:break-all}
button{cursor:pointer;padding:.25rem .6rem}.err{color:#b00}.muted{color:#888}
#summary{margin-top:1rem}</style></head>
<body>
<h1>exhibit-relay — Admin <span class="muted">${escapeHtml(VERSION)}</span></h1>
<p class="muted">Transport: <code>${escapeHtml(scheme)}</code></p>
<div id="summary"></div>
<table id="tokens"><thead><tr>
<th>Token</th><th>Label</th><th>Seats</th><th>Belegt</th><th>PIN</th><th>Expires</th><th>Aktion</th>
</tr></thead><tbody></tbody></table>
<p id="msg" class="err"></p>
<script>
const key = new URLSearchParams(location.search).get('k') || prompt('Admin-Key:');
if (!key) location.href = '/admin';
const auth = { headers: { authorization: 'Bearer ' + key } };
const fmt = (t) => t ? new Date(t).toLocaleString() : '—';
async function load() {
  const [h, t] = await Promise.all([
    fetch('/admin/health', auth).then(r => r.json()),
    fetch('/admin/tokens', auth).then(r => r.json()),
  ]);
  let occ = 0, seats = 0;
  const rows = (t.tokens || []).map(x => {
    occ += x.occupied; seats += x.seats;
    return '<tr><td><code>' + x.token + '</code></td><td>' + (x.label||'—') +
      '</td><td>' + x.seats + '</td><td>' + x.occupied + '</td><td>' +
      (x.pin ? 'ja' : 'nein') + '</td><td>' + fmt(x.expiresAt) +
      '</td><td><button onclick="revoke(\\'' + x.token + '\\')">Revoke</button></td></tr>';
  }).join('');
  document.querySelector('#tokens tbody').innerHTML = rows || '<tr><td colspan="7" class="muted">keine Tokens</td></tr>';
  document.getElementById('summary').innerHTML =
    'Räume: <b>' + h.rooms + '</b> · Tokens: <b>' + h.tokens +
    '</b> · Seats belegt/gesamt: <b>' + occ + '/' + seats + '</b>';
}
async function revoke(tok) {
  if (!confirm('Token widerrufen?')) return;
  const r = await fetch('/admin/token/' + encodeURIComponent(tok), { method: 'DELETE', ...auth });
  document.getElementById('msg').textContent = r.ok ? 'revoked' : 'Fehler ' + r.status;
  load();
}
load(); setInterval(load, 5000);
</script>
</body></html>`;
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
  function isAdmin(req) {
    if (bearer(req) === ADMIN_KEY) return true;
    try {
      const u = new URL(req.url, 'http://localhost');
      return u.searchParams.get('k') === ADMIN_KEY;
    } catch { return false; }
  }
  function apiKey(req) { const b = bearer(req); return b && API_KEYS.has(b) ? b : null; }

  function publicWsUrl(req) {
    const host = req.headers.host ?? `localhost`;
    const proto = req.socket.encrypted ? 'wss' : 'ws';
    return `${proto}://${host}/ws`;
  }

  async function requestHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      const p = url.pathname;

      // Lokale Antwort-Helfer (CORS via req mitgefuehrt).
      const json = (status, obj) => sendJson(res, status, obj, req);
      const html = (status, h) => sendHtml(res, status, h, req);

      // CORS-Preflight (§9). Bei embedded Betrieb ohne ALLOWED_ORIGINS: 405.
      if (req.method === 'OPTIONS') {
        const h = corsHeaders(req);
        if (Object.keys(h).length === 0) return json(405, { error: 'method_not_allowed' });
        res.writeHead(204, { 'content-length': 0, ...h });
        return res.end();
      }

      if (p === '/health' && req.method === 'GET') {
        return json(200, { ok: true, version: VERSION, rooms: rooms.size });
      }

      // --- Status-Page (§8): HTML ueber http/https bei Browser-Zugriff ---
      if (p === '/' && req.method === 'GET') {
        return html(200, statusPageHtml(req));
      }

      // --- Admin-Web-UI (§8): nur mit Admin-Berechtigung erreichbar ---
      if (p === '/admin' && req.method === 'GET') {
        if (!isAdmin(req)) {
          res.writeHead(401, { 'www-authenticate': 'Bearer realm="exhibit-relay-admin"' });
          return res.end();
        }
        return html(200, adminUiHtml(req));
      }

      // --- Exponat: Token minten ---
      if (p === '/api/token' && req.method === 'POST') {
        const key = apiKey(req);
        if (!key) return json(401, { error: 'unauthorized', code: 'no_api_key' });
        // Rate-Limit pro API-Key (Brute-Force/Typo-Schutz).
        if (!mintLimiter.check(`api:${key}`)) {
          const retry = Math.ceil(mintLimiter.retryAfterMs(`api:${key}`) / 1000);
          res.writeHead(429, { 'retry-after': String(retry), ...corsHeaders(req) });
          return res.end(JSON.stringify({ error: 'rate_limited', code: 'too_many_tokens', retryAfterSec: retry }));
        }
        const b = await readBody(req);
        const seats = Math.max(1, Math.min(Number(b.seats ?? DEFAULT_SEATS) || DEFAULT_SEATS, 999));
        const pin = b.pin == null ? null : String(b.pin);
        const ttl = Number(b.ttlSec ?? DEFAULT_TTL);
        const id = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
        const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : null;
        tokens.set(id, { seats, pin, createdAt: Date.now(), expiresAt, label: b.label ?? null, hostConnId: null });
        return json(201, {
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
        if (!t) return json(200, { valid: false });
        return json(200, { valid: true, seats: t.seats, occupied: guestCount(b.token), expiresAt: t.expiresAt });
      }

      // PIN rotieren (Host via API-Key): /api/token/:token/pin
      const pinMatch = p.match(/^\/api\/token\/([^/]+)\/pin$/);
      if (pinMatch && req.method === 'PATCH') {
        if (!apiKey(req)) return json(401, { error: 'unauthorized', code: 'no_api_key' });
        const id = decodeURIComponent(pinMatch[1]);
        const t = tokens.get(id);
        if (!t) return json(404, { error: 'not_found' });
        const b = await readBody(req);
        t.pin = b.pin == null ? null : String(b.pin);
        return json(200, { ok: true, pin: t.pin });
      }

      // revoke (Host via API-Key): /api/token/:token
      const tokenMatch = p.match(/^\/api\/token\/([^/]+)$/);
      if (tokenMatch && (req.method === 'DELETE' || req.method === 'PATCH')) {
        if (!apiKey(req)) return json(401, { error: 'unauthorized', code: 'no_api_key' });
        const id = decodeURIComponent(tokenMatch[1]);
        const t = tokens.get(id);
        if (!t) return json(404, { error: 'not_found' });
        if (req.method === 'DELETE') {
          tokens.delete(id);
          rooms.delete(id);
          return json(200, { ok: true });
        }
        const b = await readBody(req);
        t.pin = b.pin == null ? null : String(b.pin);
        return json(200, { ok: true, pin: t.pin });
      }

      // --- Admin ---
      if (p.startsWith('/admin/')) {
        if (!isAdmin(req)) return json(401, { error: 'unauthorized', code: 'no_admin_key' });
        if (p === '/admin/health' && req.method === 'GET') {
          return json(200, { ok: true, rooms: rooms.size, tokens: tokens.size });
        }
        if (p === '/admin/tokens' && req.method === 'GET') {
          const list = [...tokens.entries()].map(([id, t]) => ({
            token: id, seats: t.seats, occupied: guestCount(id),
            pin: t.pin ? true : false, expiresAt: t.expiresAt, label: t.label,
          }));
          return json(200, { tokens: list });
        }
        const admMatch = p.match(/^\/admin\/token\/([^/]+)$/);
        if (admMatch && req.method === 'DELETE') {
          const id = decodeURIComponent(admMatch[1]);
          tokens.delete(id); rooms.delete(id);
          return json(200, { ok: true });
        }
        return json(404, { error: 'not_found' });
      }

      json(404, { error: 'not_found' });
    } catch (err) {
      sendJson(res, 400, { error: 'bad_request', message: String(err?.message ?? err) }, req);
    }
  }

  // --- WebSocket-Relay (an bestehenden http(s)-Server gehaengt) -----------
  let wss = null;
  let heartbeat = null;

  function attachWs(httpServer) {
    wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    wss.on('connection', (ws, req) => {
      const url = new URL(req.url, 'http://localhost');
      const tokenId = url.searchParams.get('token');
      const role = url.searchParams.get('role') === 'host' ? 'host' : 'guest';
      const pin = url.searchParams.get('pin') ?? null;
      const connId = crypto.randomUUID();

      const fail = (code, msg) => {
        try { 			ws.send(JSON.stringify({ type: 'error', code, message: msg }));
				} catch {
					// ignore send failures
				}
        ws.close();
      };

      const t = tokenId ? tokens.get(tokenId) : null;
      if (!t) return fail('bad_token', 'unknown or revoked token');
      if (t.expiresAt && Date.now() > t.expiresAt) return fail('expired', 'token expired');

      // PIN: erst auf aktive Sperre pruefen (exponentielles Backoff), dann Treffer.
      if (role === 'guest' && t.pin) {
        const locked = pinBackoff.lockedMs(tokenId);
        if (locked > 0) return fail('pin_locked', `PIN-Versuche gesperrt für ${Math.ceil(locked / 1000)}s`);
        if (pin !== t.pin) {
          const wait = pinBackoff.registerFailure(tokenId);
          return fail('pin_mismatch', wait > 0 ? `falsche PIN, Sperre ${Math.ceil(wait / 1000)}s` : 'wrong PIN');
        }
      }
      if (role === 'guest' && guestCount(tokenId) >= t.seats) return fail('seats_exhausted', 'room full');

      let set = rooms.get(tokenId);
      if (!set) { set = new Set(); rooms.set(tokenId, set); }
      set.add(connId);
      conns.set(connId, { ws, tokenId, role });
      if (role === 'host') t.hostConnId = connId;
      if (role === 'guest') pinBackoff.registerSuccess(tokenId);

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
    heartbeat = setInterval(() => {
      if (!wss) return;
      for (const ws of wss.clients) {
        if (ws.isAlive === false) { ws.terminate(); continue; }
        ws.isAlive = false;
        try { 			ws.ping();
				} catch {
					// ignore ping failures
				}
      }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
    return wss;
  }

  function close() {
    if (heartbeat) clearInterval(heartbeat);
    if (wss) wss.close();
    mintLimiter.close();
  }

  return { VERSION, ADMIN_KEY, API_KEYS, requestHandler, attachWs, close };
}

// --- Standalone-Entry (optional) -----------------------------------------
// Wer den Relay doch als eigenen Prozess betreiben will, nutzt diesen Pfad.
// Default-Verhalten unverändert zur vorigen Version (eigener Port).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const relay = createRelay();
  const tlsOn = !!(process.env.TLS_CERT && process.env.TLS_KEY);
  const PORT = Number(process.env.PORT ?? 8080);
  const server = tlsOn
    ? https.createServer(
        { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) },
        relay.requestHandler,
      )
    : http.createServer(relay.requestHandler);
  relay.attachWs(server);
  server.listen(PORT, () => {
    console.log('========================================================');
    console.log(' exhibit-relay gestartet (standalone)');
    console.log(` ADMIN_KEY (nur einmal, in ${relay.dataDir ?? process.env.DATA_DIR ?? './data'}/admin_key):`);
    console.log(`   ${relay.ADMIN_KEY}`);
    const scheme = tlsOn ? 'https/wss' : 'http/ws';
    console.log(` ${scheme} auf Port ${PORT}  (/health, /api/token, /ws)`);
    console.log('========================================================');
  });
}
