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
	import { layoutCentered, findRect } from '../lib/recursive-layout.js';
	import { configStore, playbackStore, compiledStore } from '../lib/stores.js';
	import {
		setDebugCanvas,
		setDebugFrame,
		setDebugBankTransform,
		setDebugBankTime,
		setDebugBankDrawnRest,
		setDebugBankDrawnDetail,
		isDebugEnabled,
	} from '../lib/debugAgent.js';

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
	let AUTO_ZOOM_MIN_PX = 0;
	let RENDER_SCALE = 1;
	let EDGE_BLUR_PX = 0;
	let LINE_WIDTH_PX = 0.3;
	let ANIM_PAUSE_DURATION = 1.5;
	let ANIM_SPEED = 2.0;
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
			bankRenderEnabled = c.bankRenderEnabled;

			let compiled = get(compiledStore);
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
		bankZoomLabel.innerText = formatZoomFactor(teilDCamera.z);
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
			}
		}
		if (debugOn) {
			setDebugBankDrawnRest(drawn);
			setDebugBankDrawnDetail(drawnDetail);
		}

		for (let p of render_pipeline) {
			let alpha = 1.0;
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

			if (!is_visible) continue;

			ctx.fillStyle = COLORS[p.bp.k % COLORS.length];
			ctx.globalAlpha = alpha;

			let fly_t = Math.max(0, Math.min(1, (u_time - p.time_fly) / 0.8));
			if (p.type === 'Z_source' || p.type === 'Z_ghost') fly_t = p.type === 'Z_ghost' ? 1 : 0;
			fly_t = fly_t * fly_t * (3.0 - 2.0 * fly_t);

			let tx = dyn_prefA[p.u];
			let ty = dyn_prefA[p.v];
			let tw = dyn_axes_w[p.u];
			let th = dyn_axes_w[p.v];
			let target_w = tw;
			let target_h = th;

			let b_eff = Math.pow(BASE, 1.0 - effective_t_AB);
			if (b_eff < 1.000001) b_eff = 1.000001;

			if (p.type === 'Z_micro') {
				target_w = tw > th ? tw / b_eff : tw;
				target_h = tw > th ? th : th / b_eff;
				tx = tx + (tw > th ? p.i * target_w : 0);
				ty = ty + (tw > th ? 0 : p.i * target_h);
			}

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

			let px = start_x * (1 - fly_t) + end_x * fly_t;
			let py = start_y * (1 - fly_t) + end_y * fly_t;
			let pw = start_w * (1 - fly_t) + end_w * fly_t;
			let ph = start_h * (1 - fly_t) + end_h * fly_t;

			if (p.type === 'R_macro') {
				let center_x = px + pw / 2;
				let center_y = py + ph / 2;
				ctx.save();
				ctx.translate(center_x, center_y);
				ctx.rotate(p.rot * fly_t);
				ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
				if (LINE_WIDTH_PX > 0) {
					ctx.filter = edgeFilter;
					ctx.strokeStyle = `rgba(0,0,0, ${alpha * 0.9})`;
					ctx.lineWidth = LINE_WIDTH_PX;
					ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
					ctx.filter = 'none';
				}
				ctx.restore();
			} else {
				if (pw > 0.2 && ph > 0.2) {
					ctx.fillRect(px, py, pw, ph);
					if (alpha >= 0.999) {
						gridPath.rect(px, py, pw, ph);
					} else if (LINE_WIDTH_PX > 0 && (alpha > 0.8 || p.type === 'Z_ghost')) {
						ctx.filter = edgeFilter;
						ctx.strokeStyle = `rgba(0,0,0, ${alpha * 0.9})`;
						ctx.lineWidth = LINE_WIDTH_PX;
						ctx.strokeRect(px, py, pw, ph);
						ctx.filter = 'none';
					}
				}
			}
			ctx.globalAlpha = 1.0;
		}

		if (LINE_WIDTH_PX > 0) {
			ctx.save();
			ctx.filter = edgeFilter;
			ctx.strokeStyle = 'rgba(0,0,0,0.9)';
			ctx.lineWidth = LINE_WIDTH_PX;
			ctx.stroke(gridPath);
			ctx.restore();
		}

		ctx.restore();
	}

	function updateAutoZoomIndicator(autoZoomTAB, isActive) {
		if (AUTO_ZOOM_MIN_PX <= 0) {
			autoZoomMarker.style.display = 'none';
			autoZoomNote.style.display = 'none';
			return;
		}
		autoZoomMarker.style.display = 'block';
		autoZoomMarker.style.left = autoZoomTAB * 100 + '%';
		autoZoomNote.style.display = isActive ? 'block' : 'none';
	}

	function formatZoomFactor(f) {
		if (f < 10)
			return (
				f.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '×'
			);
		if (f < 1000) return Math.round(f).toLocaleString('de-DE') + '×';
		return f.toExponential(1).replace('.', ',').replace('e+', ' × 10^') + '×';
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

	function loop(now) {
		if (!isPlaying) return;
		let dt = (now - lastTime) / 1000.0;
		lastTime = now;
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
