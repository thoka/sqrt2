// Gemeinsame Helfer fuer die Connection-Service-Testscripts (test-api.mjs,
// test-connection.mjs). Startet bei Bedarf einen eigenen Relay-Server mit
// gesteuertem Env, stellt req()/openWs()/wait() und einen Checker bereit.
import { spawn } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const PORT = Number(process.env.PORT ?? 8099);
const BASE = `http://localhost:${PORT}`;
const WS_BASE = `ws://localhost:${PORT}`;

// Deterministic Secrets fuer Tests; Brute-Force-Schutz knapp gehalten, damit
// die Checks reproduzierbar bleiben.
export const TEST_ENV = {
  PORT: String(PORT),
  API_KEYS: process.env.API_KEYS ?? 'testkey',
  ADMIN_KEY: process.env.ADMIN_KEY ?? 'testadmin',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? 'https://exhibit.example.com',
  RATE_LIMIT_MAX: '6',
  RATE_LIMIT_WINDOW_MS: '60000',
  PIN_BACKOFF_GRACE: '1',
  PIN_BACKOFF_BASE_MS: '500',
  PIN_BACKOFF_MAX_MS: '2000',
};

// Startet einen eigenen Server (Plain http/ws). Gibt Handle mit stop() zurueck.
// TLS-Modus (TLS=1) wird hier nicht genutzt — die focused Scripts testen den
// Plain-Pfad; TLS ist ueber den kombinierten `npm run smoke` abgedeckt.
export async function startServer(extraEnv = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'relay-'));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: new URL('.', import.meta.url).pathname,
    env: { ...process.env, ...TEST_ENV, ...extraEnv, DATA_DIR: dataDir },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await new Promise((r) => setTimeout(r, 600));
  return {
    dataDir,
    async stop() {
      await new Promise((resolve) => {
        server.on('exit', () => resolve());
        server.kill();
      });
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export function req(method, path, body, auth, headers = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (auth) h.authorization = `Bearer ${auth}`;
  return fetch(BASE + path, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    const text = await r.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    return { status: r.status, json, headers: r.headers, text };
  });
}

export function openWs(token, role = 'guest', pin = null) {
  return new Promise((resolve, reject) => {
    const u = `${WS_BASE}/ws?token=${token}&role=${role}${pin ? `&pin=${pin}` : ''}`;
    const ws = new WebSocket(u);
    const msgs = [];
    ws.on('message', (m) => msgs.push(JSON.parse(m.toString())));
    ws.on('open', () => resolve({ ws, msgs }));
    ws.on('error', reject);
    ws.on('close', (c, r) => (ws._closed = { c, r: r.toString() }));
  });
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Checker mit eigenem Failure-Counter; gibt { check, failures } zurueck.
export function makeChecker() {
  const state = { failures: 0 };
  state.check = (name, cond) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
    if (!cond) state.failures++;
    return !cond;
  };
  return state;
}
