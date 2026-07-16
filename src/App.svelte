<script>
	// App.svelte - reine Svelte-Hülle des Haupttools (vormals die inline-Script-
	// Logik in index.html). Mountet die Kind-Komponenten in die Skeleton-Divs
	// und übernimmt die verbleibende DOM-Verdrahtung, die Svelte-Komponenten
	// nicht selbst rendern: Zahlentafel (l/l²/R), Settings-/Timeline-Reveal und
	// die Widget-Umschaltung (displayStore).
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { mount } from 'svelte';

	import { configStore, playbackStore, compiledStore } from './lib/stores.js';
	import { displayStore } from './lib/displayStore.js';
	import { parseConfigFromUrl, parsePlaybackFromUrl } from './lib/urlState.js';
	import { initSync } from './lib/syncedStore.js';

	import ControlPanel from './components/ControlPanel.svelte';
	import PlaybackBar from './components/PlaybackBar.svelte';
	import RestCounterBars from './components/RestCounterBars.svelte';
	import RestCounterGrid from './components/RestCounterGrid.svelte';
	import TargetBankCanvas from './components/TargetBankCanvas.svelte';

	// Schaltet die Wort-Präfixe ("Länge ", "Fläche ", "Rest ") im Zahlen-Panel
	// oben rechts an/aus - Standard aus (nur kurze Symbole l/l²/R).
	const NUMBER_PANEL_VERBOSE = false;

	let u_time = 0.0;
	let current_hud_hash = '';

	// === Zahlentafel (l/l²/R) ===
	// Step = höchste Schale S, deren Startzeit bereits erreicht ist.
	function getShellStepAt(time, GLOBAL_SHELL_START, TOTAL_STEPS) {
		let Step = 0;
		for (let S = 1; S < GLOBAL_SHELL_START.length; S++) {
			if (time >= GLOBAL_SHELL_START[S]) Step = S;
			else break;
		}
		return Math.max(0, Math.min(TOTAL_STEPS - 1, Step));
	}

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
		const { axes, GLOBAL_N_ARR, GLOBAL_SHELL_START, GLOBAL_SHELL_TAKEN, TOTAL_STEPS } = compiled;
		const BASE = get(configStore).base;

		let Step = getShellStepAt(time, GLOBAL_SHELL_START, TOTAL_STEPS);
		let current_m = axes[Step].exp;

		// Laufender Fortschritt der aktuellen Schale: wie viele ihrer Stücke
		// sind zur Zeit `time` bereits entnommen? Daraus ergibt sich die
		// laufende Ziffer der aktuellen Stelle (anteilig 0..GLOBAL_N_ARR[m]),
		// sodass l/l²/R bei JEDER Stück-Entnahme mitwachsen - nicht erst bei
		// der nächsten (komplett gefüllten) Stelle.
		let taken = GLOBAL_SHELL_TAKEN ? GLOBAL_SHELL_TAKEN[Step] : [];
		let done = 0;
		for (let t of taken) if (time >= t) done++;
		let total = taken.length;
		let frac = total > 0 ? done / total : 1;
		let liveDigit = Math.round(GLOBAL_N_ARR[current_m] * frac);

		// Hash enthält Step + bereits entnommene Stücke + BASE: die Bank-Balken
		// leben in <RestCounterBars>, diese Funktion rendert NUR die
		// Zahlentafel l/l²/R.
		let hash = Step + '_' + done + '_' + BASE;
		if (hash === current_hud_hash) return;
		current_hud_hash = hash;

		// === EXAKTE BIGINT-MATHEMATIK ===
		let N = 0n;
		let baseBig = BigInt(BASE);
		for (let i = 0; i <= current_m; i++) {
			// Stelle m (die laufende) wächst anteilig mit den entnommenen Stücken,
			// alle tieferen Stellen sind bereits voll besetzt.
			let digit = i === current_m ? BigInt(liveDigit) : BigInt(GLOBAL_N_ARR[i]);
			N = N * baseBig + digit;
		}

		// Seitenlänge P
		let P_str = N.toString(BASE).toUpperCase();
		if (current_m > 0) P_str = P_str.slice(0, 1) + '.' + P_str.slice(1);

		// Fläche P^2
		let P2 = N * N;
		let P2_str = P2.toString(BASE).toUpperCase();
		if (current_m > 0) {
			let intPart = P2_str.slice(0, P2_str.length - 2 * current_m);
			if (!intPart) intPart = '0';
			let fracPart = P2_str.slice(-2 * current_m).padStart(2 * current_m, '0');
			P2_str = intPart + '.' + fracPart;
		}

		// Rest 2 - P^2 (die mathematische '2' als BigInt, verschoben um 2*m Stellen)
		let two_scaled = 2n * baseBig ** BigInt(2 * current_m);
		let rem = two_scaled - P2;
		let rem_str = rem.toString(BASE).toUpperCase();
		if (current_m > 0) {
			rem_str = '0.' + rem_str.padStart(2 * current_m, '0');
		}

		let lengthLabel = NUMBER_PANEL_VERBOSE ? '\\text{Länge } l' : 'l';
		let areaLabel = NUMBER_PANEL_VERBOSE ? '\\text{Fläche } l^2' : 'l^2';
		let restLabel = NUMBER_PANEL_VERBOSE ? '\\text{Rest } R' : 'R';
		let equation = `\\[ \\begin{aligned}
        ${lengthLabel} &= ${P_str}_{${BASE}} \\\\
        ${areaLabel} &= ${P2_str}_{${BASE}} \\\\
        ${restLabel} &= ${rem_str}_{${BASE}}
    \\end{aligned} \\]`;

		const numberPanelInner = document.getElementById('numberPanelInner');
		const numberPanel = document.getElementById('numberPanel');
		numberPanelInner.innerHTML = equation;

		// MathJax lädt asynchron (das window.MathJax-Objekt wird VOR dem Laden
		// der Bibliothek gesetzt, typesetPromise gibt es erst danach). Daher:
		// sobald verfügbar typesetten, sonst vorerst nur skalieren. Ein Wurf
		// hier würde onMount abbrechen und die Kind-Mounts (Canvas) zerstören.
		try {
			if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
				MathJax.typesetPromise([numberPanelInner])
					.then(() => updateNumberPanelScale(numberPanel, numberPanelInner))
					.catch(() => updateNumberPanelScale(numberPanel, numberPanelInner));
			} else if (window.MathJax?.startup?.promise) {
				window.MathJax.startup.promise.then(() => {
					if (typeof window.MathJax.typesetPromise === 'function') {
						MathJax.typesetPromise([numberPanelInner])
							.then(() => updateNumberPanelScale(numberPanel, numberPanelInner))
							.catch(() => {});
					}
				});
			} else {
				updateNumberPanelScale(numberPanel, numberPanelInner);
			}
		} catch {
			updateNumberPanelScale(numberPanel, numberPanelInner);
		}
	}

	function applyConfig() {
		updateHUD(u_time);
	}

	onMount(() => {
		// Fensterübergreifender Sync (BroadcastChannel) - idempotent.
		initSync();

		// URL-Sync: configStore/playbackStore aus der URL befüllen, BEVOR die
		// Komponenten mounten (ControlPanel/PlaybackBar lesen sie direkt).
		const URL_PARAMS = new URLSearchParams(window.location.search);
		configStore.update((c) => ({ ...c, ...parseConfigFromUrl(URL_PARAMS) }));
		playbackStore.update((p) => ({
			...p,
			...parsePlaybackFromUrl(URL_PARAMS, get(compiledStore)),
		}));

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
			updateHUD(u_time);
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
<div id="bankPanel"><div id="bankPanelMount"></div></div>
<div class="overlay-panel" id="restGridPanel"><div id="restGridMount"></div></div>

<div class="overlay-panel" id="settingsPanel">
	<div class="error-msg" id="errorMsg"></div>
	<div id="controlPanelMount"></div>
</div>

<div id="bottomBar">
	<div id="playbackBarMount"></div>
</div>
