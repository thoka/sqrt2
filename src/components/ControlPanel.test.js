import { mount, unmount, flushSync } from 'svelte';
import { expect, test, afterEach } from 'vitest';
import { get } from 'svelte/store';
import ControlPanel from './ControlPanel.svelte';
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

test('ControlPanel rendert die aktuellen configStore-Werte', () => {
	const app = mount(ControlPanel, { target: document.body });
	const [baseInput, depthInput] = document.querySelectorAll('input[type=number]');
	expect(baseInput.value).toBe('10');
	expect(depthInput.value).toBe('16');
	unmount(app);
});

test('Basis-Feld: löst erst bei "change", nicht bei "input" eine configStore-Änderung aus', () => {
	const app = mount(ControlPanel, { target: document.body });
	const baseInput = document.querySelectorAll('input[type=number]')[0];

	baseInput.value = '7';
	fire(baseInput, 'input');
	flushSync();
	expect(get(configStore).base).toBe(10);

	fire(baseInput, 'change');
	flushSync();
	expect(get(configStore).base).toBe(7);

	unmount(app);
});

test('Performance-Warnung bei Tiefe > 5 wurde entfernt', () => {
	const app = mount(ControlPanel, { target: document.body });
	expect(document.body.textContent).not.toContain('kann Leistung beeinträchtigen');
	unmount(app);
});

test('Tabs sind vorhanden (Grundeinstellungen aktiv)', () => {
	const app = mount(ControlPanel, { target: document.body });
	expect(document.body.textContent).toContain('Grundeinstellungen');
	expect(document.body.textContent).toContain('Animation');
	expect(document.body.textContent).toContain('Admin');
	expect(document.body.textContent).toContain('Remote-Connect');
	// Standardtab zeigt die Grundeinstellungen (Basis/Tiefe).
	expect(document.body.textContent).toContain('Basis');
	expect(document.body.textContent).toContain('Tiefe');
	unmount(app);
});

test('Remote-Ansicht zeigt nur Grundeinstellungen', () => {
	const app = mount(ControlPanel, {
		target: document.body,
		props: { visibleTabs: ['Grundeinstellungen'] },
	});
	expect(document.body.textContent).toContain('Grundeinstellungen');
	expect(document.body.textContent).not.toContain('Animation');
	expect(document.body.textContent).not.toContain('Admin');
	expect(document.body.textContent).not.toContain('Remote-Connect');
	unmount(app);
});

test('Auto-Zoom-Aktivierung (range) aktualisiert configStore.zoomEngagement live bei "input"', () => {
	// Klassischer Regler-Modus (edgeZoomControlMode=false) ist seit TODO.md
	// "Steuerung" nicht mehr der Default - fuer diesen Test explizit setzen.
	configStore.update((c) => ({ ...c, edgeZoomControlMode: false }));
	const app = mount(ControlPanel, { target: document.body });
	const label = [...document.querySelectorAll('.control-group')].find((g) =>
		g.textContent.startsWith('Auto-Zoom: Aktivierung'),
	);
	const rangeInput = label.querySelector('input[type=range]');

	rangeInput.value = '0.5';
	fire(rangeInput, 'input');
	flushSync();
	expect(get(configStore).zoomEngagement).toBe(0.5);

	unmount(app);
});

test('Auto-Zoom-Stärke (range) aktualisiert configStore.zoomLevel live bei "input"', () => {
	const app = mount(ControlPanel, { target: document.body });
	const label = [...document.querySelectorAll('.control-group')].find((g) =>
		g.textContent.startsWith('Auto-Zoom: Stärke'),
	);
	const rangeInput = label.querySelector('input[type=range]');

	rangeInput.value = '0.5';
	fire(rangeInput, 'input');
	flushSync();
	expect(get(configStore).zoomLevel).toBe(0.5);

	unmount(app);
});

