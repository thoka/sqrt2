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
	import ControlPanel from './ControlPanel.svelte';
	import PlaybackBar from './PlaybackBar.svelte';
	import SpeedSlider from './SpeedSlider.svelte';
	import { initSync, initNetworkSync } from '../lib/syncedStore.js';
	import { createWsRoom } from '../lib/connection.js';

	initSync();

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
	}
	.remote-playback :global(#timeSlider) {
		flex: 1 1 auto;
		min-width: 0;
	}
</style>
