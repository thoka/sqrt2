// Persistente Tests für src/lib/urlState.js (TOOLING_SPEC.md Phase 3) -
// laufen via `pnpm test` (node:test). Reines Modul (kein DOM-Zugriff), daher
// wie compiler.js hier auf Root-Ebene getestet statt via vitest/jsdom (siehe
// CLAUDE.md "Svelte-Komponenten-Tests").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigFromUrl, parsePlaybackFromUrl, buildStateParams } from './src/lib/urlState.js';

const DEFAULT_CONFIG = {
    base: 10, depth: 16, transformMode: 'S',
    bankZoomThresholdPowers: 0, autoZoomMinPx: 3, zoomSpeedCoef: 0.012,
    compactionEnabled: false, compactionTransitionTicks: 3,
    lineWidth: 0.3, pauseDuration: 1.5, playSpeed: 2.0, modeAB: 0.0,
};
const DEFAULT_PLAYBACK = { time: 0, isPlaying: false, direction: 1 };
const FAKE_COMPILED = { MAX_TIME: 10, GLOBAL_TTM: { maxTick: 20, tickToTime: (t) => t / 2, timeToTick: (t) => t * 2 } };

test('parseConfigFromUrl(): leere Params liefern leeres Overrides-Objekt (Defaults bleiben unangetastet)', () => {
    let overrides = parseConfigFromUrl(new URLSearchParams());
    assert.deepStrictEqual(overrides, {});
});

test('parseConfigFromUrl(): liest nur die tatsächlich gesetzten Parameter', () => {
    let overrides = parseConfigFromUrl(new URLSearchParams('base=7&depth=5'));
    assert.deepStrictEqual(overrides, { base: 7, depth: 5 });
});

test('parseConfigFromUrl(): ungültige numerische Werte (NaN) werden ignoriert statt Defaults zu überschreiben', () => {
    let overrides = parseConfigFromUrl(new URLSearchParams('base=nicht-numerisch'));
    assert.deepStrictEqual(overrides, {});
});

test('parseConfigFromUrl(): Checkbox-Feld "compaction" wird als Boolean gelesen', () => {
    assert.deepStrictEqual(parseConfigFromUrl(new URLSearchParams('compaction=1')), { compactionEnabled: true });
    assert.deepStrictEqual(parseConfigFromUrl(new URLSearchParams('compaction=0')), { compactionEnabled: false });
});

test('parseConfigFromUrl(): modeab wird auf [0,1] geklammert', () => {
    assert.deepStrictEqual(parseConfigFromUrl(new URLSearchParams('modeab=5')), { modeAB: 1 });
    assert.deepStrictEqual(parseConfigFromUrl(new URLSearchParams('modeab=-5')), { modeAB: 0 });
});

test('parsePlaybackFromUrl(): "time" hat Vorrang vor "tick", falls beide angegeben sind', () => {
    let overrides = parsePlaybackFromUrl(new URLSearchParams('time=3&tick=10'), FAKE_COMPILED);
    assert.strictEqual(overrides.time, 3);
});

test('parsePlaybackFromUrl(): "tick" wird über GLOBAL_TTM.tickToTime() in Zeit umgerechnet', () => {
    let overrides = parsePlaybackFromUrl(new URLSearchParams('tick=10'), FAKE_COMPILED);
    assert.strictEqual(overrides.time, 5); // FAKE_COMPILED.tickToTime(10) = 10/2
});

test('parsePlaybackFromUrl(): "time" wird auf [0, MAX_TIME] geklammert', () => {
    assert.strictEqual(parsePlaybackFromUrl(new URLSearchParams('time=999'), FAKE_COMPILED).time, 10);
    assert.strictEqual(parsePlaybackFromUrl(new URLSearchParams('time=-5'), FAKE_COMPILED).time, 0);
});

test('parsePlaybackFromUrl(): "play" wird als Boolean gelesen, fehlt ohne Parameter', () => {
    assert.strictEqual(parsePlaybackFromUrl(new URLSearchParams('play=1'), FAKE_COMPILED).isPlaying, true);
    assert.strictEqual(parsePlaybackFromUrl(new URLSearchParams(''), FAKE_COMPILED).isPlaying, undefined);
});

test('buildStateParams() -> parseConfigFromUrl()/parsePlaybackFromUrl() ist ein Roundtrip (Export == Import)', () => {
    let config = { ...DEFAULT_CONFIG, base: 7, depth: 12, compactionEnabled: true, modeAB: 0.42 };
    let playback = { time: 4.5, isPlaying: true, direction: -1 };
    let params = buildStateParams(config, playback);

    let configOverrides = parseConfigFromUrl(params);
    for (let key of Object.keys(configOverrides)) {
        assert.strictEqual(configOverrides[key], config[key], `Feld ${key} sollte roundtrippen`);
    }
    let playbackOverrides = parsePlaybackFromUrl(params, { MAX_TIME: 100, GLOBAL_TTM: null });
    assert.ok(Math.abs(playbackOverrides.time - playback.time) < 1e-6);
    assert.strictEqual(playbackOverrides.isPlaying, playback.isPlaying);
});

test('buildStateParams() setzt jeden erwarteten URL-Schlüssel', () => {
    let params = buildStateParams(DEFAULT_CONFIG, DEFAULT_PLAYBACK);
    for (let key of ['base', 'depth', 'mode', 'zoomthresh', 'autozoom', 'zoomspeed', 'linewidth', 'pause', 'compaction', 'speed', 'transition', 'modeab', 'time', 'play']) {
        assert.ok(params.has(key), `Parameter "${key}" fehlt`);
    }
});
