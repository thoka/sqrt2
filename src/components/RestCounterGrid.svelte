<script>
	// RestCounterGrid (TOOLING_SPEC.md Phase 4c) - NEUES horizontales
	// Rest-Widget als Alternative zu <RestCounterBars>. Design (in Spec
	// §7 bewusst offen gelassen) hier festgelegt: ein bis zu 4×4-Grid
	// (4 Spalten, bis zu 4 Zeilen = max. 16 Zellen), je Zelle ein
	// Exponent k (Ziffern-Stelle) mit einem proportionalen Balken
	// (Höhe ∝ sichtbarer Bestand, relativ zum Maximum der sichtbaren
	// Zellen) + dem Zähler + dem Exponenten-Label. Exponenten ab k=16
	// (bei tiefer Rekursion/Basis 2 viele) werden nicht mehr einzeln
	// gezeigt, sondern als "+N"-Badge (N = Summe ihres Bestands) oben
	// rechts im Gitter zusammengefasst. Farbgebung identisch zu den
	// übrigen Widgets (COLORS[k % len], siehe sqrt2.html / RestCounterBars).
	//
	// Liest - wie RestCounterBars - nur lesend compiledStore
	// (bank_pieces/depth) + playbackStore.time, KEINEN Store-Schreib-
	// zugriff. Damit sind Balken- und Grid-Widget vollständig
	// austauschbar (Umschaltung über displayStore, siehe ControlPanel).
	import { playbackStore, compiledStore, configStore } from '../lib/stores.js';

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
	const GRID_CAP = 16; // 4×4

	let counts = $derived.by(() => {
		let c = $compiledStore;
		let nmax = $configStore.depth;
		let arr = new Array(Math.min(2 * nmax + 1, 50)).fill(0);
		let time = $playbackStore.time;
		if (!c) return arr;
		for (let p of c.bank_pieces) {
			if (p.k < arr.length && time >= p.born_time && time < p.cut_time && time <= p.taken_time)
				arr[p.k]++;
		}
		return arr;
	});

	// Sichtbare Zellen (k = 0..GRID_CAP-1) + Überlauf-Bestand (k >= GRID_CAP)
	let cells = $derived.by(() => {
		let visible = counts.slice(0, GRID_CAP);
		let overflow = counts.slice(GRID_CAP).reduce((a, b) => a + b, 0);
		let maxCount = Math.max(1, ...visible);
		return { visible, overflow, maxCount };
	});
</script>

<div class="rest-grid" class:has-overflow={cells.overflow > 0}>
	{#each cells.visible as count, k}
		{@const color = COLORS[k % COLORS.length]}
		{@const expText = k === 0 ? '0' : `-${k}`}
		{@const frac = Math.min(1, count / cells.maxCount)}
		<div class="cell" style="opacity: {count === 0 ? 0.35 : 1.0}">
			<div class="bar" style="height: {frac * 100}%; background: {color}"></div>
			<div class="exp" style="color: {color}">{expText}</div>
			<div class="count">{count}</div>
		</div>
	{/each}
	{#if cells.overflow > 0}
		<div class="overflow-badge">+{cells.overflow}</div>
	{/if}
</div>

<style>
	.rest-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
		padding: 8px;
		position: relative;
	}
	.cell {
		position: relative;
		aspect-ratio: 1 / 1;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 4px;
		overflow: hidden;
	}
	.bar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		border-radius: 0 0 4px 4px;
		min-height: 2px;
	}
	.exp {
		position: absolute;
		top: 3px;
		right: 5px;
		font-family: monospace;
		font-weight: bold;
		font-size: 1.1em;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
	}
	.count {
		position: absolute;
		bottom: 3px;
		left: 5px;
		font-family: monospace;
		font-size: 0.95em;
		color: #e2e8f0;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
	}
	.overflow-badge {
		position: absolute;
		top: 2px;
		right: 4px;
		background: rgba(245, 158, 11, 0.9);
		color: #0b1120;
		font-family: monospace;
		font-weight: bold;
		font-size: 0.8em;
		padding: 1px 5px;
		border-radius: 8px;
	}
</style>