test('Abstraktion (range) aktualisiert configStore.abstraction live bei "input"', () => {
	// Klassischer Regler-Modus (edgeZoomControlMode=false) ist seit TODO.md
	// "Steuerung" nicht mehr der Default - fuer diesen Test explizit setzen.
	configStore.update((c) => ({ ...c, edgeZoomControlMode: false }));
	const app = mount(ControlPanel, { target: document.body });
	const label = [...document.querySelectorAll('.control-group')].find((g) =>
		g.textContent.startsWith('Abstraktion'),
	);
	const rangeInput = label.querySelector('input[type=range]');

	rangeInput.value = '0.7';
	fire(rangeInput, 'input');
	flushSync();
	expect(get(configStore).abstraction).toBeCloseTo(0.7);

	unmount(app);
});

// --- Alternative Rand-Zoom-Steuerung (docs/Alternative Zoom-Steuerung,md) ---

function goToTab(name) {
	const btn = [...document.querySelectorAll('.tab-btn')].find((b) => b.textContent === name);
	btn.click();
	flushSync();
}

test('Admin: Checkbox "Alternative Rand-Zoom-Steuerung" schaltet configStore.edgeZoomControlMode um', () => {
	// Startzustand fuer diesen Test explizit auf "aus" setzen (Default ist
	// inzwischen "an", siehe TODO.md "Steuerung") - der Test prueft das
	// Umschalten selbst, nicht den Default-Wert.
	configStore.update((c) => ({ ...c, edgeZoomControlMode: false }));
	const app = mount(ControlPanel, { target: document.body });
	goToTab('Admin');
	const checkbox = [...document.querySelectorAll('.control-group')]
		.find((g) => g.textContent.includes('Alternative Rand-Zoom-Steuerung'))
		.querySelector('input[type=checkbox]');

	expect(get(configStore).edgeZoomControlMode).toBe(false);
	checkbox.checked = true;
	fire(checkbox, 'change');
	flushSync();
	expect(get(configStore).edgeZoomControlMode).toBe(true);

	unmount(app);
});

test('Grundeinstellungen: bei edgeZoomControlMode=true ersetzen 3 Radio-Buttons Aktivierung+Abstraktion', () => {
	configStore.update((c) => ({ ...c, edgeZoomControlMode: true, zoomState: 'rand' }));
	const app = mount(ControlPanel, { target: document.body });

	expect(document.body.textContent).toContain('Flächentreu');
	expect(document.body.textContent).toContain('Rand sichtbar');
	expect(document.body.textContent).toContain('Gleichmäßig');
	// Die alte "Auto-Zoom: Aktivierung"-Beschriftung ist im Alt-Modus weg.
	expect(document.body.textContent).not.toContain('Auto-Zoom: Aktivierung');
	// "Auto-Zoom: Stärke" bleibt unabhaengig vom Zustand immer sichtbar.
	expect(document.body.textContent).toContain('Auto-Zoom: Stärke');

	const radios = document.querySelectorAll('input[type=radio][name=zoomState]');
	expect(radios.length).toBe(3);
	const gleichmaessigRadio = [...radios].find(
		(r) => r.closest('label').textContent.trim() === 'Gleichmäßig',
	);
	gleichmaessigRadio.checked = true;
	fire(gleichmaessigRadio, 'change');
	flushSync();
	expect(get(configStore).zoomState).toBe('gleichmaessig');

	unmount(app);
});

test('Tick-Eingabe: springt über playbackStore.time zum passenden Zeitpunkt (GLOBAL_TTM aus compiledStore)', () => {
	const app = mount(ControlPanel, { target: document.body });
	// Admin-Tab aktivieren (Tick-Feld liegt dort).
	const adminTab = [...document.querySelectorAll('.tab-btn')].find(
		(b) => b.textContent === 'Admin',
	);
	adminTab.click();
	flushSync();
	// Das Tick-Feld hat keine feste ID mehr - über den zugehörigen Label-Text finden.
	const tickLabel = [...document.querySelectorAll('.control-group')].find((g) =>
		g.textContent.startsWith('Tick (Debug)'),
	);
	const tick = tickLabel.querySelector('input');

	tick.value = '5';
	fire(tick, 'change');
	flushSync();
	// GLOBAL_TTM.tickToTime(5) sollte einen positiven, endlichen Zeitpunkt liefern
	expect(get(playbackStore).time).toBeGreaterThan(0);

	unmount(app);
});
