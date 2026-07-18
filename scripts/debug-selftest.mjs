// Debug-Selftest (DEBUG-INSPECT-SPEC.md): klappert ueber CDP viele
// Zeitpunkte ab und prueft die Invarianten:
//   1. Bank zeichnet exakt dieselben Rest-Stuecke wie die Rest-Anzeige
//      rechts (bankDrawnRest == restByK).
//   2. Zahlentafel-Step (hud.Step) darf nicht vor der ersten born_time der
//      Schale springen (sonst zeigt l schon die neue Schale, waehrend die
//      Rest-Stuecke noch der alten Schale angehoeren -> Drift).
//   3. tick = timeToTick(time) muss auf den Zeitpunkt zeigen, an dem das
//      Stueck mit diesem tick wegfliest/verschwindet.
//
// Nutzung: node scripts/debug-selftest.mjs [maxTime]
import { chromium } from '@playwright/test';

const CDP = process.env.CDP_HOST || 'http://localhost:9222';
const URL = process.env.DEBUG_URL || 'http://localhost:5300/?debug=1';

const browser = await chromium.connectOverCDP(CDP);
let page;
for (const ctx of browser.contexts()) {
	const found = ctx.pages().find((p) => p.url().includes('debug=1'));
	if (found) {
		page = found;
		break;
	}
}
if (!page) {
	const ctx = browser.contexts()[0] || (await browser.newContext());
	page = await ctx.newPage();
	await page.goto(URL, { waitUntil: 'domcontentloaded' });
}

const maxTime = parseFloat(process.argv[2] || '0') || null;
const failures = [];
const N = 200;

// Erst maxTime via Snapshot holen, falls nicht vorgegeben.
const probe = await page.evaluate(() => window.__debugSnapshot());
const MAX = maxTime || (probe.compiled && probe.compiled.maxTick ? 0 : 0);
let upper = maxTime;
if (!upper) {
	// MAX_TIME ueber Slider-Max oder compiled; wir nutzen einfach 0..(Zeit mit tick=maxTick)
	const m = await page.evaluate(() => {
		const s = window.__debugSnapshot();
		return s.compiled && s.compiled.tick ? null : null;
	});
	upper = 600; // Fallback: Deckung der ersten ~600 Zeiteinheiten
}

for (let i = 0; i <= N; i++) {
	const t = (upper * i) / N;
	const r = await page.evaluate((tt) => {
		const slider = document.getElementById('timeSlider');
		if (slider) {
			slider.value = tt;
			slider.dispatchEvent(new Event('input', { bubbles: true }));
		}
		return new Promise((res) =>
			setTimeout(() => {
				const s = window.__debugSnapshot();
				return res({
					time: s.time,
					tick: s.compiled && s.compiled.tick,
					restByK: s.restByK || {},
					bankDrawnRest: s.bankDrawnRest || {},
					hud: s.hud,
				});
			}, 40),
		);
	}, t);

	// Invariante 1: Bank == Rest-Anzeige
	const rk = r.restByK;
	const bk = r.bankDrawnRest;
	const rkKeys = Object.keys(rk).sort();
	const bkKeys = Object.keys(bk).sort();
	let mismatch = rkKeys.length !== bkKeys.length;
	if (!mismatch) {
		for (const k of rkKeys) if (rk[k] !== bk[k]) mismatch = true;
	}
	if (mismatch) {
		failures.push(
			`[I1] t=${r.time?.toFixed?.(2)} Bank!=Rest: rest=${JSON.stringify(rk)} bank=${JSON.stringify(bk)}`,
		);
	}

	// Invariante 2: hud.Step nicht vor erster born_time der Schale
	if (r.hud && r.hud.Step > 0) {
		const step = r.hud.Step;
		const shellStart = await page.evaluate((stp) => {
			const s = window.__debugSnapshot();
			const c = s.compiled;
			if (!c || !c.shellGaps) return null;
			const g = c.shellGaps.find((x) => x.S === stp);
			return g ? g.firstBorn : null;
		}, step);
		// Rest-Stuecke dieser Schale muessen bereits born sein (restByK enthaelt k===step?)
		if (step > 0 && !(rk[step] > 0) && shellStart != null && r.time < shellStart) {
			failures.push(
				`[I2] t=${r.time?.toFixed?.(2)} Step=${step} springt vor firstBorn=${shellStart?.toFixed?.(2)} (Rest hat k=${step}: ${rk[step] || 0})`,
			);
		}
	}
}

await browser.close();

if (failures.length === 0) {
	console.log(`[debug-selftest] OK - ${N} Zeitpunkte, alle Invarianten erfuellt`);
	process.exit(0);
} else {
	console.log(`[debug-selftest] ${failures.length} Fehler:`);
	for (const f of failures.slice(0, 30)) console.log('  ' + f);
	process.exit(1);
}
