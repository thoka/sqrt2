<script>
	// Playback-Leiste (TOOLING_SPEC.md Phase 3) - Port des bisherigen
	// #bottomBar-Inhalts (Play/Pause-Button, Zeitstrahl, Zeit-Readout) aus
	// sqrt2.html. Schreibt/liest ausschließlich playbackStore (+ MAX_TIME/
	// GLOBAL_TTM aus compiledStore für Slider-Max bzw. Tick-Readout). Die
	// eigentliche rAF-Animationsschleife (mit ihrer lastTime-Buchführung,
	// siehe CLAUDE.md "Play/Pause-Resume-Sprung") bleibt bewusst in
	// sqrt2.html - Canvas-/Timing-Logik ist Phase-4-Scope, hier wird nur
	// isPlaying umgeschaltet bzw. die Zeitposition geschoben.
	//
	// #bottomBar selbst (Sichtbarkeits-Reveal bei Mausnähe zum unteren Rand)
	// bleibt ebenfalls in sqrt2.html - diese Komponente rendert nur die drei
	// Kind-Elemente hinein, id="timeSlider" bleibt erhalten, weil die
	// bestehende CSS (#timeSlider::-webkit-slider-thumb etc.) darauf zielt.
	//
	// INTERFACE-TODO Phase 1: Geschwindigkeit (playSpeed) als nichtlinearer
	// (logarithmischer) Regler ÜBER der Zeitleiste; Faktor 1 liegt in der
	// Mitte. Zeit/Tick/Play-Scrollbar unten bleibt immer sichtbar.
	import { playbackStore, compiledStore, configStore } from '../lib/stores.js';

	function togglePlaying() {
		playbackStore.update((p) => ({ ...p, isPlaying: !p.isPlaying }));
	}
	function onSliderInput(e) {
		playbackStore.update((p) => ({ ...p, time: parseFloat(e.target.value) }));
	}

	// Logarithmischer Geschwindigkeitsregler: Position t in [0,1] -> Faktor
	// exp((t-0.5)*span), Faktor 1 exakt in der Mitte. span so gewählt, dass
	// t=1 den Maximalwert (20) ergibt; t=0 damit 1/20.
	const SPEED_MAX = 20;
	const SPEED_SPAN = 2 * Math.log(SPEED_MAX);
	let speedPos = $state(0.5);
	// Initialposition aus dem Store-Wert ableiten (playSpeed=1 -> Mitte).
	$effect(() => {
		const v = $configStore.playSpeed;
		let t = 0.5 + Math.log(v) / SPEED_SPAN;
		speedPos = Math.max(0, Math.min(1, t));
	});
	function onSpeedInput(e) {
		let t = parseFloat(e.target.value);
		let v = Math.exp((t - 0.5) * SPEED_SPAN);
		configStore.update((c) => ({ ...c, playSpeed: v }));
	}

	let pct = $derived(
		$compiledStore?.MAX_TIME > 0 ? ($playbackStore.time / $compiledStore.MAX_TIME) * 100 : 0,
	);
</script>

<div class="speed-row">
	<span class="speed-label">Geschwindigkeit</span>
	<input
		type="range"
		id="speedSlider"
		min="0"
		max="1"
		step="0.001"
		bind:value={speedPos}
		oninput={onSpeedInput}
	/>
	<span class="speed-readout"
		>{$configStore.playSpeed.toLocaleString('de-DE', {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1,
		})}×</span
	>
</div>

<div class="time-row">
	<button id="playBtn" title="Play/Pause" onclick={togglePlaying}
		>{$playbackStore.isPlaying ? '⏸' : '▶'}</button
	>
	<input
		type="range"
		id="timeSlider"
		min="0"
		max={$compiledStore?.MAX_TIME ?? 0}
		step="0.01"
		value={$playbackStore.time}
		oninput={onSliderInput}
		style="background-image: linear-gradient(to right, #fff {pct}%, transparent {pct}%);"
	/>
	<span id="timeReadout">
		{#if $compiledStore?.GLOBAL_TTM}
			{$playbackStore.time.toFixed(1)} · {Math.round(
				$compiledStore.GLOBAL_TTM.timeToTick($playbackStore.time),
			)}/{$compiledStore.GLOBAL_TTM.maxTick}
		{:else}
			{$playbackStore.time.toFixed(1)}
		{/if}
	</span>
</div>

<style>
	.speed-row,
	.time-row {
		display: flex;
		align-items: center;
		gap: 14px;
		width: 100%;
		min-width: 0;
	}
	.speed-label {
		color: #94a3b8;
		font-size: 0.8em;
		flex-shrink: 0;
		white-space: nowrap;
	}
	#speedSlider {
		flex: 1 1 auto;
		min-width: 0;
		cursor: pointer;
	}
	.speed-readout {
		color: #3b82f6;
		font-weight: bold;
		font-size: 0.8em;
		flex-shrink: 0;
		white-space: nowrap;
		min-width: 3em;
		text-align: right;
	}
</style>
