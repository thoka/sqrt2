// scripts/check-env.mjs - Umgebungs-Test fuer die Coding-Instanz.
//
// Prueft, ob die Toolchain aus TOOLING_ENV_SPEC.md (§3) / scripts/setup-env.sh
// tatsaechlich steht: Node-Version, pnpm, Playwright + ein REALER headless-
// Chromium-Start (der einzige verlaessliche Beweis, dass alle System-Libs
// da sind). Playwright/Chromium-Tests werden graceful uebersprungen, wenn
// @playwright/test nicht aufloesbar ist (z.B. in der alten Sandbox) - dann
// ist der Test nur partiell aussagekraeftig, stuerzt aber nicht.
//
// Ausfuehren:  pnpm test:env   (bzw. node --test scripts/check-env.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MIN_NODE_MAJOR = 20; // Current/LTS

function tryExec(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const playwrightVersion = tryExec('pnpm', ['exec', 'playwright', '--version']);
const playwrightAvailable = playwrightVersion != null;

test('Node ist verfuegbar und aktuell genug (>= ${MIN_NODE_MAJOR})', () => {
  const major = Number(process.versions.node.split('.')[0]);
  assert.ok(major >= MIN_NODE_MAJOR,
    `Node ${process.versions.node} ist aelter als erwartet (>= ${MIN_NODE_MAJOR}, Current/LTS)`);
});

test('pnpm ist verfuegbar', () => {
  const v = tryExec('pnpm', ['--version']);
  assert.ok(v != null, 'pnpm nicht gefunden - setup-env.sh Schritt 3 (corepack) fehlt');
  assert.match(v, /^\d+\./, `pnpm --version lieferte unerwartet: '${v}'`);
});

test('@playwright/test ist aufloesbar', { skip: !playwrightAvailable }, () => {
  assert.ok(playwrightAvailable, '@playwright/test nicht gefunden - "pnpm add -D @playwright/test" fehlt');
});

test('Playwright-Chromium ist heruntergeladen', { skip: !playwrightAvailable }, () => {
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  assert.ok(fs.existsSync(base),
    `~/.cache/ms-playwright fehlt (${base}) - "pnpm exec playwright install chromium" fehlt`);
  const builds = fs.readdirSync(base).filter((d) => d.startsWith('chromium'));
  assert.ok(builds.length > 0, 'kein chromium-Build unter ~/.cache/ms-playwright');
});

test('Chromium startet headless (System-Libs vorhanden)', { skip: !playwrightAvailable }, async () => {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="c" width="10" height="10"></canvas>');
    const ok = await page.evaluate(() => {
      const cv = document.getElementById('c');
      return !!cv && cv.getContext('2d') != null;
    });
    assert.ok(ok, 'Chromium gestartet, aber 2D-Canvas-Kontext nicht verfuegbar');
  } finally {
    await browser.close();
  }
});

test('dist/sqrt2.html existiert (Build lief)', { skip: !playwrightAvailable }, () => {
  assert.ok(fs.existsSync(path.resolve('dist/sqrt2.html')),
    'dist/sqrt2.html fehlt - "pnpm build" (setup-env.sh Schritt 6) fehlt');
});
