import { mount, unmount, flushSync } from 'svelte';
import { expect, test, afterEach } from 'vitest';
import { get } from 'svelte/store';
import SpeedSlider from './SpeedSlider.svelte';
import { configStore } from '../lib/stores.js';

const DEFAULT_CONFIG = get(configStore);

afterEach(() => {
	configStore.set({ ...DEFAULT_CONFIG });
});

test('SpeedSlider (control): Regler schreibt configStore.playSpeed (logarithmisch)', () => {
	const app = mount(SpeedSlider, { target: document.body, props: { variant: 'control' } });
	const slider = document.querySelector('input[type=range]');
	expect(slider).not.toBeNull();
	// Startwert aus dem Store (Default playSpeed = 2) übernommen.
	expect(get(configStore).playSpeed).toBeCloseTo(2, 1);

	// Rechtes Ende (t=1) -> Faktor SPEED_MAX = 20.
	slider.value = '1';
	slider.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	expect(get(configStore).playSpeed).toBeGreaterThan(10);

	// Linkes Ende (t=0) -> Faktor 1/SPEED_MAX = 0.05.
	slider.value = '0';
	slider.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	expect(get(configStore).playSpeed).toBeLessThan(0.2);

	unmount(app);
});

test('SpeedSlider (compact): Rendert nur den schmalen Regler ohne Label', () => {
	const app = mount(SpeedSlider, { target: document.body, props: { variant: 'compact' } });
	const sliders = document.querySelectorAll('input[type=range]');
	expect(sliders.length).toBe(1);
	expect(document.body.textContent).not.toContain('Geschwindigkeit');
	unmount(app);
});
