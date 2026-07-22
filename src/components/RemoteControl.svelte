<script>
	// RemoteControl (TOOLING_SPEC.md Phase 5, erweitert um Cross-Device
	// via Connection-Service, Spec §12) - zweiter Vite-Entry für ein
	// separates Fenster/Gerät: nur Steuerung (ControlPanel + PlaybackBar),
	// KEIN Canvas und KEIN Rest-Widget. Liest/schreibt ausschließlich
	// configStore/playbackStore.
	//
	// Zwei Transportwege, beide gekapselt in syncedStore (die Komponente
	// merkt vom Transport nichts):
	//  - BroadcastChannel (Same-Browser, z.B. zweiter Tab) via initSync().
	//  - WebSocket-Relay (Cross-Device, z.B. Handy via QR-Code) via
	//    initNetworkSync(), wenn die URL die Parameter ws+token (optional
	//    pin) trägt (vom Exponat generierter Gast-Link).
	import { get } from 'svelte/store';
	import ControlPanel from './ControlPanel.svelte';
	import PlaybackBar from './PlaybackBar.svelte';
	import SpeedSlider from './SpeedSlider.svelte';
	import { playbackStore, configStore, compiledStore } from '../lib/stores.js';
	import { initSync, initNetworkSync } from '../lib/syncedStore.js';
	import { createWsRoom } from '../lib/connection.js';

	initSync();

	const SPEED_STEP = 1.3;

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
	function togglePlay() {
		playbackStore.update((p) => ({ ...p, isPlaying: !p.isPlaying }));
	}
	function toggleDirection() {
		playbackStore.update((p) => ({
			...p,
			direction: p.direction === 1 ? -1 : 1,
		}));
	}
	function faster() {
		configStore.update((c) => ({ ...c, playSpeed: c.playSpeed * SPEED_STEP }));
	}
	function slower() {
		configStore.update((c) => ({ ...c, playSpeed: c.playSpeed / SPEED_STEP }));
	}

	// Gast-Verbindung zum Relay, falls der QR-Gast-Link mit ws/token/pin
	// aufgerufen wurde. Ansonsten bleibt es reiner BroadcastChannel-Sync.
	const params = new URLSearchParams(location.search);
	const wsParam = params.get('ws');
	const tokenParam = params.get('token');
	if (wsParam && tokenParam) {
		const guestWs = new URL(wsParam);
		guestWs.searchParams.set('token', tokenParam);
		guestWs.searchParams.set('role', 'guest');
		const pin = params.get('pin');
		if (pin != null) guestWs.searchParams.set('pin', pin);
		const room = createWsRoom({
			url: guestWs.toString(),
			onStatus: (s) => {
				const el = document.getElementById('relayStatus');
				if (el) el.textContent = s;
			},
		});
		initNetworkSync(room);
	}
</script>

<main class="remote">
	<h1>Fernsteuerung</h1>
	<p class="hint">
		Steuert das Haupttool (&sqrt;2-Flächenmodell) auf einem anderen Bildschirm. Änderungen hier
		werden live übernommen.
	</p>
	<p class="hint">
		Relay-Status: <span id="relayStatus">idle</span>
	</p>
	<div id="controlPanelMount">
		<ControlPanel visibleTabs={['Grundeinstellungen']} />
	</div>
	<div class="remote-playback">
		<SpeedSlider variant="control" />
		<div id="playbackBarMount"><PlaybackBar /></div>
	</div>
	<div class="remote-keys">
		<button class="key-btn" onclick={() => jumpShell(-1)} title="Schale zurück">⏮</button>
		<button class="key-btn" onclick={() => stepTick(-1)} title="Tick zurück">←</button>
		<button class="key-btn play-btn" onclick={togglePlay} title="Play / Pause"
			>{$playbackStore.isPlaying ? '⏸' : '▶'}</button
		>
		<button class="key-btn" onclick={() => stepTick(1)} title="Tick vorwärts">→</button>
		<button class="key-btn" onclick={() => jumpShell(1)} title="Schale vorwärts">⏭</button>
		<button class="key-btn" onclick={toggleDirection} title="Richtungswechsel">↩</button>
		<button class="key-btn" onclick={slower} title="Langsamer (÷1.3)">−</button>
		<button class="key-btn" onclick={faster} title="Schneller (×1.3)">+</button>
	</div>
</main>

<style>
	.remote {
		font-family: system-ui, sans-serif;
		background: #0f172a;
		color: #cbd5e1;
		min-height: 100vh;
		margin: 0;
		padding: 1rem 1.25rem;
		box-sizing: border-box;
	}
	h1 {
		color: #3b82f6;
		font-size: 1.4rem;
		margin: 0 0 0.25rem;
	}
	.hint {
		font-size: 0.85rem;
		color: #94a3b8;
		margin: 0 0 1rem;
		max-width: 40ch;
	}
	:global(.control-group) {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin: 6px 0;
		font-size: 0.9rem;
	}
	:global(.control-row) {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}
	:global(hr) {
		border: 1px solid #334155;
		margin: 10px 0;
	}
	.remote-playback {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 100%;
	}
	.remote-playback :global(#playbackBarMount) {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.remote-playback :global(#playbackBarMount #timeSlider) {
		flex: 1 1 auto;
		min-width: 0;
		width: 100%;
	}
	:global(.control-group input[type='range']) {
		width: 100%;
	}
	.remote-keys {
		display: flex;
		gap: 6px;
		margin-top: 12px;
		flex-wrap: wrap;
	}
	.key-btn {
		background: #1e293b;
		color: #cbd5e1;
		border: 1px solid #334155;
		border-radius: 6px;
		padding: 8px 14px;
		font-size: 1.1rem;
		cursor: pointer;
		min-width: 40px;
		text-align: center;
	}
	.key-btn:hover {
		background: #334155;
		color: #f8fafc;
	}
	.key-btn:active {
		background: #3b82f6;
		color: #fff;
	}
	.play-btn {
		background: #1e3a5f;
		border-color: #3b82f6;
	}
</style>
