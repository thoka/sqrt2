<script>
	// SpeedSlider - logarithmischer Geschwindigkeitsregler (playSpeed) mit
	// Faktor 1 exakt in der Mitte (Bereich ~1/20 … 20×). Wird an zwei Stellen
	// genutzt (INTERFACE-TODO "Korrektur: Geschwindigkeitsregler"):
	//   - variant="control": vollwertiges Widget in den Controls
	//     (Grundeinstellungen-Tab / Fernsteuerung) inkl. Label + Readout.
	//   - variant="compact": schmaler, dezenter Regler fürs Hauptfenster,
	//     optisch wie der Zeitregler, rechts vor dem Bank-Zähler.
	import { configStore } from '../lib/stores.js';
	import { locale, _ } from '../lib/i18n.js';

	let { variant = 'control' } = $props();

	const SPEED_MAX = 20;
	const SPEED_SPAN = 2 * Math.log(SPEED_MAX);
	let speedPos = $state(0.5);

	// Position aus dem Store-Wert ableiten (playSpeed=1 -> Mitte).
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
</script>

{#if variant === 'control'}
	<label class="control-group" style="margin-top:6px;"
		>{$_('speed.label')}
		<div class="speed-control-row">
			<input
				type="range"
				min="0"
				max="1"
				step="0.001"
				bind:value={speedPos}
				oninput={onSpeedInput}
			/>
			<span class="speed-readout"
				>{$configStore.playSpeed.toLocaleString($locale, {
					minimumFractionDigits: 1,
					maximumFractionDigits: 1,
				})}×</span
			>
		</div>
	</label>
{:else}
	<div class="compact-speed">
		<input
			type="range"
			class="compact-slider"
			title={$_('speed.label')}
			min="0"
			max="1"
			step="0.001"
			bind:value={speedPos}
			oninput={onSpeedInput}
		/>
		<span class="compact-speed-readout"
			>{$configStore.playSpeed.toLocaleString($locale, {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			})}×</span
		>
	</div>
{/if}

<style>
	.speed-control-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.speed-control-row input[type='range'] {
		flex: 1 1 auto;
		min-width: 0;
	}
	.speed-readout {
		color: #3b82f6;
		font-weight: bold;
		font-size: 0.85em;
		flex-shrink: 0;
		white-space: nowrap;
		min-width: 3em;
		text-align: right;
	}
	.compact-slider {
		width: 120px;
		border: none;
		-webkit-appearance: none;
		appearance: none;
		height: 3px;
		border-radius: 2px;
		background-color: rgba(255, 255, 255, 0.25);
		background-clip: content-box;
		outline: none;
		cursor: pointer;
		padding: 10px 0;
		box-sizing: content-box;
	}
	.compact-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #94a3b8;
		cursor: pointer;
	}
	.compact-slider::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: none;
		background: #94a3b8;
		cursor: pointer;
	}
	.compact-speed {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.compact-speed-readout {
		color: #cbd5e1;
		font-family: monospace;
		font-weight: normal;
		font-size: 0.85em;
		flex-shrink: 0;
		white-space: nowrap;
		min-width: 3.4em;
		text-align: left;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
	}
</style>
