// Debug-Inspect-Agent (DEBUG-INSPECT-SPEC.md).
// Opt-in über ?debug=1. Legt window.__debugSnapshot() offen, damit ein
// Playwright-Peer (connectOverCDP an den User-Chrome) den inneren Stand per
// page.evaluate ausliest - ohne eigenes Transport-Protokoll. Optional (DEBUG_WS=1)
// sendet derselbe Snapshot zusätzlich an einen lokalen WS-Server.
import { get } from 'svelte/store';
import { configStore, playbackStore, compiledStore } from './stores.js';
import { displayStore } from './displayStore.js';

const DEBUG_PORT = import.meta.env.DEBUG_PORT || 8787;

let frameNo = 0;
let lastDt = 0;
let lastFrameTime = performance.now();
let rollingFps = 0;
let bankTransform = { zoom: 1, x: 0, y: 0 };
let canvasEl = null;

// Ob der Debug-Kanal aktiv ist (?debug=1). Der Renderer (TargetBankCanvas)
// fragt das ab, um die teure Bank-Drawn-Telemetrie (zweiter project()-Pass
// über alle sichtbaren Stücke) NUR bei aktivem Debug-Kanal zu berechnen -
// sonst kostet sie in JEDEM Frame Rechenzeit, auch ohne ?debug=1 (Regression,
// gefunden im Gespräch: massiv verlangsamte Visualisierung).
let debugEnabled = false;
export function isDebugEnabled() {
	return debugEnabled;
}

export function setDebugFrame(dt) {
	lastDt = dt;
	frameNo++;
	const now = performance.now();
	const instFps = now - lastFrameTime > 0 ? 1000 / (now - lastFrameTime) : 0;
	lastFrameTime = now;
	rollingFps = rollingFps ? rollingFps * 0.9 + instFps * 0.1 : instFps;
}

export function setDebugBankTransform(zoom, x, y) {
	bankTransform = { zoom, x, y };
}

let bankUTime = 0;
export function setDebugBankTime(t) {
	bankUTime = t;
}

let bankDrawnRest = null;
// Vom Renderer gespiegelt: welche Rest-Stuecke (k -> Anzahl) die Bank-Canvas
// in diesem Frame tatsaechlich als "Rest im Bank" zeichnet. Ermoeglicht den
// direkten Test: gezeichnete Reste == Rest-Anzeige rechts?
export function setDebugBankDrawnRest(map) {
	bankDrawnRest = map;
}

let bankDrawnDetail = null;
export function setDebugBankDrawnDetail(arr) {
	bankDrawnDetail = arr;
}

export function setDebugCanvas(el) {
	canvasEl = el;
}

function buildSnapshot() {
	const compiled = get(compiledStore);
	const playback = get(playbackStore);
	const config = get(configStore);
	const display = get(displayStore);
	let compiledView = null;
	if (compiled) {
		const ttm = compiled.GLOBAL_TTM;
		const tick = ttm ? ttm.timeToTick(playback.time) : null;
		// Zeit-Luecke pro Schale: Schalen-START (GLOBAL_SHELL_START) vs.
		// fruehstes born_time der Stuecke dieser Schale. Wenn die Luecke
		// waechst, ist das die Drift zwischen Zahlentafel (Step) und Rest.
		let shellGaps = null;
		if (compiled.GLOBAL_SHELL_START && compiled.bank_pieces) {
			shellGaps = [];
			for (let S = 0; S < compiled.GLOBAL_SHELL_START.length; S++) {
				const start = compiled.GLOBAL_SHELL_START[S];
				if (!start) continue;
				let minBorn = Infinity;
				for (const p of compiled.bank_pieces) {
					if (p.k === S && p.born_time != null && p.born_time < minBorn) {
						minBorn = p.born_time;
					}
				}
				if (minBorn !== Infinity)
					shellGaps.push({ S, shellStart: start, firstBorn: minBorn, gap: minBorn - start });
			}
		}
		compiledView = {
			l: compiled.l != null ? String(compiled.l) : null,
			l2: compiled.l2 != null ? String(compiled.l2) : null,
			R: compiled.R != null ? String(compiled.R) : null,
			piecesCount:
				compiled.bank_pieces != null
					? compiled.bank_pieces.filter((p) => p.taken_time == null).length
					: null,
			depth: config.depth,
			maxTick: ttm ? ttm.maxTick : null,
			tick: tick != null ? Math.round(tick) : null,
			shellGaps: shellGaps ? shellGaps.slice(0, 12) : null,
			pieceSample:
				compiled.bank_pieces && compiled.bank_pieces[0]
					? Object.keys(compiled.bank_pieces[0])
					: null,
		};
	}
	return {
		t: performance.now(),
		tick: playback.tick,
		time: playback.time,
		uTimeBank: bankUTime,
		playing: playback.isPlaying,
		config,
		display,
		compiled: compiledView,
		// Sichtbare Stueck-Verteilung pro Exponent k, exakt nach der Logik der
		// Rest-Widgets (born_time <= t < cut_time UND < taken_time) - aber
		// einmal gegen playbackStore.time (Zahlentafel) und einmal gegen
		// u_time (Bank-Loop). So ist die Drift direkt ablesbar.
		restByK: compiled ? buildRestByK(compiled.bank_pieces, playback.time) : null,
		restByKBank: compiled ? buildRestByK(compiled.bank_pieces, bankUTime) : null,
		// Kanonische Modus-Signatur: sortierte Liste der sichtbaren k-Werte
		// (die Menge der Stuecke, die gerade als Rest gelten). Ein Wechsel
		// dieser Signatur = ein "Modus-Wechsel". Bank und Rest muessen an
		// denselben Zeitpunkten wechseln.
		restSig: compiled ? sig(buildRestByK(compiled.bank_pieces, playback.time)) : null,
		bankSig: bankDrawnRest ? sig(bankDrawnRest) : null,
		bankDrawnRest,
		bankDrawnDetail,
		// Zahlentafel-Werte exakt wie computeLiveL (Step + N_l + N_R), damit
		// geprueft werden kann, ob l/Step mit den Rest-Stuecken synchron ist.
		hud: compiled ? buildHud(compiled, playback.time) : null,
		hudBank: compiled ? buildHud(compiled, bankUTime) : null,
		// Rohe Stuecke (nur Debug): je nach time gefiltert, um zu sehen, was
		// die Bank (layoutBox) vs Rest-Anzeige (born/cut/taken) zaehlt.
		piecesAtTime:
			compiled && compiled.bank_pieces
				? compiled.bank_pieces
						.filter(
							(p) =>
								p.born_time != null &&
								playback.time >= p.born_time &&
								playback.time < (p.cut_time ?? Infinity) &&
								playback.time <= (p.taken_time ?? Infinity),
						)
						.map((p) => ({
							k: p.k,
							born: p.born_time,
							cut: p.cut_time,
							taken: p.taken_time,
							te: p.te,
							gapHold: p.gapHoldTicks,
						}))
				: null,
		frame: {
			fps: Math.round(rollingFps * 10) / 10,
			frameNo,
			bankTransform,
			lastDt: Math.round(lastDt * 1000) / 1000,
		},
	};
}

