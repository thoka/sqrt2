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

	let showHelp = $state(false);
	const SPEED_STEP = 1.3;

	// === Intro-Screen (TODO.md "Intro-Screen") ===
	// Kurzer, NICHT-blockierender Hinweis beim Start (pointer-events: none -
	// verdeckt weder Klicks auf die Timeline noch Tastatursteuerung). Blendet
	// sich von selbst nach INTRO_DURATION_MS aus, oder sofort, sobald die
	// Wiedergabe startet (Space, Play-Button, Remote-Steuerung - alles läuft
	// über playbackStore.isPlaying, daher genügt EIN Subscribe).
	const INTRO_DURATION_MS = 6000;
	let showIntro = $state(true);

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

		// Zahlentafel lebt jetzt im Canvas (TargetBankCanvas.svelte).
		configStore.subscribe(applyConfig);

		// Widget-Auswahl (displayStore): zeigt entweder Balken- ODER Grid-Widget.
		displayStore.subscribe((d) => {
			let grid = d.restWidget === 'grid';
			bankPanel.style.display = grid ? 'none' : '';
			restGridPanel.style.display = grid ? 'block' : 'none';
		});

		// Settings-Panel (oben rechts) + Timeline (unten) erscheinen bei
		// Mausnähe - für den Exponat-/Ausstellungs-Kontext.
		const TOP_RIGHT_ZONE_PX = 153;
		const BOTTOM_REVEAL_ZONE_PX = 90;
		let sliderDragging = false;
		const onSliderDown = (e) => {
			if (e.target.type === 'range') sliderDragging = true;
		};
		const onSliderUp = () => {
			sliderDragging = false;
		};
		document.addEventListener('mousedown', onSliderDown);
		document.addEventListener('mouseup', onSliderUp);
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
			settingsPanel.classList.toggle('open', nearTopRight || overSettingsPanel || sliderDragging);
		};
		document.addEventListener('mousemove', onMove);

		// Tastensteuerung: wird ueber <svelte:window> im Template gebunden
		// (Svelte 5 braucht den Compiler-Transform fuer $state-Reaktivitaet).

		// Intro-Screen: Timer + Play-Trigger zum Ausblenden.
		const introTimer = setTimeout(() => {
			showIntro = false;
		}, INTRO_DURATION_MS);
		const unsubIntroPlay = playbackStore.subscribe((p) => {
			if (p.isPlaying) showIntro = false;
		});

		return () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mousedown', onSliderDown);
			document.removeEventListener('mouseup', onSliderUp);
			clearTimeout(introTimer);
			unsubIntroPlay();
		};
	});

	// Tastensteuerung (siehe TODO.md "Tastensteuerung")
	function stepTick(delta) {
		let compiled = get(compiledStore);
		let ttm = compiled?.GLOBAL_TTM;
		if (!ttm) return;
		let p = get(playbackStore);
		let tick = Math.round(ttm.timeToTick(p.time)) + delta;
		tick = Math.max(0, Math.min(ttm.maxTick, tick));
		playbackStore.update((s) => ({ ...s, time: ttm.tickToTime(tick) }));
	}
	function jumpShell(delta) {
		let compiled = get(compiledStore);
		if (!compiled?.GLOBAL_SHELL_START) return;
		let p = get(playbackStore);
		let starts = compiled.GLOBAL_SHELL_START;
		let currentShell = 0;
		for (let i = starts.length - 1; i >= 0; i--) {
			if (p.time >= starts[i]) {
				currentShell = i;
				break;
			}
		}
		let target = currentShell + delta;
		if (target < 0 || target >= starts.length) return;
		playbackStore.update((s) => ({ ...s, time: starts[target] }));
	}
	function onKeyDown(e) {
		if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
		if (showHelp) {
			showHelp = false;
			return;
		}
		switch (e.key) {
			case ' ':
				e.preventDefault();
				playbackStore.update((p) => ({ ...p, isPlaying: !p.isPlaying }));
				break;
			case 'ArrowLeft':
				e.preventDefault();
				stepTick(-1);
				break;
			case 'ArrowRight':
				e.preventDefault();
				stepTick(1);
				break;
			case 'PageUp':
				e.preventDefault();
				jumpShell(1);
				break;
			case 'PageDown':
				e.preventDefault();
				jumpShell(-1);
				break;
			case 'Enter':
				e.preventDefault();
				playbackStore.update((p) => ({
					...p,
					direction: p.direction === 1 ? -1 : 1,
				}));
				break;
			case '+':
				e.preventDefault();
				configStore.update((c) => ({ ...c, playSpeed: c.playSpeed * SPEED_STEP }));
				break;
			case '-':
				e.preventDefault();
				configStore.update((c) => ({ ...c, playSpeed: c.playSpeed / SPEED_STEP }));
				break;
			case '?':
				e.preventDefault();
				showHelp = true;
				break;
		}
	}
</script>

<svelte:window onkeydown={onKeyDown} />

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

{#if showIntro}
	<div class="intro-overlay" aria-hidden="true">
		<div class="intro-box">
			<h2>√2 als Fläche</h2>
			<p>Diese Visualisierung nähert sich √2 Schritt für Schritt an.</p>
		</div>
		<div class="intro-settings-hint">Einstellungen<span class="intro-arrow">↗</span></div>
	</div>
{/if}

{#if showHelp}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="help-overlay" onclick={() => (showHelp = false)}>
		<div class="help-box" role="dialog" aria-label="Tastensteuerung">
			<h3>Tastensteuerung</h3>
			<table>
				<tbody>
					<tr><td><kbd>Space</kbd></td><td>Play / Pause</td></tr>
					<tr><td><kbd>←</kbd></td><td>Tick zurück</td></tr>
					<tr><td><kbd>→</kbd></td><td>Tick vorwärts</td></tr>
					<tr><td><kbd>PgUp</kbd></td><td>Schale vorwärts</td></tr>
					<tr><td><kbd>PgDn</kbd></td><td>Schale zurück</td></tr>
					<tr><td><kbd>Return</kbd></td><td>Richtungswechsel</td></tr>
					<tr><td><kbd>+</kbd></td><td>Schneller (×{SPEED_STEP})</td></tr>
					<tr><td><kbd>−</kbd></td><td>Langsamer (÷{SPEED_STEP})</td></tr>
					<tr><td><kbd>?</kbd></td><td>Hilfe</td></tr>
				</tbody>
			</table>
			<p class="help-hint">Beliebige Taste zum Schliessen</p>
		</div>
	</div>
{/if}
