#!/usr/bin/env node
// mathjax-compare.mjs — vergleicht unseren MathJax-freien Canvas-Renderer
// (src/lib/mathCanvasRenderer.js) direkt mit ECHTEM MathJax für eine feste
// Reihe repräsentativer Ausdrücke (docs/Beschriftung.md) und legt beide
// Ergebnisse als PNG unter docs/beschriftung-vergleich/ ab - Grundlage für
// die manuelle Feinabstimmung der Konstanten in src/lib/mathMetrics.js.
//
// Unser Renderer wird über den echten Vite-Dev-Server + dynamischen
// Modul-Import geladen (kein separater Test-Build nötig, immer der
// aktuelle Code); MathJax läuft wie in scripts/mathjax-metrics.mjs
// EINMALIG/offline von der CDN, NIE im Produkt-Bundle.
//
// Aufruf: node scripts/mathjax-compare.mjs [--out <verzeichnis>]
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const FONT_PX = 60; // Vorschau-Groesse (deutlich groesser als die 12px im Exponat) fuer gut beurteilbare Bilder.
const MATHJAX_SRC = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
const outIdx = process.argv.indexOf('--out');
const OUT_DIR = (
	outIdx !== -1
		? process.argv[outIdx + 1]
		: new URL('../docs/beschriftung-vergleich/', import.meta.url).pathname
).replace(/\/$/, '');
mkdirSync(OUT_DIR, { recursive: true });

// Jeder Fall: `fn`+`args` beschreiben AUSSCHLIESSLICH mit reinen Daten
// (kein Funktions-Transfer nach page.evaluate() noetig - fragil/nicht
// zuverlaessig serialisierbar), welche mathCanvasRenderer.js-Funktion mit
// welchen Argumenten unseren Teil zeichnet. `tex` ist die MathJax-Referenz-
// Formel. `note` dokumentiert bewusste Abweichungen (z.B. hat MathJax
// keinen eingebauten "schrägen Bruch" - siehe docs/Beschriftung.md).
const CASES = [
	{
		id: '01-schraeger-bruch',
		label: 'Schräger Bruch: 1/128',
		tex: '\\(1/128\\)',
		note: 'MathJax hat keinen eingebauten schrägen (einzeiligen) Bruch - Referenz zeigt die naheliegende TeX-Entsprechung (normaler Text "1/128"). Unser Renderer hebt/senkt Zähler/Nenner bewusst (docs/Beschriftung.md "weniger Höhe").',
		fn: 'drawSlashFraction',
		args: ['1', '128'],
	},
	{
		id: '02-gerader-bruch-mit-exponent',
		label: 'Gerader Bruch mit Exponent: (1/10)^3',
		tex: '\\(\\left(\\frac{1}{10}\\right)^{3}\\)',
		fn: 'drawFractionPower',
		args: ['1', '10', '3'],
	},
	{
		id: '03a-exponent-buchstabe',
		label: 'Buchstabe mit Exponent: l^2',
		tex: '\\(l^{2}\\)',
		note: 'MathJax italisiert einzelne Variablen (Math-Italic-Font) - unser Renderer nutzt durchgehend den (aufrechten) MathJax-Main-Font, siehe docs/MATHJAX_METRICS.md §6.',
		fn: 'drawScript',
		args: ['l', '2', 'sup'],
	},
	{
		id: '03b-exponent-zahl-klein',
		label: 'Zahl mit Exponent: 2^18',
		tex: '\\(2^{18}\\)',
		fn: 'drawScript',
		args: ['2', '18', 'sup'],
	},
	{
		id: '03c-exponent-zahl-gross',
		label: 'Zahl mit Exponent: 10^5',
		tex: '\\(10^{5}\\)',
		fn: 'drawScript',
		args: ['10', '5', 'sup'],
	},
	{
		id: '04-subscript',
		label: 'Zahl mit Subscript: 1,41_10',
		tex: '\\(1{,}41_{10}\\)',
		fn: 'drawScript',
		args: ['1,41', '10', 'sub'],
	},
];

