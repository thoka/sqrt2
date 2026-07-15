import { mount, unmount, flushSync } from 'svelte';
import { expect, test, afterEach } from 'vitest';
import { get } from 'svelte/store';
import RestCounterBars from './RestCounterBars.svelte';
import { configStore, playbackStore, compiledStore } from '../lib/stores.js';

const DEFAULT_CONFIG = get(configStore);
const DEFAULT_PLAYBACK = get(playbackStore);

afterEach(() => {
	configStore.set({ ...DEFAULT_CONFIG });
	playbackStore.set({ ...DEFAULT_PLAYBACK });
});

// Erwarteten Bestand bei einem Zeitpunkt selbst berechnen (Spiegel von
// RestCounterBars.svelte), um die gerenderte DOM nicht gegen sich selbst
// zu testen.
function expectedCounts(compiled, nmax, time) {
	let arr = new Array(Math.min(2 * nmax + 1, 50)).fill(0);
	for (let p of compiled.bank_pieces) {
		if (p.k < arr.length && time >= p.born_time && time < p.cut_time && time < p.taken_time)
			arr[p.k]++;
	}
	return arr;
}

test('rendert pro Exponent eine Zeile und zeigt bei time=0 den korrekten Bestand', () => {
	configStore.set({ ...DEFAULT_CONFIG, base: 2, depth: 3 });
	flushSync();

	const app = mount(RestCounterBars, { target: document.body });
	const inner = document.getElementById('bankPanelInner');
	expect(inner).not.toBeNull();

	const rows = inner.querySelectorAll('.bank-row');
	const compiled = get(compiledStore);
	const expected = expectedCounts(compiled, 3, 0);
	// Genau so viele Zeilen wie Exponenten mit (möglichem) Bestand.
	expect(rows.length).toBe(expected.length);
	expect(expected.some((c) => c > 0)).toBe(true);

	unmount(app);
});

test('reagiert auf playbackStore.time: Block-Darstellung ändert sich zur Halbzeit', () => {
	configStore.set({ ...DEFAULT_CONFIG, base: 2, depth: 3 });
	flushSync();
	const compiled = get(compiledStore);

	const app = mount(RestCounterBars, { target: document.body });
	const inner = document.getElementById('bankPanelInner');

	const blocksAt0 = inner.querySelectorAll('.piece-block').length;
	const expected0 = expectedCounts(compiled, 3, 0).reduce((a, b) => a + Math.min(b, 24), 0);
	expect(blocksAt0).toBe(expected0);

	playbackStore.update((p) => ({ ...p, time: compiled.MAX_TIME / 2 }));
	flushSync();
	const blocksMid = inner.querySelectorAll('.piece-block').length;
	const expectedMid = expectedCounts(compiled, 3, compiled.MAX_TIME / 2).reduce(
		(a, b) => a + Math.min(b, 24),
		0,
	);
	expect(blocksMid).toBe(expectedMid);

	unmount(app);
});
