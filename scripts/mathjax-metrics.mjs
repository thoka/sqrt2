#!/usr/bin/env node
// mathjax-metrics.mjs — untersucht MathJax' CHTML-Ausgabe (dieselbe Version/
// Config, die dieses Projekt frueher fuer die Zahlentafel nutzte, siehe
// Commit b3adf99^:index.html: MathJax 3, `tex-mml-chtml.js`,
// `{ chtml: { displayAlign: 'left' } }`) und extrahiert die GEOMETRISCHEN
// Verhaeltnisse (Bruchstrich-Dicke, Abstaende, Schriftgroessen-Skalierung
// von Zaehler/Nenner/Exponent), damit `src/lib/mathMetrics.js` dieselbe
// Optik OHNE MathJax nachbauen kann (siehe docs/MATHJAX_METRICS.md).
//
// MathJax selbst darf NICHT im Produkt laufen (siehe TODO.md-Historie:
// pro-Frame `typesetPromise` blockierte den rAF-Loop, Hauptursache des
// Flug-Stotterns, entfernt in Commit b3adf99). Dieses Skript ist ein
// EINMALIGES Analyse-Tool (Node/Playwright, offline von der Haupt-App),
// kein Teil des Laufzeit-Codes - laeuft nur bei Bedarf erneut, wenn die
// Metriken neu vermessen werden sollen (z.B. nach einem MathJax-Update).
//
// Aufruf: node scripts/mathjax-metrics.mjs [--json out.json]
import { chromium } from '@playwright/test';

const FONT_PX = 200; // gross gewaehlt, damit Sub-Pixel-Rundung kaum ins Gewicht faellt
const MATHJAX_SRC = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';

// Test-Faelle: TeX-Quelle + Label. `frac`/`sup` je einmal inline (Textstyle,
// wie in einem Satz) UND display (Displaystyle) - unser Anwendungsfall
// (kompakte Achsen-Beschriftung neben kleinen Rechtecken) ist naeher an
// Textstyle, aber wir vermessen beide zum Vergleich (siehe docs).
const CASES = [
	{ id: 'frac_inline', tex: '\\(\\frac{1}{8}\\)' },
	{ id: 'frac_display', tex: '\\[\\frac{1}{8}\\]' },
	{ id: 'frac_big_inline', tex: '\\(\\frac{1}{1000000}\\)' },
	{ id: 'paren_frac_pow_inline', tex: '\\(\\left(\\frac{1}{2}\\right)^{3}\\)' },
	{ id: 'sup_inline', tex: '\\(x^{3}\\)' },
	{ id: 'sub_inline', tex: '\\(1.4142_{10}\\)' },
	{ id: 'digit_reference', tex: '\\(0\\)' }, // Referenz-Bounding-Box eines einzelnen Ziffernglyphen
];

