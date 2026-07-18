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

	import ControlPanel from './components/ControlPanel.svelte';
	import PlaybackBar from './components/PlaybackBar.svelte';
	import RestCounterBars from './components/RestCounterBars.svelte';
	import RestCounterGrid from './components/RestCounterGrid.svelte';
	import TargetBankCanvas from './components/TargetBankCanvas.svelte';
	import SpeedSlider from './components/SpeedSlider.svelte';

	let u_time = 0.0;

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
	// Wird JETZT direkt auf dem BANK-CANVAS gemalt (TargetBankCanvas.svelte
	// renderFrame -> computeLiveL + formatLiveNumbers + ctx.fillText), nicht
	// mehr ins DOM geschrieben. Grund: das stuendige DOM-`innerHTML`-
	// Umschreiben inkl. erzwungenem Reflow (updateNumberPanelScale
	// liest scrollWidth/clientWidth) verursachte nach dem MathJax-Entzug
	// NEUE Ruckler. Canvas-Paint hat keinen Reflow, kein innerHTML.

	function applyConfig() {
		// (Zahlentafel lebt jetzt im Canvas - hier nichts mehr zu tun.)
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

		// Zahlentafel lebt jetzt im Canvas (TargetBankCanvas.svelte) -
		// hier nur noch u_time uebernehmen.
		configStore.subscribe(applyConfig);
		playbackStore.subscribe((p) => {
			u_time = p.time;
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
	<div id="speedControl"><SpeedSlider variant="compact" /></div>
</div>
