<script>
	// RestCounterBars (TOOLING_SPEC.md Phase 4) - vertikale Balken-Variante
	// des Bank-/Rest-Inventars. Port des Balken-Teils aus dem früheren
	// updateHUD() in sqrt2.html (die Zahlentafel l/l²/R bleibt dort, siehe
	// unten). Reine Funktion von <compiledStore> (bank_pieces/depth) +
	// <playbackStore.time>: zählt pro Exponent k, wieviele Bank-Stücke
	// gerade sichtbar sind (born_time <= t < cut_time UND < taken_time), und
	// rendert je Exponent eine Zeile. Liest/schreibt KEINEN Store selbst -
	// nur lesend abgeleitet, damit es als eines von mehreren, beliebig
	// austauschbaren Rest-Widgets (siehe RestCounterGrid) neben dem
	// Canvas existieren kann.
	//
	// Skalierung: bei tiefer Rekursion (viele Ziffern-Stellen) überragt die
	// natürliche Höhe irgendwann das Fenster - Inhalt ungeskaliert messen,
	// bei Bedarf auf die verfügbare Höhe herunterskalieren (nie hoch).
	// 1:1 aus updateBankPanelScale() in sqrt2.html übernommen.
	import { onMount } from 'svelte';
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
	const BLOCK_CAP = 24; // ab hier wird die Bargraph-Darstellung zu einer "+N"-Kurzform verdichtet

	// Konsistent mit getShellStepAt()/updateHUD() in sqrt2.html: nur Stücke
	// zählen, die im aktuellen Zeitfenster wirklich sichtbar sind. Die
	// Array-Länge (2*N_MAX+1, gedeckelt auf 50) hängt von der Tiefe ab -
	// N_MAX = configStore.depth (das kompilierte Ergebnis führt depth NICHT
	// mit, siehe compileSystem() in compiler.js), daher aus configStore.
	let counts = $derived.by(() => {
		let c = $compiledStore;
		let time = $playbackStore.time;
		let nmax = $configStore.depth;
		let arr = new Array(Math.min(2 * nmax + 1, 50)).fill(0);
		for (let p of c.bank_pieces) {
			if (p.k < arr.length && time >= p.born_time && time < p.cut_time && time < p.taken_time)
				arr[p.k]++;
		}
		return arr;
	});

	let innerEl = $state();
	function measure() {
		if (!innerEl) return;
		innerEl.style.transform = 'none';
		let available = window.innerHeight - 40;
		let natural = innerEl.scrollHeight;
		let scale = natural > 0 ? Math.min(1, available / natural) : 1;
		innerEl.style.transform = `scale(${scale})`;
	}
	// Re-misst, sobald sich der gerenderte Inhalt (counts) ändert - läuft
	// nach dem DOM-Update, siehe Svelte-Flush-Reihenfolge.
	$effect(() => {
		counts;
		measure();
	});
	onMount(() => {
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	});
</script>

<div id="bankPanelInner" bind:this={innerEl}>
	{#each counts as count, k}
		{@const color = COLORS[k % COLORS.length]}
		{@const expText = k === 0 ? '0' : `-${k}`}
		<div class="bank-row" style="opacity: {count === 0 ? 0.35 : 1.0}">
			{#if count === 0}
				<div class="bank-bar" style="opacity:0.25"></div>
			{:else if count <= BLOCK_CAP}
				<div class="bank-bar">
					{#each Array(count) as _}<div class="piece-block" style="background:{color}"></div>{/each}
				</div>
			{:else}
				<div class="bank-bar">
					<div style="flex-grow:1; height:10px; border-radius:2px; background:{color}"></div>
				</div>
			{/if}
			<div class="bank-exp" style="color:{color}">{expText}</div>
		</div>
	{/each}
</div>
