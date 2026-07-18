<script>
	// App.svelte - reine Svelte-Hülle des Haupttools (vormals die inline-Script-
	// Logik in index.html). Mountet die Kind-Komponenten in die Skeleton-Divs
	// und übernimmt die verbleibende DOM-Verdrahtung, die Svelte-Komponenten
	// nicht selbst rendern: Zahlentafel (l/l²/R), Settings-/Timeline-Reveal und
	// die Widget-Umschaltung (displayStore).
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { mount } from 'svelte';

	import { configStore, playbackStore, compiledStore, compileStatusStore } from './lib/stores.js';
	import { displayStore } from './lib/displayStore.js';
	import { parseConfigFromUrl, parsePlaybackFromUrl } from './lib/urlState.js';
	import { initSync } from './lib/syncedStore.js';
	import { initDebugAgent } from './lib/debugAgent.js';
	import { computeLiveL } from './lib/compiler.js';
	import { buildNumberPanelHTML } from './lib/numberRenderer.js';

	import ControlPanel from './components/ControlPanel.svelte';
	import PlaybackBar from './components/PlaybackBar.svelte';
	import RestCounterBars from './components/RestCounterBars.svelte';
	import RestCounterGrid from './components/RestCounterGrid.svelte';
	import TargetBankCanvas from './components/TargetBankCanvas.svelte';
	import SpeedSlider from './components/SpeedSlider.svelte';

	// Schaltet die Wort-Präfixe ("Länge ", "Fläche ", "Rest ") im Zahlen-Panel
	// oben rechts an/aus - Standard aus (nur kurze Symbole l/l²/R).
	const NUMBER_PANEL_VERBOSE = false;

	let u_time = 0.0;
	let current_hud_hash = '';

	// === Progress-Anzeige (ASYNC-COMPILE-PLAN, Schritt 6) ===
	// Erscheint erst nach einer kurzen Schwelle (300 ms), damit schnelle
	// Compiles (depth klein) keinen flüchtigen Balken zeigen. Treibt sich
	// rein aus compileStatusStore - kein Rechenaufwand, kein Eingriff in
	// bank-core.js.
	const PROGRESS_THRESHOLD_MS = 300;
	let showProgress = $state(false);
	let compileError = $state(null);
	let progressTimer = null;
	compileStatusStore.subscribe((s) => {
		clearTimeout(progressTimer);
		if (s.state === 'compiling') {
			progressTimer = setTimeout(() => {
				showProgress = true;
			}, PROGRESS_THRESHOLD_MS);
		} else {
			showProgress = false;
		}
		compileError = s.error || null;
	});

	// === Zahlentafel (l/l²/R) ===

	function updateNumberPanelScale(numberPanel, numberPanelInner) {
		numberPanelInner.style.transform = 'none';
		let available = numberPanel.clientWidth;
		let natural = numberPanelInner.scrollWidth;
		let scale = Math.min(1, available / natural);
		numberPanelInner.style.transform = `scale(${scale})`;
	}
	function updateHUD(time) {
		const compiled = get(compiledStore);
		if (!compiled || !compiled.axes) return;
		const BASE = get(configStore).base;

		// Laufende Seitenlänge l und Rest R: EXAKT aus der Simulation
		// abgelesen (keine Wurzel, keine eigene Umrechnung). l = N_l/GRID
		// ist eine Treppenfunktion über abgeschlossene Schalen, R = N_R/
		// AREA_SCALE die direkte Zählung des Rests. l² = N_l²/GRID².
		let { N_l, N_R, GRID, AREA_SCALE } = computeLiveL(compiled, time, BASE);

		// Nachkommastellen: l hat N_MAX Stellen (GRID = BASE^N_MAX),
		// l²/R haben K_MAX Stellen (AREA_SCALE = BASE^K_MAX).
		let m = GRID.toString(BASE).length - 1; // = N_MAX
		let kmax = AREA_SCALE.toString(BASE).length - 1; // = K_MAX

		// === EXAKTE BIGINT-MATHEMATIK (aus N_l/N_R, direkt aus der Simulation) ===

		// Seitenlänge P = N_l / GRID
		let P_str = N_l.toString(BASE).toUpperCase();
		if (m > 0) P_str = '0'.repeat(Math.max(0, m + 1 - P_str.length)) + P_str;
		if (m > 0) P_str = P_str.slice(0, P_str.length - m) + '.' + P_str.slice(P_str.length - m);

		// Fläche P^2 = N_l^2 / GRID^2
		let P2 = N_l * N_l;
		let P2_str = P2.toString(BASE).toUpperCase();
		if (m > 0) {
			let digits = 2 * m;
			P2_str = '0'.repeat(Math.max(0, digits + 1 - P2_str.length)) + P2_str;
			P2_str = P2_str.slice(0, P2_str.length - digits) + '.' + P2_str.slice(P2_str.length - digits);
		}

		// Rest R = N_R / AREA_SCALE (= 2 - l², aber hier direkt gezählt)
		let rem_str = N_R.toString(BASE).toUpperCase();
		if (kmax > 0) {
			rem_str = '0'.repeat(Math.max(0, kmax + 1 - rem_str.length)) + rem_str;
			rem_str =
				rem_str.slice(0, rem_str.length - kmax) + '.' + rem_str.slice(rem_str.length - kmax);
		}

		// Hängende Nullen abschneiden: die letzte Ziffer soll nie eine 0 sein
		// (z.B. 1.410 -> 1.41, 1.40 -> 1.4). Betrifft l, l² und R gleichermaßen.
		const trimTrailing = (s) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);
		P_str = trimTrailing(P_str);
		P2_str = trimTrailing(P2_str);
		rem_str = trimTrailing(rem_str);

		// Hash über die tatsächlich angezeigten Werte: so wird die Zahlentafel
		// bei JEDER sichtbaren Änderung neu geschrieben - auch beim Endzustand
		// (letzte Schale fertig), wo computeLiveL die Zahl noch zur vollen
		// Annäherung an sqrt(2) aufüllt.
		let hash = P_str + '|' + P2_str + '|' + rem_str + '|' + BASE;
		if (hash === current_hud_hash) return;
		current_hud_hash = hash;

		// === EIGENER RENDERER (statt MathJax) ===
		// buildNumberPanelHTML liefert alignment-fähiges HTML (Label + int/
		// frac-Spans, Dezimalpunkte untereinander); KEINE externe
		// Bibliothek, KEIN pro-Frame-Typeset (Ursache des Flug-Stotterns).
		const numberPanelInner = document.getElementById('numberPanelInner');
		const numberPanel = document.getElementById('numberPanel');
		numberPanelInner.innerHTML = buildNumberPanelHTML(
			P_str,
			P2_str,
			rem_str,
			BASE,
			NUMBER_PANEL_VERBOSE,
		);
		updateNumberPanelScale(numberPanel, numberPanelInner);
	}

	function applyConfig() {
		if (get(configStore).hudUpdateEnabled) updateHUD(u_time);
	}

	onMount(() => {
		// Fensterübergreifender Sync (BroadcastChannel) - idempotent.
		initSync();
		// Debug-Inspect-Kanal (opt-in ?debug=1): legt window.__debugSnapshot()
		// offen, damit ein Playwright-Peer (connectOverCDP) den inneren Stand
		// direkt aus dem JS-Kontext liest.
		initDebugAgent();

		// URL-Sync: configStore/playbackStore aus der URL befüllen, BEVOR die
		// Komponenten mounten (ControlPanel/PlaybackBar lesen sie direkt).
		const URL_PARAMS = new URLSearchParams(window.location.search);
		configStore.update((c) => ({ ...c, ...parseConfigFromUrl(URL_PARAMS) }));
		// playback `time`/`tick` hängen am kompilierten Zustand (MAX_TIME/
		// GLOBAL_TTM). compiledStore ist asynchron (Compile-Worker) - beim
		// Mount ggf. noch null. Sobald der erste Compile vorliegt, holen wir
		// time/tick aus der URL nach (einmalig).
		if (get(compiledStore)) {
			playbackStore.update((p) => ({
				...p,
				...parsePlaybackFromUrl(URL_PARAMS, get(compiledStore)),
			}));
		} else {
			let applied = false;
			const unsub = compiledStore.subscribe((compiled) => {
				if (applied || !compiled) return;
				applied = true;
				playbackStore.update((p) => ({
					...p,
					...parsePlaybackFromUrl(URL_PARAMS, compiled),
				}));
				unsub();
			});
		}

		// Kind-Komponenten in die Skeleton-Divs mounten.
		mount(ControlPanel, { target: document.getElementById('controlPanelMount') });
		mount(PlaybackBar, { target: document.getElementById('playbackBarMount') });
		mount(RestCounterBars, { target: document.getElementById('bankPanelMount') });
		mount(RestCounterGrid, { target: document.getElementById('restGridMount') });
		mount(TargetBankCanvas, { target: document.getElementById('canvasMount') });

		const settingsPanel = document.getElementById('settingsPanel');
		const bottomBar = document.getElementById('bottomBar');
		const bankPanel = document.getElementById('bankPanel');
		const restGridPanel = document.getElementById('restGridPanel');

		// Zahlentafel + initiales Rendern.
		configStore.subscribe(applyConfig);
		playbackStore.subscribe((p) => {
			u_time = p.time;
			if (get(configStore).hudUpdateEnabled) updateHUD(u_time);
		});

		// Widget-Auswahl (displayStore): zeigt entweder Balken- ODER Grid-Widget.
		displayStore.subscribe((d) => {
			let grid = d.restWidget === 'grid';
			bankPanel.style.display = grid ? 'none' : '';
			restGridPanel.style.display = grid ? 'block' : 'none';
		});

		// Settings-Panel (oben rechts) + Timeline (unten) erscheinen bei
		// Mausnähe - für den Exponat-/Ausstellungs-Kontext.
		const TOP_RIGHT_ZONE_PX = 160;
		const BOTTOM_REVEAL_ZONE_PX = 90;
		const onMove = (e) => {
			let nearBottom = window.innerHeight - e.clientY < BOTTOM_REVEAL_ZONE_PX;
			bottomBar.classList.toggle('visible', nearBottom);

			let nearTopRight =
				e.clientX > window.innerWidth - TOP_RIGHT_ZONE_PX && e.clientY < TOP_RIGHT_ZONE_PX;
			let overSettingsPanel = false;
			if (settingsPanel.classList.contains('open')) {
				let r = settingsPanel.getBoundingClientRect();
				overSettingsPanel =
					e.clientX >= r.left &&
					e.clientX <= r.right &&
					e.clientY >= r.top &&
					e.clientY <= r.bottom;
			}
			settingsPanel.classList.toggle('open', nearTopRight || overSettingsPanel);
		};
		document.addEventListener('mousemove', onMove);

		return () => document.removeEventListener('mousemove', onMove);
	});
</script>

<div id="canvasMount"></div>

<div id="numberPanel"><div id="numberPanelInner"></div></div>
<div id="speedControl"><SpeedSlider variant="compact" /></div>
<div id="bankPanel"><div id="bankPanelMount"></div></div>
<div class="overlay-panel" id="restGridPanel"><div id="restGridMount"></div></div>

<div class="overlay-panel" id="settingsPanel">
	<div class="error-msg" id="errorMsg">{compileError ?? ''}</div>
	<div id="controlPanelMount"></div>
</div>

{#if showProgress}
	<div class="compile-progress" aria-hidden="true">
		<div class="compile-progress-bar"></div>
	</div>
{/if}

<div id="bottomBar">
	<div id="playbackBarMount"></div>
</div>