function buildHtml() {
	const body = CASES.map((c) => `<div id="${c.id}" class="case">${c.tex}</div>`).join('\n');
	return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { margin: 0; background: #0f172a; color: #f8fafc; }
  .case { font-size: ${FONT_PX}px; display: inline-block; padding: 0; margin: 0; }
</style>
<script>window.MathJax = { chtml: { displayAlign: 'left' }, startup: { typeset: true } };</script>
<script id="MathJax-script" async src="${MATHJAX_SRC}"></script>
</head><body>
${body}
</body></html>`;
}

// Rekursiv den DOM-Teilbaum EINES gerenderten Ausdrucks einsammeln: fuer
// jedes Element Tag/Klasse/BoundingRect (RELATIV zum <mjx-container>, damit
// die Zahlen unabhaengig von der Position auf der Seite sind) + font-size.
async function collectTree(page, rootSelector) {
	return page.evaluate((rootSelector) => {
		const root = document.querySelector(rootSelector + ' mjx-container');
		if (!root) return null;
		const rootRect = root.getBoundingClientRect();
		function walk(el) {
			const r = el.getBoundingClientRect();
			const cs = getComputedStyle(el);
			return {
				tag: el.tagName.toLowerCase(),
				cls: el.className || null,
				x: +(r.left - rootRect.left).toFixed(3),
				y: +(r.top - rootRect.top).toFixed(3),
				w: +r.width.toFixed(3),
				h: +r.height.toFixed(3),
				fontSize: +parseFloat(cs.fontSize).toFixed(3),
				children: Array.from(el.children).map(walk),
			};
		}
		return { rootRect: { w: rootRect.width, h: rootRect.height }, tree: walk(root) };
	}, rootSelector);
}

async function main() {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
	await page.setContent(buildHtml());
	// MathJax laedt asynchron ueber CDN + typesettet danach - auf beides warten.
	await page.waitForFunction(() => window.MathJax?.startup?.promise, { timeout: 30000 });
	await page.evaluate(() => window.MathJax.startup.promise);
	await page.waitForTimeout(200); // Layout/Fonts sicher eingeschwungen

	const report = { fontPx: FONT_PX, mathjaxSrc: MATHJAX_SRC, cases: {} };
	for (const c of CASES) {
		report.cases[c.id] = await collectTree(page, '#' + c.id);
	}

	const shotIdx = process.argv.indexOf('--screenshot');
	if (shotIdx !== -1) {
		const dir = process.argv[shotIdx + 1];
		const fs = await import('node:fs');
		fs.mkdirSync(dir, { recursive: true });
		for (const c of CASES) {
			const el = page.locator('#' + c.id);
			await el.screenshot({ path: `${dir}/${c.id}.png` });
		}
	}

	await browser.close();
	return report;
}

function findByTagIncludes(node, needle, out = []) {
	if (node.tag.includes(needle)) out.push(node);
	for (const ch of node.children || []) findByTagIncludes(ch, needle, out);
	return out;
}

// Tiefstes Blatt-Element (kein Kind mehr) - das eigentliche Glyphen-Element
// (z.B. `mjx-c` fuer ein einzelnes Zeichen). Dessen font-size ist die
// verlaessliche "1 Text-Einheit"-Referenz - NICHT unser CSS-`font-size` auf
// dem umgebenden Container (MathJax rechnet intern mit eigenen `em`-Stufen,
// s. docs/MATHJAX_METRICS.md "Normalisierung").
function firstLeaf(node) {
	if (!node.children || node.children.length === 0) return node;
	return firstLeaf(node.children[0]);
}

function summarize(report) {
	const lines = [];
	const push = (s) => lines.push(s);

	// Referenz-Textgroesse: das Blatt-Glyph im "digit_reference"-Fall (ein
	// einzelnes "0", kein Bruch/Skript) - siehe firstLeaf()-Kommentar.
	const refLeaf = firstLeaf(report.cases['digit_reference'].tree);
	const REF_FONT = refLeaf.fontSize;
	push(`# MathJax-Metriken (automatisch erzeugt, FONT_PX(CSS)=${report.fontPx})\n`);
	push(
		`Referenz-Textgroesse (Blatt-Glyph "0", digit_reference): fontSize=${REF_FONT.toFixed(2)}px, h=${refLeaf.h.toFixed(2)}px\n`,
	);

	for (const [id, data] of Object.entries(report.cases)) {
		if (!data) {
			push(`## ${id}\n(kein <mjx-container> gefunden)\n`);
			continue;
		}
		push(`## ${id}`);
		push(`Container: ${data.rootRect.w.toFixed(2)} x ${data.rootRect.h.toFixed(2)} px`);

		const nums = findByTagIncludes(data.tree, 'mjx-num');
		const dens = findByTagIncludes(data.tree, 'mjx-den');
		const lines_ = findByTagIncludes(data.tree, 'mjx-line');
		const scripts = findByTagIncludes(data.tree, 'mjx-script');
		const ratio = (px) => (px / REF_FONT).toFixed(4);
		if (nums.length) {
			const n = nums[0];
			push(
				`  mjx-num: y=${n.y.toFixed(2)} h=${n.h.toFixed(2)} fontSize=${n.fontSize.toFixed(2)} (Skalierung ggue. Referenz=${ratio(n.fontSize)})`,
			);
		}
		if (lines_.length) {
			const l = lines_[0];
			push(
				`  mjx-line (Bruchstrich): y=${l.y.toFixed(2)} h=${l.h.toFixed(2)} (Dicke/Referenz=${ratio(l.h)})`,
			);
		}
		if (dens.length) {
			const d = dens[0];
			push(
				`  mjx-den: y=${d.y.toFixed(2)} h=${d.h.toFixed(2)} fontSize=${d.fontSize.toFixed(2)} (Skalierung ggue. Referenz=${ratio(d.fontSize)})`,
			);
		}
		if (scripts.length) {
			const s = scripts[0];
			push(
				`  mjx-script (Exponent): y=${s.y.toFixed(2)} h=${s.h.toFixed(2)} fontSize=${s.fontSize.toFixed(2)} (Skalierung ggue. Referenz=${ratio(s.fontSize)})`,
			);
		}
		push('');
	}
	return lines.join('\n');
}

// Leitet die vier Konstanten ab, die `src/lib/mathMetrics.js` tatsaechlich
// braucht - direkt hier im Skript berechnet (nicht per Hand aus der Text-
// Ausgabe abgetippt), damit eine Neu-Vermessung reproduzierbar dieselben
// Zahlen liefert. Methodik + Validierung: docs/MATHJAX_METRICS.md.
function findAll(node, pred, out = []) {
	if (pred(node)) out.push(node);
	for (const ch of node.children || []) findAll(ch, pred, out);
	return out;
}

// Echtes Zeichen-Glyph finden (Tag `mjx-c`) - NICHT firstLeaf() nutzen: das
// erste Kind vieler Boxen (mjx-num/mjx-den/...) ist ein unsichtbarer
// `mjx-nstrut`/`mjx-dstrut` (Abstandshalter fuer die Grundlinie), der zwar
// selbst blattfoermig ist (keine Kinder), aber NICHT die tatsaechlich
// skalierte Glyphen-Schriftgroesse traegt (Bug in einer frueheren Version
// dieses Skripts: firstLeaf() griff den Strut statt der Ziffer, verwaesserte
// SCRIPT_SCALE von 0.707 auf 0.85 - siehe docs/MATHJAX_METRICS.md).
function findGlyph(node) {
	const hit = findAll(node, (n) => n.tag === 'mjx-c');
	return hit[0] || firstLeaf(node);
}

function deriveConstants(report) {
	const ref = findGlyph(report.cases['digit_reference'].tree); // Glyph "0"
	const FONT = ref.fontSize;
	const baselineY = ref.y + ref.h; // Unterkante einer Ziffer ohne Unterlaenge ~ Grundlinie

	// SCRIPT_SCALE: Schriftgroesse von Zaehler/Nenner (Bruch) UND Exponent/
	// Index (hoch-/tiefgestellt) relativ zur Grundschrift - EIN Wert fuer
	// beide Faelle (siehe docs: identisch gemessen, TeX-"eine Scriptlevel-
	// Stufe runter", MathJax-Default ≈ 1/√2).
	const fracNumGlyph = findAll(report.cases['frac_inline'].tree, (n) => n.tag === 'mjx-num')[0];
	const fracNumTextGlyph = findGlyph(fracNumGlyph);
	const supGlyph = findGlyph(
		findAll(report.cases['sup_inline'].tree, (n) => n.tag === 'mjx-script')[0],
	);
	const SCRIPT_SCALE = (fracNumTextGlyph.fontSize / FONT + supGlyph.fontSize / FONT) / 2;

	// RULE_THICKNESS / RULE_GAP: Bruchstrich-Dicke + Abstand Zaehler->Strich
	// bzw. Strich->Nenner, relativ zur GRUNDSCHRIFT (nicht zur reduzierten
	// Zaehler/Nenner-Schrift) - siehe docs, beide empirisch ~gleich gross.
	const frac = report.cases['frac_inline'].tree;
	const num = findAll(frac, (n) => n.tag === 'mjx-num')[0];
	const line = findAll(frac, (n) => n.tag === 'mjx-line')[0];
	const den = findAll(frac, (n) => n.tag === 'mjx-den')[0];
	const RULE_THICKNESS = line.h / FONT;
	const RULE_GAP = (line.y - (num.y + num.h) + (den.y - (line.y + line.h))) / 2 / FONT;

	// SUP_SHIFT / SUB_SHIFT: wie weit die Grundlinie von Exponent/Index
	// gegenueber der normalen Grundlinie angehoben/abgesenkt wird, relativ
	// zur Grundschrift.
	const sup = report.cases['sup_inline'].tree;
	const baseGlyph = findGlyph(findAll(sup, (n) => n.tag === 'mjx-mi')[0]);
	const expGlyph = findGlyph(findAll(sup, (n) => n.tag === 'mjx-script')[0]);
	const SUP_SHIFT = (baseGlyph.y + baseGlyph.h - (expGlyph.y + expGlyph.h)) / FONT;

	const sub = report.cases['sub_inline'].tree;
	const subScriptGlyph = findGlyph(findAll(sub, (n) => n.tag === 'mjx-script')[0]);
	const SUB_SHIFT = (subScriptGlyph.y + subScriptGlyph.h - baselineY) / FONT;

	return {
		SCRIPT_SCALE: +SCRIPT_SCALE.toFixed(4),
		RULE_THICKNESS: +RULE_THICKNESS.toFixed(4),
		RULE_GAP: +RULE_GAP.toFixed(4),
		SUP_SHIFT: +SUP_SHIFT.toFixed(4),
		SUB_SHIFT: +SUB_SHIFT.toFixed(4),
	};
}

const report = await main();
console.log(summarize(report));

const constants = deriveConstants(report);
console.log('## Abgeleitete Konstanten (relativ zur Grundschriftgroesse fontPx)\n');
console.log(JSON.stringify(constants, null, 2));

const jsonIdx = process.argv.indexOf('--json');
if (jsonIdx !== -1) {
	const fs = await import('node:fs');
	fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify({ ...report, constants }, null, 2));
	console.log(`\nVoller Report: ${process.argv[jsonIdx + 1]}`);
}