function buildRestByK(pieces, t) {
	if (!pieces) return null;
	const byK = {};
	for (const p of pieces) {
		if (p.born_time == null || p.cut_time == null) continue;
		if (t >= p.born_time && t < p.cut_time && t <= (p.taken_time ?? Infinity)) {
			byK[p.k] = (byK[p.k] || 0) + 1;
		}
	}
	return byK;
}

// Kanonische Signatur einer k->count-Map: sortierte "k:count"-Paare als
// String. Identisch fuer gleiche sichtbare Stueck-Menge.
function sig(byK) {
	if (!byK) return null;
	return Object.keys(byK)
		.sort((a, b) => a - b)
		.map((k) => `${k}:${byK[k]}`)
		.join(',');
}

// Spiegelt computeLiveL() (Zahlentafel) nach: Step + N_l (Praefix) + N_R
// (Rest-Summe). Nutzt dieselbe Logik, damit der Debug-Vergleich exakt die
// Werte liefert, die die Zahlentafel anzeigt.
function buildHud(compiled, time) {
	const {
		GLOBAL_L_PREFIX,
		GLOBAL_SHELL_START,
		bank_pieces,
		GRID,
		AREA_SCALE,
		K_MAX,
		MAX_TIME,
		BASE: BASE_OUT,
	} = compiled;
	if (!GLOBAL_L_PREFIX) return null;
	let Step = 0;
	for (let S = 1; S < (GLOBAL_SHELL_START || []).length; S++) {
		if (time >= GLOBAL_SHELL_START[S]) Step = S;
		else break;
	}
	if (MAX_TIME !== undefined && time >= MAX_TIME) Step = GLOBAL_L_PREFIX.length - 1;
	if (Step > GLOBAL_L_PREFIX.length - 1) Step = GLOBAL_L_PREFIX.length - 1;
	const N_l = GLOBAL_L_PREFIX[Step];
	const BASE_BIG = BigInt(BASE_OUT);
	let N_R = 0n;
	if (bank_pieces) {
		for (let p of bank_pieces) {
			if (time >= p.born_time && time < p.cut_time && time <= (p.taken_time ?? Infinity)) {
				N_R += AREA_SCALE / BASE_BIG ** BigInt(p.k);
			}
		}
	}
	return {
		Step,
		N_l: N_l.toString(),
		N_R: N_R.toString(),
		GRID: GRID.toString(),
		AREA_SCALE: AREA_SCALE.toString(),
	};
}

let ws = null;
let wsThrottle = 0;

function maybeSendWs() {
	if (!ws || ws.readyState !== 1) return;
	const now = performance.now();
	if (now - wsThrottle < 200) return;
	wsThrottle = now;
	ws.send(JSON.stringify({ kind: 'debug', subtype: 'snapshot', payload: buildSnapshot() }));
}

export function initDebugAgent() {
	const params = new URLSearchParams(location.search);
	const enabled = params.has('debug');
	debugEnabled = enabled;
	const wsEnabled = enabled && (params.has('ws') || import.meta.env.DEBUG_WS);
	if (!enabled) return;

	if (wsEnabled) {
		try {
			ws = new WebSocket(`ws://localhost:${DEBUG_PORT}`);
			ws.onmessage = (e) => {
				let msg;
				try {
					msg = JSON.parse(e.data);
				} catch {
					return;
				}
				if (msg.kind !== 'debug') return;
				if (msg.subtype === 'request_shot' && canvasEl) {
					ws.send(
						JSON.stringify({
							kind: 'debug',
							subtype: 'shot',
							payload: {
								dataUrl: canvasEl.toDataURL('image/png'),
								w: canvasEl.width,
								h: canvasEl.height,
								t: performance.now(),
							},
						}),
					);
				}
				if (msg.subtype === 'request_snapshot' && ws.readyState === 1) {
					ws.send(JSON.stringify({ kind: 'debug', subtype: 'snapshot', payload: buildSnapshot() }));
				}
			};
		} catch {
			ws = null;
		}
	}

	window.__debugSnapshot = buildSnapshot;
	if (wsEnabled) {
		displayStore.subscribe(maybeSendWs);
		playbackStore.subscribe(maybeSendWs);
	}
}
