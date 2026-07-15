import { mount, unmount, flushSync } from 'svelte';
import { expect, test, afterEach } from 'vitest';
import { get } from 'svelte/store';
import RestCounterGrid from './RestCounterGrid.svelte';
import { configStore, playbackStore, compiledStore } from '../lib/stores.js';

const DEFAULT_CONFIG = get(configStore);
const DEFAULT_PLAYBACK = get(playbackStore);

afterEach(() => {
	configStore.set({ ...DEFAULT_CONFIG });
	playbackStore.set({ ...DEFAULT_PLAYBACK });
});

function expectedCounts(compiled, nmax, time) {
	let arr = new Array(Math.min(2 * nmax + 1, 50)).fill(0);
	for (let p of compiled.bank_pieces) {
		if (p.k < arr.length && time >= p.born_time && time < p.cut_time && time < p.taken_time)
			arr[p.k]++;
	}
	return arr;
}

test('rendert bis zu 4x4 Zellen (gedeckelt) mit korrektem Bestand je Exponent', () => {
	configStore.set({ ...DEFAULT_CONFIG, base: 2, depth: 3 });
	flushSync();
	const compiled = get(compiledStore);
	const nmax = 3;

	const app = mount(RestCounterGrid, { target: document.body });
	const grid = document.querySelector('.rest-grid');
	expect(grid).not.toBeNull();

	// 2*3+1 = 7 Exponenten, gedeckelt auf 16 -> 7 Zellen
	const cells = grid.querySelectorAll('.cell');
	expect(cells.length).toBe(Math.min(2 * nmax + 1, 16));

	const expected = expectedCounts(compiled, nmax, 0);
	for (let k = 0; k < cells.length; k++) {
		expect(cells[k].querySelector('.count').textContent).toBe(String(expected[k]));
		// Exponenten-Label: "0" fuer k=0, sonst "-k"
		expect(cells[k].querySelector('.exp').textContent).toBe(k === 0 ? '0' : `-${k}`);
	}
	// bei kleiner Tiefe kein Überlauf-Badge
	expect(grid.querySelector('.overflow-badge')).toBeNull();

	unmount(app);
});

test('reagiert auf playbackStore.time: Zähler ändern sich zur Halbzeit', () => {
	configStore.set({ ...DEFAULT_CONFIG, base: 2, depth: 3 });
	flushSync();
	const compiled = get(compiledStore);

	const app = mount(RestCounterGrid, { target: document.body });
	const grid = document.querySelector('.rest-grid');
	const countsAt0 = [...grid.querySelectorAll('.count')].map((e) => parseInt(e.textContent, 10));
	const expected0 = expectedCounts(compiled, 3, 0);
	expect(countsAt0).toEqual(expected0.slice(0, 16));

	playbackStore.update((p) => ({ ...p, time: compiled.MAX_TIME / 2 }));
	flushSync();
	const countsMid = [...grid.querySelectorAll('.count')].map((e) => parseInt(e.textContent, 10));
	const expectedMid = expectedCounts(compiled, 3, compiled.MAX_TIME / 2);
	expect(countsMid).toEqual(expectedMid.slice(0, 16));

	unmount(app);
});
