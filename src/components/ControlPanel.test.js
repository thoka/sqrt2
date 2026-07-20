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

test('Modus-B-Regler (range) aktualisiert configStore.modeAB live bei "input"', () => {
	const app = mount(ControlPanel, { target: document.body });
	// Der Zoom-Regler (modeAB) trägt das Label "Zoom".
	const zoomLabel = [...document.querySelectorAll('.control-group')].find((g) =>
		g.textContent.startsWith('Zoom'),
	);
	const rangeInput = zoomLabel.querySelector('input[type=range]');

	rangeInput.value = '0.5';
	fire(rangeInput, 'input');
	flushSync();
	expect(get(configStore).modeAB).toBe(0.5);

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

// --- Alternative Rand-Zoom-Steuerung (docs/Alternative Zoom-Steuerung,md) ---

function goToTab(name) {
	const btn = [...document.querySelectorAll('.tab-btn')].find((b) => b.textContent === name);
	btn.click();
	flushSync();
}

test('Admin: Checkbox "Alternative Rand-Zoom-Steuerung" schaltet configStore.edgeZoomControlMode um', () => {
	const app = mount(ControlPanel, { target: document.body });
	goToTab('Admin');
	const checkbox = [...document.querySelectorAll('.control-group')]
		.find((g) => g.textContent.includes('Alternative Rand-Zoom-Steuerung'))
		.querySelector('input[type=checkbox]');

	expect(get(configStore).edgeZoomControlMode).toBe(false);
	fire(checkbox, 'change');
	checkbox.checked = true;
	fire(checkbox, 'change');
	flushSync();
	expect(get(configStore).edgeZoomControlMode).toBe(true);

	unmount(app);
});

test('Grundeinstellungen: bei edgeZoomControlMode=true ersetzen 3 Radio-Buttons die 2 Regler', () => {
	configStore.update((c) => ({ ...c, edgeZoomControlMode: true, zoomState: 'rand' }));
	const app = mount(ControlPanel, { target: document.body });

	expect(document.body.textContent).toContain('Flächentreu');
	expect(document.body.textContent).toContain('Rand sichtbar');
	expect(document.body.textContent).toContain('Gleichmäßig');
	// Die alte "Auto-Zoom: Mindestpixelgröße"-Beschriftung ist im Alt-Modus weg.
	expect(document.body.textContent).not.toContain('Auto-Zoom: Mindestpixelgröße');

	const radios = document.querySelectorAll('input[type=radio][name=zoomState]');
	expect(radios.length).toBe(3);
	const gleichmaessigRadio = [...radios].find(
		(r) => r.closest('label').textContent.trim() === 'Gleichmäßig',
	);
	fire(gleichmaessigRadio, 'change');
	gleichmaessigRadio.checked = true;
	fire(gleichmaessigRadio, 'change');
	flushSync();
	expect(get(configStore).zoomState).toBe('gleichmaessig');

	unmount(app);
});

test('Animation: Feinregler fuer "Rand sichtbar" ist nur im Zustand "rand" aktiv', () => {
	configStore.update((c) => ({ ...c, edgeZoomControlMode: true, zoomState: 'gleichmaessig' }));
	const app = mount(ControlPanel, { target: document.body });
	goToTab('Animation');

	const fineLabel = [...document.querySelectorAll('.control-group')].find((g) =>
		g.textContent.startsWith('Zoom (Feinregler'),
	);
	const fineSlider = fineLabel.querySelector('input[type=range]');
	expect(fineSlider.disabled).toBe(true);

	configStore.update((c) => ({ ...c, zoomState: 'rand' }));
	flushSync();
	expect(fineSlider.disabled).toBe(false);

	fineSlider.value = '0.3';
	fire(fineSlider, 'input');
	flushSync();
	expect(get(configStore).randZoomLevel).toBeCloseTo(0.3);
	expect(get(configStore).modeAB).toBeCloseTo(0.3);

	unmount(app);
});
