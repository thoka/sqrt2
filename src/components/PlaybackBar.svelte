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
	// INTERFACE-TODO "Korrektur: Geschwindigkeitsregler": die Geschwindigkeit
	// (playSpeed) ist KEIN Bestandteil dieser unteren Leiste mehr - sie lebt
	// in den Controls (ControlPanel / Fernsteuerung) und als dezenter, schmaler
	// Regler rechts vor dem Bank-Zähler im Hauptfenster. Hier bleiben nur
	// Play/Pause + Zeit-Positionsregler (immer sichtbar).
	import { playbackStore, compiledStore } from '../lib/stores.js';

	function togglePlaying() {
		playbackStore.update((p) => ({ ...p, isPlaying: !p.isPlaying }));
	}
	function onSliderInput(e) {
		playbackStore.update((p) => ({ ...p, time: parseFloat(e.target.value) }));
	}

	let pct = $derived(
		$compiledStore?.MAX_TIME > 0 ? ($playbackStore.time / $compiledStore.MAX_TIME) * 100 : 0,
	);
</script>

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