// Ruft mod[c.fn](ctx, 20, 100, ...c.args, FONT_PX, drawOpts) auf -
// drawFraction/drawFractionPower/drawSlashFraction haben die Signatur
// (ctx,x,y,numText,denText[,expText],fontPx,opts), drawScript
// (ctx,x,y,baseText,scriptText,fontPx,direction,opts) - beide passen
// exakt in "x,y,...args,FONT_PX,opts", solange FONT_PX/opts als LETZTE
// zwei feste Parameter direkt vor den variablen `args` bzw. danach stehen.
// drawScript weicht ab (direction zwischen fontPx und opts) - daher ein
// eigener Dispatch statt eines generischen Spreads.
async function drawOurs(page, id, fnName, args) {
	await page.evaluate(
		async ({ id, fnName, args, fontPx }) => {
			// Browser-absolute Pfade (vom Vite-Dev-Server aufgeloest, siehe
			// createServer() unten) - ueber eine Variable statt einem
			// String-Literal importiert, damit statische Analyse-Tools
			// (knip) das NICHT als (nicht existierenden) relativen
			// Node-Import von scripts/ aus fehlinterpretieren.
			const rendererPath = '/src/lib/mathCanvasRenderer.js';
			const fontPath = '/src/lib/mathFont.js';
			const mod = await import(/* @vite-ignore */ rendererPath);
			const fontMod = await import(/* @vite-ignore */ fontPath);
			await fontMod.ensureMathFont();
			// Body komplett leeren (nicht nur alte Canvas-Elemente entfernen):
			// die echte App (App.svelte) ist auf dieser Seite gemountet
			// (gebraucht NUR fuer den Modul-Import-Kontext) und wuerde sonst
			// mit fixed-position-Overlays (Intro-Screen, Settings-Panel) ueber
			// unserem Vergleichs-Canvas liegen.
			document.body.innerHTML = '';
			const canvas = document.createElement('canvas');
			canvas.className = 'cmp';
			canvas.id = 'cmp-' + id;
			canvas.width = 500;
			canvas.height = 220;
			document.body.appendChild(canvas);
			const ctx = canvas.getContext('2d');
			ctx.fillStyle = '#fff';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			const opts = { color: '#000', font: fontMod.MATH_FONT_STACK };
			if (fnName === 'drawScript') {
				const [baseText, scriptText, direction] = args;
				mod.drawScript(ctx, 20, 130, baseText, scriptText, fontPx, direction, opts);
			} else if (fnName === 'drawFractionPower') {
				const [numText, denText, expText] = args;
				mod.drawFractionPower(ctx, 20, 130, numText, denText, expText, fontPx, opts);
			} else if (fnName === 'drawSlashFraction') {
				const [numText, denText] = args;
				mod.drawSlashFraction(ctx, 20, 130, numText, denText, fontPx, opts);
			}
		},
		{ id, fnName, args, fontPx: FONT_PX },
	);
	const out = `${OUT_DIR}/${id}_ours.png`;
	await page.locator(`#cmp-${id}`).screenshot({ path: out });
	return out;
}

async function main() {
	const server = await createServer({ server: { port: 4299, strictPort: true } });
	await server.listen();
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 500, height: 220 } });
	await page.goto('http://localhost:4299/');

	for (const c of CASES) {
		c.outOurs = await drawOurs(page, c.id, c.fn, c.args);
	}
	await browser.close();
	await server.close();

	// --- MathJax-Referenz separat rendern (eigene Seite, siehe mathjax-metrics.mjs) ---
	const mjBrowser = await chromium.launch();
	const mjPage = await mjBrowser.newPage({ viewport: { width: 500, height: 220 } });
	const body = CASES.map((c) => `<div id="mj-${c.id}" class="case">${c.tex}</div>`).join('\n');
	await mjPage.setContent(`<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#fff;color:#000} .case{font-size:${FONT_PX}px;display:inline-block;padding:10px}</style>
<script>window.MathJax = { chtml: { displayAlign: 'left' } };</script>
<script id="MathJax-script" async src="${MATHJAX_SRC}"></script>
</head><body>${body}</body></html>`);
	await mjPage.waitForFunction(() => window.MathJax?.startup?.promise, { timeout: 30000 });
	await mjPage.evaluate(() => window.MathJax.startup.promise);
	await mjPage.waitForTimeout(200);
	for (const c of CASES) {
		const outMj = `${OUT_DIR}/${c.id}_mathjax.png`;
		await mjPage.locator(`#mj-${c.id}`).screenshot({ path: outMj });
		c.outMathjax = outMj;
	}
	await mjBrowser.close();

	// --- Übersicht schreiben ---
	let md = `# Vergleich: eigener Renderer vs. echtes MathJax\n\nAutomatisch erzeugt von \`scripts/mathjax-compare.mjs\` (FONT_PX=${FONT_PX}). Bilder in diesem Verzeichnis - links unser Renderer, rechts MathJax.\n\nNeu erzeugen: \`node scripts/mathjax-compare.mjs\`\n\n`;
	for (const c of CASES) {
		md += `## ${c.label}\n\n`;
		if (c.note) md += `> ${c.note}\n\n`;
		md += `| Unser Renderer | MathJax |\n|---|---|\n| ![](${c.id}_ours.png) | ![](${c.id}_mathjax.png) |\n\n`;
	}
	writeFileSync(`${OUT_DIR}/README.md`, md);
	console.log(`Fertig: ${OUT_DIR}/README.md (+ ${CASES.length * 2} PNGs)`);
}

await main();
