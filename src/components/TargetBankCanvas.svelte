<script>
	// TargetBankCanvas (TOOLING_SPEC.md Phase 4a) - Wrapper um das
	// bestehende Canvas-Rendering (renderFrame() + Helfer) aus sqrt2.html.
	// Die Zeichen-Logik wurde 1:1 portiert (NICHT neu designt), nur die
	// Datenquelle wechselt: statt Modul-Scope-Variablen in sqrt2.html
	// hält DIESE Komponente ihren eigenen Render-State als lokale Variablen
	// (gleiche Namen wie zuvor, damit renderFrame() weitgehend unverändert
	// bleibt) und füllt ihn aus configStore/compiledStore/playbackStore.
	//
	// playbackStore bleibt die Schnittstelle nach außen: <PlaybackBar>/
	// <ControlPanel> schreiben isPlaying/time, applyPlayback() (unten)
	// spiegelt es in die lokalen Variablen zurück, und die rAF-Loop
	// schreibt die fortschreitende Zeit zurück in playbackStore - genau
	// wie zuvor in sqrt2.html, nur in der Komponente gekapselt.
	//
	// Cross-Komponenten-DOM (bankZoomLabel/bankAreaLabel/autoZoomMarker/
	// autoZoomNote werden in <ControlPanel> gerendert, #bankPanel für
	// renderAreaWidth) wird per getElementById geholt - dieselben globalen
	// Elemente wie vorher, nur dass die Komponente sie liest statt
	// sqrt2.html.
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { applyCompactionFit } from '../lib/bank-core.js';
	import { layoutCentered, findRect, commonAncestor } from '../lib/recursive-layout.js';
	import { configStore, playbackStore, compiledStore } from '../lib/stores.js';
	import { computeLiveL } from '../lib/compiler.js';
	import { formatLiveNumbers } from '../lib/numberRenderer.js';
	import { clampDt } from '../lib/timeStep.js';
	import { morphRect, computeRotation, rotationAngle } from '../lib/morphRect.js';
	import {
		setDebugCanvas,
		setDebugFrame,
		setDebugBankTransform,
		setDebugBankTime,
		setDebugBankDrawnRest,
		setDebugBankDrawnDetail,
		isDebugEnabled,
	} from '../lib/debugAgent.js';
	import { es2018 } from 'globals';

	const COLORS = [
		'#cbd5e1',
		'#ef476f',
		'#ffd166',
		'#06d6a0',
		'#118ab2',
		'#8338ec',
		'#f78c6b',
		'#ff006e',
		'#3a86ff',
		'#fb5607',
		'#ffbe0b',
	];

	// === Render-State (war in sqrt2.html Modul-Scope) ===
	let N_MAX = 16;
	let BASE = 10;
	let TOTAL_STEPS = 0;
	let MAX_TIME = 0;
	let P_FINAL = 0;
	let render_pipeline = [];
	let bank_pieces = [];
	let axes = [];

	let GLOBAL_N_ARR = [];
	let GLOBAL_SHELL_START = [];
	let BANK_ZOOM_THRESHOLD_POWERS = 0;
	let GLOBAL_AUTO_ZOOM_CHECKPOINTS = [];
	let GLOBAL_AUTO_ZOOM_SPLINE = null;
	// TEIL D (REST-PRECISION-PLAN): rekursives Box-in-Boxes-Modell ersetzt die
	// Kompaktierungs-Wegpunkte (Teil C) als BANK-Rendering-/Zoom-Quelle -
	// bank_root ist der Wurzel-Knoten von bank_pieces (id 0), aus dem
	// layoutBox() pro Frame live die sichtbaren Rects + Moment/Masse berechnet.
	let GLOBAL_TEIL_D_ZOOM_SPLINE = null;
	let bank_root = null;

	// === Dynamic Layout & HUD-State ===
	let DYN_TARGET_W = 1.0;
	let dyn_prefA = [];
	let dyn_axes_w = [];
	let _lastLayoutT_AB = null;

	// === Playback/Laufzeit-State ===
	let isPlaying = false;
	let animDirection = 1;
	let animPause = 0;
	let u_time = 0.0;
	let u_mode_AB = 0.0;
	// Vollstaendiger kompilierter Zustand (fuer computeLiveL der
	// Canvas-gezeichneten Zahlentafel l/l²/R) - nur in applyConfig
	// frisch gesetzt, NICHT pro Frame neu geholt.
	let compiledRef = null;

	let AUTO_ZOOM_MIN_PX = 0;
	let RENDER_SCALE = 1;
	let EDGE_BLUR_PX = 0;
	let LINE_WIDTH_PX = 0.3;
	let ANIM_PAUSE_DURATION = 1.5;
	let ANIM_SPEED = 2.0;
	let FLYING_ALPHA = 0.59;
	// Maximal erlaubter Zeitschritt pro Frame (Sekunden). Ein einzelner
	// langer Frame (GC/Compile/Tab-Throttle) wird darauf begrenzt, damit
	// die Simulation keinen sichtbaren Vorwaertssprung macht.
	const MAX_FRAME_DT = 0.05;
	let bankRenderEnabled = true; // Diagnose-Schalter: Bank-Canvas (inkl. Flug) einfrieren

	// === Canvas ===
	let canvasEl = $state();
	let ctx = null;
	let bankZoomLabel, bankAreaLabel, autoZoomMarker, autoZoomNote, bankPanel;

	let lastTime = performance.now();
	let _lastCompileKey;
	let _suppressPlaybackRender = false;

	function compileRelevantKey(c) {
		return JSON.stringify([
			c.base,
			c.depth,
			c.transformMode,
			c.bankZoomThresholdPowers,
			c.zoomSpeedCoef,
			c.compactionEnabled,
			c.compactionTransitionTicks,
		]);
	}
	function applyConfig(c) {
		try {
			N_MAX = c.depth;
			BASE = c.base;
			BANK_ZOOM_THRESHOLD_POWERS = c.bankZoomThresholdPowers;
			u_mode_AB = c.modeAB;
			AUTO_ZOOM_MIN_PX = c.autoZoomMinPx;
			LINE_WIDTH_PX = c.lineWidth;
			ANIM_PAUSE_DURATION = c.pauseDuration;
			ANIM_SPEED = c.playSpeed;
			FLYING_ALPHA = c.flyingAlpha;
			bankRenderEnabled = c.bankRenderEnabled;

			let compiled = get(compiledStore);
			compiledRef = compiled;
			if (!compiled) {
				// Asynchroner Compile (compileOrchestrator) noch nicht fertig:
				// config-Felder sind gesetzt, aber die kompilierten Daten
				// fehlen noch. Wir warten auf den nächsten applyConfig-Aufruf
				// (der per compiledStore-Update erfolgt), kein Fehler.
				return;
			}
			axes = compiled.axes;
			TOTAL_STEPS = compiled.TOTAL_STEPS;
			bank_pieces = compiled.bank_pieces;
			render_pipeline = compiled.render_pipeline;
			GLOBAL_N_ARR = compiled.GLOBAL_N_ARR;
			P_FINAL = compiled.P_FINAL;
			GLOBAL_SHELL_START = compiled.GLOBAL_SHELL_START;
			GLOBAL_AUTO_ZOOM_CHECKPOINTS = compiled.GLOBAL_AUTO_ZOOM_CHECKPOINTS;
			GLOBAL_AUTO_ZOOM_SPLINE = compiled.GLOBAL_AUTO_ZOOM_SPLINE;
			GLOBAL_TEIL_D_ZOOM_SPLINE = compiled.GLOBAL_TEIL_D_ZOOM_SPLINE;
			bank_root = bank_pieces.length > 0 ? bank_pieces[0] : null;
			MAX_TIME = compiled.MAX_TIME;

			let key = compileRelevantKey(c);
			if (_lastCompileKey !== undefined && key !== _lastCompileKey) {
				_suppressPlaybackRender = true;
				playbackStore.update((p) => ({ ...p, time: 0 }));
				_suppressPlaybackRender = false;
			}
			_lastCompileKey = key;
			updateOutputs();
		} catch (e) {
			let errorMsg = document.getElementById('errorMsg');
			if (errorMsg) {
				errorMsg.style.display = 'block';
				errorMsg.innerText = `Compiler-Absturz: ${e}`;
			}
			playbackStore.update((p) => ({ ...p, isPlaying: false }));
		}
	}

	function updateDynamicLayout(t_AB) {
		if (t_AB === _lastLayoutT_AB) return;
		_lastLayoutT_AB = t_AB;
		let b_eff = Math.pow(BASE, 1.0 - t_AB);
		if (b_eff < 1.000001) b_eff = 1.000001;
		dyn_prefA = [0];
		dyn_axes_w = [1.0];
		let sumA = 1.0;
		for (let i = 1; i < TOTAL_STEPS; i++) {
			let val = Math.pow(b_eff, -axes[i].exp);
			dyn_prefA.push(sumA);
			dyn_axes_w.push(val);
			sumA += val;
		}
		let nextDigitMargin = Math.pow(b_eff, -(N_MAX + 1));
		DYN_TARGET_W = sumA + nextDigitMargin;
	}

	function getSmoothedAutoZoomExp(time) {
		if (GLOBAL_AUTO_ZOOM_CHECKPOINTS.length === 0) return 0;
		return GLOBAL_AUTO_ZOOM_SPLINE(time);
	}

	function computeAutoZoomTAB(thresholdPx, scale, targetExp) {
		if (thresholdPx <= 0 || TOTAL_STEPS <= 1) return 0;
		function widthAt(t_AB) {
			let b_eff = Math.pow(BASE, 1.0 - t_AB);
			if (b_eff < 1.000001) b_eff = 1.000001;
			let sumA = 1.0;
			for (let i = 1; i < TOTAL_STEPS; i++) sumA += Math.pow(b_eff, -axes[i].exp);
			let DYN_W = sumA + Math.pow(b_eff, -(N_MAX + 1));
			let V_SCALE_TARGET = P_FINAL / DYN_W;
			return Math.pow(b_eff, -targetExp) * V_SCALE_TARGET * scale;
		}
		const STEPS = 200;
		let prevT = 0,
			prevWidth = widthAt(0);
		if (prevWidth >= thresholdPx) return 0;
		let bestT = 0,
			bestWidth = prevWidth;
		for (let i = 1; i <= STEPS; i++) {
			let t = i / STEPS;
			let w = widthAt(t);
			if (w > bestWidth) {
				bestWidth = w;
				bestT = t;
			}
			if (w >= thresholdPx) {
				let frac = (thresholdPx - prevWidth) / (w - prevWidth);
				return prevT + frac * (t - prevT);
			}
			prevT = t;
			prevWidth = w;
		}
		return bestT;
	}

	function renderFrame() {
		if (!ctx) return; // 2D-Kontext fehlt (z.B. jsdom/SSR) - Rendering überspringen
		if (!bankRenderEnabled) return; // Diagnose-Schalter: Bank-Canvas (inkl. Flug) einfrieren
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
		if (render_pipeline.length === 0) return;

		ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
		const W = canvasEl.width / RENDER_SCALE;
		const H = canvasEl.height / RENDER_SCALE;

		const SQRT2 = Math.SQRT2;
		const LOGICAL_MAX_W = SQRT2 + 0.1 + 1.0;
		const LOGICAL_MAX_H = SQRT2;
		const rightEdgeStart = bankPanel.getBoundingClientRect().left;
		const renderAreaWidth = rightEdgeStart - 40;
		const scale = Math.min(renderAreaWidth / LOGICAL_MAX_W, (H - 100) / LOGICAL_MAX_H);

		// Zahlentafel startet RECHTS vom Ziel-Quadrat: das Ziel liegt im
		// logischen Bereich x in [0, SQRT2] (links im Spielfeld), daher
		// rechte Kante = 40(CSS) + scale*SQRT2, umgerechnet in
		// Geraetepixel. (bankPanel ist das FERNSTE Rechts - dort darf die
		// Tafel NICHT beginnen.)
		hudX0 = (40 + scale * SQRT2) * RENDER_SCALE + 28;

		let autoZoomTargetExp = getSmoothedAutoZoomExp(u_time);
		let autoZoomTAB = computeAutoZoomTAB(AUTO_ZOOM_MIN_PX, scale, autoZoomTargetExp);

		let effective_t_AB = Math.max(u_mode_AB, autoZoomTAB);
		updateAutoZoomIndicator(autoZoomTAB, effective_t_AB > u_mode_AB + 1e-9);

		updateDynamicLayout(effective_t_AB);

		const V_SCALE_TARGET = P_FINAL / DYN_TARGET_W;
		const V_SCALE_BANK = 1.0;

		const BANK_X_OFFSET = SQRT2 + 0.1;

		// TEIL D (REST-PRECISION-PLAN): BANK-Seite kommt jetzt ausschließlich aus
		// dem rekursiven Box-in-Boxes-Modell (recursive-layout.js), EINE
		// Traversierung pro Frame (layoutCentered liefert Rects UND Moment/
		// Masse zusammen - kein doppeltes Layout). layoutCentered() statt
		// layoutBox() direkt: zentriert das sichtbare Ergebnis ungewichtet
		// im [0,1]-Bank-Raum statt es an der unteren linken Ecke kleben zu
		// lassen (Gesprächsverlauf) - MUSS mit derselben Zentrierung
		// arbeiten wie findRect() und die Kamera-Spline-Vorberechnung in
		// compiler.js. Die Kamera (teilDCamera) ist gedämpft
		// (GLOBAL_TEIL_D_ZOOM_SPLINE, siehe compiler.js) - die Rects selbst
		// bleiben exakt/ungedämpft.
		let bank_out = [];
		let { frame: bank_frame } = bank_root
			? layoutCentered(bank_root, u_time, bank_out)
			: { frame: { w: 0, h: 0, mass: 0, momentX: 0, momentY: 0 } };
		let teilDCamera = GLOBAL_TEIL_D_ZOOM_SPLINE
			? GLOBAL_TEIL_D_ZOOM_SPLINE.at(u_time)
			: { z: 1, cx: 0.5, cy: 0.5, offsetX: 0, offsetY: 0 };
		if (bankZoomLabel) bankZoomLabel.innerText = formatZoomFactor(teilDCamera.z);
		if (bankAreaLabel)
			bankAreaLabel.innerText =
				(bank_frame.mass * 100).toLocaleString('de-DE', {
					maximumFractionDigits: bank_frame.mass < 0.01 ? 4 : 1,
				}) + '%';

		// Debug-Telemetrie: Bank-Zoom-Transform fuer den Inspect-Kanal melden.
		// Die Bank-Drawn-Reste selbst werden NICHT hier in einem eigenen
		// project()-Pass ermittelt (das verdoppelte die teure Projektion für
		// JEDES sichtbare Stück in JEDEM Frame, auch ohne ?debug=1 - Regression,
		// siehe DEBUG-INSPECT-SPEC.md) - stattdessen unten als Nebeneffekt der
		// ohnehin laufenden Render-Schleife, NUR wenn isDebugEnabled().
		setDebugBankTransform(teilDCamera.z, teilDCamera.cx, teilDCamera.cy);
		const debugOn = isDebugEnabled();

		ctx.save();
		ctx.translate(50, H - 50);
		ctx.scale(1, -1);

		function project(x, y, w, h, isTarget, bankRect, camera = teilDCamera) {
			if (isTarget) {
				let final_x = x * V_SCALE_TARGET;
				let final_y = y * V_SCALE_TARGET;
				let final_w = w * V_SCALE_TARGET;
				let final_h = h * V_SCALE_TARGET;
				return [final_x * scale, final_y * scale, final_w * scale, final_h * scale];
			}
			if (!bankRect) return [0, 0, 0, 0];
			let r = applyCompactionFit(bankRect, camera);
			let final_x = BANK_X_OFFSET + r.x * V_SCALE_BANK;
			let final_y = r.y * V_SCALE_BANK;
			let final_w = r.w * V_SCALE_BANK;
			let final_h = r.h * V_SCALE_BANK;
			return [final_x * scale, final_y * scale, final_w * scale, final_h * scale];
		}

		// Herkunfts-Position eines fliegenden Stücks: EIN fester Zeitpunkt
		// reicht (keine kontinuierlich mitlaufende Bank-Position nötig, siehe
		// Gesprächsverlauf) - ein geschnittenes (nicht-Blatt) Stück ist im
		// GESAMTEN Intervall [born_time,cut_time) konstant in Design-Größe,
		// ein entnommenes Blatt ist bei taken_time noch exakt in Design-Größe
		// (die Hold-Phase hat noch nicht zu schrumpfen begonnen). WICHTIG: die
		// KAMERA muss an DEMSELBEN eingefrorenen Zeitpunkt ausgewertet werden,
		// nicht bei der aktuellen u_time (teilDCamera) - sonst wird das
		// eingefrorene Rect mit einem SPÄTEREN (typischerweise stärker
		// gezoomten) Kamerastand kombiniert und erscheint in falscher Größe
		// (Bug, im Gespräch gefunden: "Teile fliegen nicht in der richtigen
		// Größe los").
		//
		// Z_micro braucht eine ZUSÄTZLICHE Regel: die bis zu BASE Geschwinger
		// einer Zerschneiden-Gruppe (derselbe Schnitt, gemeinsames time_cut/
		// time_fly/time_fuse) MÜSSEN alle am SELBEN Zeitpunkt abgefragt werden
		// - sonst driften sie relativ zueinander auseinander, weil ihr
		// gemeinsamer Vorfahre zwischenzeitlich durch UNABHÄNGIGE Kompaktierung
		// anderswo im Baum weiterrückt (jedes Geschwister hat ein anderes
		// EIGENES taken_time). born_time ist für die GANZE Gruppe identisch
		// (alle Kinder desselben Schnitts) - im Gespräch gefunden: ohne diese
		// Regel clusterten/überlappten die fliegenden Geschwister sichtbar.
		// PERFORMANCE-FIX (REST-PRECISION-PLAN, Stand 2026-07-17): der
		// Normalfall braucht hier gar keine Berechnung mehr - bp.flightOrigin
		// wurde bereits als Nebeneffekt der bank_out-Schleife oben eingefroren,
		// sobald u_time bp.flightQueryTime (= dieselbe t-Regel wie vormals hier
		// inline: born_time bei geteilten/Z_micro-Stücken, sonst taken_time)
		// erreicht hat. Nur wenn direkt in einen Zeitpunkt GESPRUNGEN wird
		// (Scrubbing), an dem die bank_out-Schleife dieses Stück nie besucht
		// hat, bleibt flightOrigin leer - dann (und NUR dann) einmaliger
		// historischer Fallback über findRect(), dessen Ergebnis ebenfalls
		// gecacht wird (kein wiederholter Aufruf in Folge-Frames).
		function bankOriginState(p) {
			if (!bank_root) return null;
			let bp = p.bp;
			// bp.flightOrigin: null = noch nicht versucht, false = versucht und
			// NICHT gefunden (z.B. Stück zu flightQueryTime bereits geprunt -
			// seltener, aber realer Fall, siehe Fund unten), sonst das Ergebnis.
			// `false` MUSS genauso gecacht werden wie ein Treffer - sonst würde
			// genau dieser (seltene, aber nicht einmalige) Fehlschlag jeden
			// einzelnen Frame erneut den vollen findRect()-Fallback auslösen und
			// den Fix für GENAU diese Stücke wirkungslos machen.
			if (bp.flightOrigin !== null) return bp.flightOrigin || null;
			let t = bp.flightQueryTime;
			let rect = findRect(bank_root, t, bp.id);
			if (!rect) {
				bp.flightOrigin = false;
				return null;
			}
			let camera = GLOBAL_TEIL_D_ZOOM_SPLINE
				? GLOBAL_TEIL_D_ZOOM_SPLINE.at(t)
				: { z: 1, cx: 0.5, cy: 0.5, offsetX: 0, offsetY: 0 };
			bp.flightOrigin = { rect, camera };
			return bp.flightOrigin;
		}

		let [t_x, t_y, t_w, t_h] = project(0, 0, SQRT2 / V_SCALE_TARGET, SQRT2 / V_SCALE_TARGET, true);
		ctx.strokeStyle = 'rgba(255,255,255,0.1)';
		ctx.strokeRect(t_x, t_y, t_w, t_h);

		let [base_x, base_y, base_w, base_h] = project(
			dyn_prefA[0],
			dyn_prefA[0],
			dyn_axes_w[0],
			dyn_axes_w[0],
			true,
		);
		ctx.fillStyle = COLORS[0];
		ctx.fillRect(base_x, base_y, base_w, base_h);

		const gridPath = new Path2D();
		const edgeFilter = EDGE_BLUR_PX > 0 ? `blur(${EDGE_BLUR_PX}px)` : 'none';
		gridPath.rect(base_x, base_y, base_w, base_h);

		// Debug: welche Rest-Stuecke (k -> Anzahl) zeichnet die Bank gerade?
		// Nebeneffekt DIESER Schleife (kein zweiter Durchlauf über bank_out) -
		// dadurch per Konstruktion identisch zu dem, was tatsächlich gezeichnet
		// wird (derselbe project()-Aufruf, derselbe Sichtbarkeits-Schwellwert).
		const drawn = debugOn ? {} : null;
		const drawnDetail = debugOn ? [] : null;
		// Debug: tiefster gemeinsamer Elternrest (LCA) ALLER gerade
		// gezeichneten Rest-Stücke - dessen Exponent (k) wird unten als
		// Overlay eingeblendet. Wir sammeln die gezeichneten Blätter und
		// reduzieren sie paarweise über die Baum-Struktur (parent_id).
		const drawnPieces = debugOn ? [] : null;

		for (let r of bank_out) {
			// PERFORMANCE-FIX (REST-PRECISION-PLAN, Stand 2026-07-17): Nebeneffekt
			// dieser ohnehin schon laufenden Schleife (besucht jedes aktive Stück
			// sowieso einmal pro Frame) - sobald ein Stück seinen eingefrorenen
			// Abflug-Zeitpunkt (flightQueryTime) erreicht hat, wird seine Position
			// EINMALIG festgehalten (bankOriginState() liest danach nur noch
			// diesen Wert, statt jeden Frame neu über findRect() zu traversieren).
			if (
				r.piece.flightQueryTime !== null &&
				u_time >= r.piece.flightQueryTime &&
				!r.piece.flightOrigin
			) {
				r.piece.flightOrigin = { rect: { x: r.x, y: r.y, w: r.w, h: r.h }, camera: teilDCamera };
			}
			let [px, py, pw, ph] = project(0, 0, 0, 0, false, r);
			if (pw < 0.2 && ph < 0.2) continue;
			ctx.fillStyle = COLORS[r.piece.k % COLORS.length];
			ctx.fillRect(px, py, pw, ph);
			gridPath.rect(px, py, pw, ph);
			if (debugOn) {
				const k = r.piece.k;
				drawn[k] = (drawn[k] || 0) + 1;
				drawnDetail.push({
					k,
					taken: r.piece.taken_time,
					cut: r.piece.cut_time,
					born: r.piece.born_time,
				});
				drawnPieces.push(r.piece);
			}
		}
		if (debugOn) {
			setDebugBankDrawnRest(drawn);
			setDebugBankDrawnDetail(drawnDetail);
			drawCommonAncestorExponent(ctx, drawnPieces, 50 + BANK_X_OFFSET * V_SCALE_BANK * scale + 8);
		}

		// Zwei Durchläufe: erst alle liegenden (mit Rahmen), dann alle
		// fliegenden (ohne Rahmen, immer obendrauf).
		function drawPiece(p, onlyFlying) {
			let is_visible = false;
			if (p.type === 'Z_direct' || p.type === 'S_macro' || p.type === 'R_macro') {
				if (u_time >= p.time_fly) is_visible = true;
			} else if (p.type === 'Z_source') {
				if (u_time >= p.bp.cut_time && u_time < p.time_cut) is_visible = true;
			} else if (p.type === 'Z_ghost') {
				if (u_time >= p.time_fuse) {
					is_visible = true;
					alpha = Math.min(1, (u_time - p.time_fuse) / 0.2);
				}
			} else if (p.type === 'Z_micro') {
				if (u_time >= p.time_cut && u_time < p.time_fuse) {
					is_visible = true;
					if (u_time > p.time_fuse - 0.2) alpha = Math.max(0, (p.time_fuse - u_time) / 0.2);
				}
			}

			if (!is_visible) return;

			let fly_t = Math.max(0, Math.min(1, (u_time - p.time_fly) / 0.8));
			if (p.type === 'Z_source' || p.type === 'Z_ghost') fly_t = p.type === 'Z_ghost' ? 1 : 0;
			fly_t = fly_t * fly_t * (3.0 - 2.0 * fly_t);

			const landed = fly_t >= 0.999;
			if (onlyFlying && landed) return;
			if (!onlyFlying && !landed) return;

			// Alpha: landed=1, fliegend=FLYING_ALPHA mit weichem Übergang
			// am Anfang/Ende der Flugphase (smoothstep-Kante).
			let alpha;
			if (landed) {
				alpha = 1;
			} else {
				// smoothstep-Fade: 0→0.2 einblenden, 0.8→1 ausblenden
				let fadeIn = Math.min(1, fly_t / 0.2);
				let fadeOut = Math.min(1, (1 - fly_t) / 0.2);
				let edge = fadeIn * fadeOut; // 0 an Rändern, 1 in der Mitte
				alpha = 1 - (1 - FLYING_ALPHA) * edge;
			}

			ctx.fillStyle = COLORS[p.bp.k % COLORS.length];
			ctx.globalAlpha = alpha;

			let tx = dyn_prefA[p.u];
			let ty = dyn_prefA[p.v];
			let tw = dyn_axes_w[p.u];
			let th = dyn_axes_w[p.v];
			let target_w = tw;
			let target_h = th;

			let b_eff = Math.pow(BASE, 1.0 - effective_t_AB);
			if (b_eff < 1.000001) b_eff = 1.000001;

			let origin = bankOriginState(p);
			let [start_x, start_y, start_w, start_h] = project(
				0,
				0,
				0,
				0,
				false,
				origin?.rect,
				origin?.camera,
			);
			let [end_x, end_y, end_w, end_h] = project(tx, ty, target_w, target_h, true);

			let px = (start_x + start_w / 2) * (1 - fly_t) + (end_x + end_w / 2) * fly_t;
			let py = (start_y + start_h / 2) * (1 - fly_t) + (end_y + end_h / 2) * fly_t;

			let pw, ph, rot;
			if (p.type === 'Z_micro') {
				pw = start_w * (1 - fly_t) + end_w * fly_t;
				ph = start_h * (1 - fly_t) + end_h * fly_t;
				rot = 0;
			} else {
				rot = (p.targetRot || 0) * fly_t;
				if (Math.abs(rot) < 1e-9) {
					pw = start_w * (1 - fly_t) + end_w * fly_t;
					ph = start_h * (1 - fly_t) + end_h * fly_t;
				} else {
					pw = start_w * (1 - fly_t) + end_h * fly_t;
					ph = start_h * (1 - fly_t) + end_w * fly_t;
				}
			}

			let center_x = px;
			let center_y = py;
			ctx.save();
			ctx.translate(center_x, center_y);
			if (Math.abs(rot) > 1e-4) ctx.rotate(rot);
			ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
			if (LINE_WIDTH_PX > 0) {
				if (landed && alpha >= 0.999) {
					// gridPath wird ohne Rotation gestroked.
					// Bei gefuellter Drehung: pw/ph sind cross-lerpt,
					// Rahmen braucht aber die visuell korrekten Maße.
					const fw = Math.abs(rot) > 1e-4 ? ph : pw;
					const fh = Math.abs(rot) > 1e-4 ? pw : ph;
					gridPath.rect(center_x - fw / 2, center_y - fh / 2, fw, fh);
				} else if (landed) {
					ctx.strokeStyle = `rgba(0,0,0, ${alpha * 0.9})`;
					ctx.lineWidth = LINE_WIDTH_PX;
					ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
				} else {
					ctx.strokeStyle = `rgba(0,0,0, ${alpha * 0.9})`;
					ctx.lineWidth = LINE_WIDTH_PX;
					ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
				}
			}
			ctx.restore();
			ctx.globalAlpha = 1.0;
		}

		for (let p of render_pipeline) drawPiece(p, false);

		// Zeichne Rand (gridPath: achsen-aligned, volle Deckkraft)
		if (LINE_WIDTH_PX > 0) {
			ctx.save();
			ctx.filter = edgeFilter;
			ctx.strokeStyle = 'rgba(0,0,0,0.9)';
			ctx.lineWidth = LINE_WIDTH_PX;
			ctx.stroke(gridPath);
			ctx.restore();
		}

		for (let p of render_pipeline) drawPiece(p, true);

		renderHud(ctx, teilDCamera.z);

		ctx.restore();
	}

	function updateAutoZoomIndicator(autoZoomTAB, isActive) {
		// Cross-Komponenten-DOM aus <ControlPanel>: kann null sein, wenn
		// das Panel (noch) nicht gemountet ist (z.B. remote.html, oder
		// Canvas rendert vor dem Panel). Dann einfach ueberspringen -
		// der Marker ist rein informativ.
		if (!autoZoomMarker || !autoZoomNote) return;
		if (AUTO_ZOOM_MIN_PX <= 0) {
			autoZoomMarker.style.display = 'none';
			autoZoomNote.style.display = 'none';
			return;
		}
		autoZoomMarker.style.display = 'block';
		autoZoomMarker.style.left = autoZoomTAB * 100 + '%';
		autoZoomNote.style.display = isActive ? 'block' : 'none';
	}

	// Debug-Overlay: Exponent (k) des tiefsten gemeinsamen Elternrestes der
	// aktuell gezeichneten Reste. Wird über dem Bank-Bereich eingeblendet.
	function drawCommonAncestorExponent(ctx, pieces, bankScreenX) {
		let lca = commonAncestor(pieces, new Map(bank_pieces.map((p) => [p.id, p])));
		let label = lca ? `gem. Elternrest: k = ${lca.k}` : 'gem. Elternrest: –';
		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		let fontPx = 14 * RENDER_SCALE;
		ctx.font = `${fontPx}px monospace`;
		ctx.textBaseline = 'top';
		let x = Number.isFinite(bankScreenX) ? bankScreenX : 60 * RENDER_SCALE;
		let y = 12 * RENDER_SCALE;
		let w = ctx.measureText(label).width;
		ctx.fillStyle = 'rgba(0,0,0,0.6)';
		ctx.fillRect(x - 4, y - 3, w + 8, fontPx + 6);
		ctx.fillStyle = '#ffd166';
		ctx.fillText(label, x, y);
		ctx.restore();
	}

	function formatZoomFactor(f) {
		if (f < 10)
			return (
				f.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '×'
			);
		if (f < 1000) return Math.round(f).toLocaleString('de-DE') + '×';
		return f.toExponential(1).replace('.', ',').replace('e+', ' × 10^') + '×';
	}

	// === Zahlentafel-Rendering (l/l²/R auf Canvas, gecacht) ===
	// Offscreen-Canvas fuer die Zahlentafel: wird NUR neu bemalt, wenn
	// sich die angezeigten Werte (Hash) oder die Canvas-Groesse aendert.
	// Pro Frame wird nur das Bitmap via drawImage aufgelegt.
	let hudOffscreen = null;
	let hudOffCtx = null;
	// Start-X der Zahlentafel (rechts vom Ziel-Quadrat), in Geraetepixeln.
	let hudX0 = 24;
	// Gecachter Zustand: zuletzt gemalener Hash + Canvas-Masse + ob an.
	let hudCache = { hash: '', w: 0, h: 0, on: false };

	function ensureHudOffscreen(w, h) {
		if (!hudOffscreen) {
			hudOffscreen = document.createElement('canvas');
			hudOffCtx = hudOffscreen.getContext('2d');
		}
		if (hudOffscreen.width !== w || hudOffscreen.height !== h) {
			hudOffscreen.width = w;
			hudOffscreen.height = h;
		}
	}

	function renderHud(ctx, zoom) {
		const enabled = get(configStore).hudUpdateEnabled;
		const ready = compiledRef && compiledRef.axes;
		// Anzeige aus: gecachten Zustand zuruecksetzen, nichts malen.
		if (!enabled || !ready) {
			hudCache = { hash: '', w: 0, h: 0, on: false };
			return;
		}
		// Exakte BigInt-Werte aus der Simulation (Mathe unveraendert).
		let { N_l, N_R, GRID, AREA_SCALE } = computeLiveL(compiledRef, u_time, BASE);
		let { P_str, P2_str, rem_str } = formatLiveNumbers(N_l, N_R, GRID, AREA_SCALE, BASE);
		// Jede Zeile: [Label, Wert, Basis-Subscript]. Die Basis wird als
		// tiefgestellte, kleinere Zahl NACH dem Wert gemalt (kein Inline).
		let rows = [
			['l   = ', P_str, BASE],
			['l²  = ', P2_str, BASE],
			['R   = ', rem_str, BASE],
		];
		let hash = P_str + '|' + P2_str + '|' + rem_str + '|' + zoom + '|' + BASE;

		let W = canvasEl.width;
		let H = canvasEl.height;
		// Start X: rechts vom Ziel-Quadrat (von renderFrame gesetzt).
		let x0 = hudX0;
		// Nur neu bemaden, wenn sich Werte ODER Groesse geaendert haben.
		if (hash !== hudCache.hash || W !== hudCache.w || H !== hudCache.h || !hudCache.on) {
			ensureHudOffscreen(W, H);
			let c = hudOffCtx;
			c.clearRect(0, 0, W, H);
			c.setTransform(1, 0, 0, 1, 0, 0);

			let padX = 24;
			let padY = 28;
			let lineH = Math.round(H * 0.032) + 8;

			// EINE Schriftgroesse fuer die GANZE Anzeige: startet bei
			// ~0.8*lineH und wird nur verkleinert, falls die laengste
			// Zeile (Wert + Luecke + Basis-Subscript) die verfuegbare
			// Breite (von x0 bis W - padX) ueberschreitet.
			let fontSize = Math.round(lineH * 0.8);
			let subFont = Math.round(fontSize * 0.7);
			let fontFor = (s) => `${s}px ui-monospace, monospace`;
			let avail = W - padX - x0;
			c.font = fontFor(fontSize);
			let longest = 0;
			for (const [lab, val, base] of rows) {
				let wval = c.measureText(lab + val).width;
				let wbase = c.measureText(String(base)).width * (subFont / fontSize);
				longest = Math.max(longest, wval + 6 + wbase);
			}
			if (longest > avail && longest > 0) {
				let factor = avail / longest;
				fontSize = Math.max(10, Math.floor(fontSize * factor));
				subFont = Math.round(fontSize * 0.7);
				c.font = fontFor(fontSize);
			}

			c.textAlign = 'left';
			c.textBaseline = 'alphabetic';
			c.fillStyle = 'rgba(148,163,184,0.95)';
			let x = x0;
			let y = padY + fontSize;
			for (const [lab, val, base] of rows) {
				c.font = fontFor(fontSize);
				c.fillText(lab + val, x, y);
				// Basis als Subscript: eine Stufe kleinere Schrift,
				// leicht abgesenkt, direkt NACH dem Wert.
				if (base) {
					let wval = c.measureText(lab + val).width;
					c.font = fontFor(subFont);
					c.fillText(String(base), x + wval + 6, y + fontSize - subFont);
				}
				y += lineH;
			}
			// Bank-Zoom: separates Feld weiter unten, rechtsbündig
			// mit der rechten Kante des Ziel-Quadrats.
			let zoomFmt =
				zoom < 10
					? zoom.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) +
						'x'
					: Math.round(zoom).toLocaleString('de-DE') + 'x';
			c.font = fontFor(Math.round(fontSize * 0.75));
			let zoomW = c.measureText(zoomFmt).width;
			let zoomX = t_x + t_w - zoomW;
			let zoomY = y + Math.round(lineH * 0.3);
			c.fillText(zoomFmt, zoomX, zoomY);
			hudCache = { hash, w: W, h: H, on: true };
		}
		// Gecachtes Bitmap pro Frame auflegen (günstig, kein Reflow/
		// keine BigInt-Berechnung pro Frame).
		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.drawImage(hudOffscreen, 0, 0);
		ctx.restore();
	}

	function resizeCanvas() {
		if (!ctx) return;
		canvasEl.width = window.innerWidth * RENDER_SCALE;
		canvasEl.height = window.innerHeight * RENDER_SCALE;
		canvasEl.style.width = window.innerWidth + 'px';
		canvasEl.style.height = window.innerHeight + 'px';
		renderFrame();
	}

	function updateOutputs() {
		renderFrame();
	}

	function applyPlayback(p) {
		u_time = p.time;
		animDirection = p.direction;
		let wasPlaying = isPlaying;
		isPlaying = p.isPlaying;
		if (isPlaying && !wasPlaying) {
			lastTime = performance.now();
			requestAnimationFrame(loop);
		}
		if (_suppressPlaybackRender) return;
		updateOutputs();
	}

	// dt clamppen: ein einzelner langer Frame (GC-Pause, Compile-
	// Fertigstellung, Tab-Throttle im Hintergrund) darf KEINEN sichtbaren
	// Zeitsprung erzeugen. Ohne Clamp wuerde ein solcher Frame u_time auf
	// einen Schlag um Sekunden vorschieben (Symptom: "Zeit macht ab und zu
	// einen Sprung nach vorne"). Logik in src/lib/timeStep.js (Unit-getestet).
	function loop(now) {
		if (!isPlaying) return;
		let dt = (now - lastTime) / 1000.0;
		lastTime = now;
		dt = clampDt(dt, MAX_FRAME_DT);
		setDebugFrame(dt);

		if (animPause > 0) {
			animPause -= dt;
		} else {
			u_time += dt * ANIM_SPEED * animDirection;
			setDebugBankTime(u_time);
			if (u_time >= MAX_TIME) {
				u_time = MAX_TIME;
				animDirection = -1;
				animPause = ANIM_PAUSE_DURATION;
			} else if (u_time <= 0) {
				u_time = 0;
				animDirection = 1;
				animPause = ANIM_PAUSE_DURATION;
			}
			_suppressPlaybackRender = true;
			playbackStore.set({ time: u_time, isPlaying, direction: animDirection });
			_suppressPlaybackRender = false;
			updateOutputs();
		}
		requestAnimationFrame(loop);
	}

	onMount(() => {
		ctx = canvasEl.getContext('2d');
		setDebugCanvas(canvasEl);
		bankZoomLabel = document.getElementById('bankZoomLabel');
		bankAreaLabel = document.getElementById('bankAreaLabel');
		autoZoomMarker = document.getElementById('autoZoomMarker');
		autoZoomNote = document.getElementById('autoZoomNote');
		bankPanel = document.getElementById('bankPanel');
		window.addEventListener('resize', resizeCanvas);
		resizeCanvas();
		const unsubC = configStore.subscribe(applyConfig);
		const unsubP = playbackStore.subscribe(applyPlayback);
		// compiledStore (asynchroner Compile): sobald ein neuer, fertiger
		// Compile vorliegt, muss applyConfig erneut laufen, um die
		// gerenderten Felder (axes/bank_pieces/...) zu übernehmen - der
		// Worker liefert sonst keinen Trigger über configStore.
		const unsubCompiled = compiledStore.subscribe(() => applyConfig(get(configStore)));
		return () => {
			unsubC();
			unsubP();
			unsubCompiled();
			window.removeEventListener('resize', resizeCanvas);
		};
	});
</script>

<canvas bind:this={canvasEl}></canvas>
