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

test('Tiefe > 5 zeigt die Performance-Warnung', () => {
  const app = mount(ControlPanel, { target: document.body });
  // Default-Tiefe (16) liegt bereits über der Schwelle.
  expect(document.body.textContent).toContain('kann Leistung beeinträchtigen');

  configStore.update((c) => ({ ...c, depth: 3 }));
  flushSync();
  expect(document.body.textContent).not.toContain('kann Leistung beeinträchtigen');

  unmount(app);
});

test('Modus-B-Regler (range) aktualisiert configStore.modeAB live bei "input"', () => {
  const app = mount(ControlPanel, { target: document.body });
  const rangeInput = document.querySelector('input[type=range]');

  rangeInput.value = '0.5';
  fire(rangeInput, 'input');
  flushSync();
  expect(get(configStore).modeAB).toBe(0.5);

  unmount(app);
});

test('Kompaktierungs-Checkbox schreibt configStore.compactionEnabled', () => {
  const app = mount(ControlPanel, { target: document.body });
  const checkbox = document.querySelector('input[type=checkbox]');
  expect(checkbox.checked).toBe(false);

  checkbox.checked = true;
  fire(checkbox, 'change');
  flushSync();
  expect(get(configStore).compactionEnabled).toBe(true);

  unmount(app);
});

test('Tick-Eingabe: springt über playbackStore.time zum passenden Zeitpunkt (GLOBAL_TTM aus compiledStore)', () => {
  const app = mount(ControlPanel, { target: document.body });
  // Das Tick-Feld hat keine feste ID mehr - über den zugehörigen Label-Text finden.
  const tickLabel = [...document.querySelectorAll('.control-group')].find((g) => g.textContent.startsWith('Tick ('));
  const tick = tickLabel.querySelector('input');

  tick.value = '5';
  fire(tick, 'change');
  flushSync();
  // GLOBAL_TTM.tickToTime(5) sollte einen positiven, endlichen Zeitpunkt liefern
  expect(get(playbackStore).time).toBeGreaterThan(0);

  unmount(app);
});
