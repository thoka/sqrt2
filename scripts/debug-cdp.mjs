// Debug-Inspect Peer (DEBUG-INSPECT-SPEC.md, Primärpfad).
// Verbindet per Playwright connectOverCDP an den laufenden User-Chrome
// (Win11, --remote-debugging-port=9222, vom Container aus localhost),
// lädt sqrt2 mit ?debug=1 und liest den inneren Stand direkt per
// page.evaluate(window.__debugSnapshot()). Schreibt ./debug/state.json
// + optional ./debug/shot.png.
//
// Nutzung:
//   node scripts/debug-cdp.mjs            # pollt Snapshot alle 200ms -> state.json
//   node scripts/debug-cdp.mjs --shot     # einmalig Screenshot nach shot.png
//   CDP_HOST=localhost:9222 node scripts/debug-cdp.mjs
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = process.env.CDP_HOST || 'http://localhost:9222';
const URL = process.env.DEBUG_URL || 'http://localhost:5300/?debug=1';
const OUT = 'debug';
mkdirSync(OUT, { recursive: true });

const doShot = process.argv.includes('--shot');

const browser = await chromium.connectOverCDP(CDP);
console.log('[debug-cdp] connected to', CDP);

// Bestehende Page mit sqrt2 nutzen, falls offen, sonst neue Page.
let page;
const contexts = browser.contexts();
for (const ctx of contexts) {
	const pages = ctx.pages();
	const found = pages.find((p) => p.url().includes('debug=1') || p.url().includes('sqrt2'));
	if (found) {
		page = found;
		break;
	}
}
if (!page) {
	const ctx = contexts[0] || (await browser.newContext());
	page = await ctx.newPage();
	await page.goto(URL, { waitUntil: 'domcontentloaded' });
	console.log('[debug-cdp] opened', URL);
}

async function snap() {
	const s = await page.evaluate(() => {
		if (typeof window.__debugSnapshot === 'function') return window.__debugSnapshot();
		return null;
	});
	if (!s) {
		console.log('[debug-cdp] window.__debugSnapshot not ready yet');
		return null;
	}
	writeFileSync(`${OUT}/state.json`, JSON.stringify(s, null, 2));
	return s;
}

if (doShot) {
	await snap();
	await page.screenshot({ path: `${OUT}/shot.png` });
	console.log('[debug-cdp] wrote', `${OUT}/shot.png`);
} else {
	console.log('[debug-cdp] polling every 200ms (Ctrl-C to stop)');
	let prevFrameNo = null;
	let prevTick = null;
	for (;;) {
		const s = await snap();
		if (s) {
			// Drift-Hinweis: frameNo (rAF) vs tick (Sim) über Zeit.
			if (prevFrameNo !== null && prevTick !== null) {
				const dFrame = s.frame.frameNo - prevFrameNo;
				const dTick = (s.compiled?.tick ?? 0) - prevTick;
				if (dFrame > 0 && dTick === 0 && s.playing) {
					console.log(
						`[drift?] frames advanced ${dFrame} but tick static (${s.compiled?.tick}) while playing`,
					);
				}
			}
			prevFrameNo = s.frame.frameNo;
			prevTick = s.compiled?.tick ?? 0;
			const driftT = (s.uTimeBank ?? 0) - (s.time ?? 0);
			const restHUD = JSON.stringify(s.restByK || {});
			const restBank = JSON.stringify(s.restByKBank || {});
			console.log(
				`frameNo=${s.frame.frameNo} fps=${s.frame.fps} time=${s.time?.toFixed?.(3)} uTimeBank=${s.uTimeBank?.toFixed?.(3)} driftT=${driftT.toFixed?.(3)}`,
			);
			if (restHUD !== restBank) {
				console.log(`  HUD restByK =${restHUD}`);
				console.log(`  BANK restByK=${restBank}`);
			}
		}
		await new Promise((r) => setTimeout(r, 200));
	}
}
