// Debug-Modus-Test: scannt die Zeitachse IN EINEM evaluate-Aufruf (kein
// Roundtrip pro Punkt) und misst, wo Bank-Signatur (bankSig) und
// Rest-Signatur (restSig) ihre Modi wechseln. Unterschiedliche
// Wechsel-Zeitpunkte = Drift zwischen Bank und Rest-Visualisierung.
//
// Nutzung: node scripts/debug-mode-test.mjs [maxTime] [steps]
import { chromium } from '@playwright/test';

const CDP = process.env.CDP_HOST || 'http://localhost:9222';
const URL = process.env.DEBUG_URL || 'http://localhost:5173/?debug=1';

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

const upper = parseFloat(process.argv[2] || '120');
const N = parseInt(process.argv[3] || '600', 10);

const result = await page.evaluate(
	({ upper, N }) => {
		const slider = document.getElementById('timeSlider');
		const samples = [];
		for (let i = 0; i <= N; i++) {
			const t = (upper * i) / N;
			if (slider) {
				slider.value = t;
				slider.dispatchEvent(new Event('input', { bubbles: true }));
			}
			const s = window.__debugSnapshot();
			samples.push({ time: s.time, bankSig: s.bankSig, restSig: s.restSig });
		}
		// zurueck auf 0
		if (slider) {
			slider.value = 0;
			slider.dispatchEvent(new Event('input', { bubbles: true }));
		}
		function transitions(sigKey) {
			const out = [];
			let prev = null;
			for (const s of samples) {
				const cur = s[sigKey];
				if (cur !== prev) {
					out.push({ time: s.time, from: prev, to: cur });
					prev = cur;
				}
			}
			return out;
		}
		return { bankT: transitions('bankSig'), restT: transitions('restSig') };
	},
	{ upper, N },
);

const fs = await import('node:fs');
const out = [];
out.push(`=== BANK-Wechsel (${result.bankT.length}) ===`);
for (const w of result.bankT) out.push(`  t=${w.time?.toFixed?.(3)}  ${w.from} -> ${w.to}`);
out.push(`=== REST-Wechsel (${result.restT.length}) ===`);
for (const w of result.restT) out.push(`  t=${w.time?.toFixed?.(3)}  ${w.from} -> ${w.to}`);

const n = Math.max(result.bankT.length, result.restT.length);
let diffs = 0;
const diffLines = [];
for (let i = 0; i < n; i++) {
	const b = result.bankT[i];
	const r = result.restT[i];
	if (!b || !r || b.to !== r.to) {
		diffs++;
		diffLines.push(`  [DIFF] bank->${b?.to ?? '∅'}  rest->${r?.to ?? '∅'}`);
	}
}
out.push(
	`\nBank-Wechsel=${result.bankT.length} Rest-Wechsel=${result.restT.length} Diffs=${diffs}`,
);
out.push(...diffLines);
fs.writeFileSync('/tmp/opencode/debug-mode-result.txt', out.join('\n'));
console.log('written to /tmp/opencode/debug-mode-result.txt');
await browser.close();
process.exit(diffs > 0 ? 1 : 0);
