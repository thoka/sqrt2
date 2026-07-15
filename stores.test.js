// Persistente Tests für src/lib/stores.js (TOOLING_SPEC.md Phase 2) -
// laufen via `pnpm test` (node:test). svelte/store ist reines JS ohne
// Kompilierschritt, daher hier direkt testbar wie jedes andere Modul -
// kein vitest/jsdom nötig (das ist nur für *.svelte-Komponenten reserviert,
// siehe CLAUDE.md "Svelte-Komponenten-Tests").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { configStore, playbackStore, compiledStore } from './src/lib/stores.js';

test('compiledStore leitet sich deterministisch aus configStore ab (kein manuelles Neu-Kompilieren nötig)', () => {
    let r1 = get(compiledStore);
    assert.ok(r1.TOTAL_STEPS > 0);
    assert.strictEqual(r1.bank_pieces.length > 0, true);
});

test('compiledStore reagiert auf configStore-Änderungen (derived, nicht eingefroren beim ersten Read)', () => {
    let before = get(compiledStore);
    configStore.update((c) => ({ ...c, depth: before.axes[before.axes.length - 1].exp + 2 }));
    let after = get(compiledStore);
    assert.notStrictEqual(before.TOTAL_STEPS, after.TOTAL_STEPS);
    // Aufräumen: restliche Tests in dieser Datei sollen vom Default ausgehen.
    configStore.update((c) => ({ ...c, depth: 16 }));
});

test('compiledStore bleibt bei unveränderten Nicht-Compile-Feldern (z.B. modeAB) unverändert', () => {
    // configStore trägt auch Felder, die NICHT in compileSystem() einfließen
    // (siehe TOOLING_SPEC.md 3.1: modeAB/autoZoomMinPx gehören zwar zum
    // synchronisierten configStore, aber nicht zum Compiler-Input) - ein
    // reiner Playback-Regler darf keine Neu-Kompilierung auslösen.
    let before = get(compiledStore);
    configStore.update((c) => ({ ...c, modeAB: 0.75 }));
    let after = get(compiledStore);
    assert.strictEqual(before.TOTAL_STEPS, after.TOTAL_STEPS);
    assert.strictEqual(before.MAX_TIME, after.MAX_TIME);
    configStore.update((c) => ({ ...c, modeAB: 0.0 }));
});

test('playbackStore ist von configStore/compiledStore unabhängig (eigene Schicht, siehe Spec 3.1)', () => {
    // deepStrictEqual statt strictEqual: `derived` ohne aktiven Subscriber
    // cached seinen Wert nicht zwischen get()-Aufrufen (jeder get() hängt
    // sich kurz ein und wieder aus) - compileSystem() liefert bei
    // unverändertem configStore daher inhaltsgleiche, aber NEUE Objekte.
    // Das ist reguläres svelte/store-Verhalten, kein Bug in stores.js.
    let compiledBefore = get(compiledStore);
    playbackStore.update((p) => ({ ...p, time: 5, isPlaying: true, direction: -1 }));
    assert.deepStrictEqual(get(playbackStore), { time: 5, isPlaying: true, direction: -1 });
    assert.strictEqual(get(compiledStore).TOTAL_STEPS, compiledBefore.TOTAL_STEPS);
    assert.strictEqual(get(compiledStore).MAX_TIME, compiledBefore.MAX_TIME);
    playbackStore.set({ time: 0, isPlaying: false, direction: 1 });
});
