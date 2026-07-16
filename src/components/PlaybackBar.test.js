import { mount, unmount, flushSync } from 'svelte';
import { expect, test, afterEach } from 'vitest';
import { get } from 'svelte/store';
import PlaybackBar from './PlaybackBar.svelte';
import { configStore, playbackStore } from '../lib/stores.js';

const DEFAULT_CONFIG = get(configStore);
const DEFAULT_PLAYBACK = get(playbackStore);

afterEach(() => {
	configStore.set({ ...DEFAULT_CONFIG });
	playbackStore.set({ ...DEFAULT_PLAYBACK });
});

function fire(el, type) {
	el.dispatchEvent(new Event(type, { bubbles: true }));
}

test('Play-Button zeigt ▶ im Ruhezustand und schaltet playbackStore.isPlaying um', () => {
	const app = mount(PlaybackBar, { target: document.body });
	const btn = document.getElementById('playBtn');
	expect(btn.textContent).toBe('▶');

	btn.click();
	flushSync();
	expect(get(playbackStore).isPlaying).toBe(true);
	expect(btn.textContent).toBe('⏸');

	btn.click();
	flushSync();
	expect(get(playbackStore).isPlaying).toBe(false);

	unmount(app);
});

test('Zeitstrahl (range) schreibt playbackStore.time live bei "input"', () => {
	const app = mount(PlaybackBar, { target: document.body });
	const slider = document.getElementById('timeSlider');

	slider.value = '3.5';
	fire(slider, 'input');
	flushSync();
	expect(get(playbackStore).time).toBe(3.5);

	unmount(app);
});

test('Zeitstrahl-Max folgt compiledStore.MAX_TIME (aus configStore abgeleitet)', () => {
	const app = mount(PlaybackBar, { target: document.body });
	const slider = document.getElementById('timeSlider');
	const maxBefore = parseFloat(slider.max);
	expect(maxBefore).toBeGreaterThan(0);

	configStore.update((c) => ({ ...c, depth: 3 }));
	flushSync();
	expect(parseFloat(slider.max)).not.toBe(maxBefore);

	unmount(app);
});

test('Zeit-Readout zeigt Zeit und Tick/maxTick aus GLOBAL_TTM', () => {
	const app = mount(PlaybackBar, { target: document.body });
	playbackStore.update((p) => ({ ...p, time: 2 }));
	flushSync();
	const readout = document.getElementById('timeReadout').textContent;
	expect(readout).toContain('2.0');
	expect(readout).toMatch(/\d+\/\d+/);

	unmount(app);
});
