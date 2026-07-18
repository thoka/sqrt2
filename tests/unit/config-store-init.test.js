// Test: URL-Parameter wirken bereits beim allerersten Compile (top-level
// Initialisierung), browser-unabhängig - nicht erst über App.onMount.
// Regression: in Firefox blieb ?base=… wirkungslos, weil der initiale
// Compile mit Defaults (base=10) startete und der spaete onMount-Override
// den bereits laufenden Compile nicht mehr ueberholte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';

// configStore.js liest beim Modul-Import window.location.search aus.
// Mit leerer URL muessen die Defaults gelten; mit ?base=2 der Wert aus der
// URL - und zwar schon beim allersten Store-Wert (bevor App.onMount greift).
test('initialConfig: leere URL -> Defaults (base=10)', async () => {
	global.window = { location: { search: '' } };
	try {
		const mod = await import('../../src/lib/configStore.js?empty');
		assert.equal(get(mod.configStore).base, 10);
	} finally {
		delete global.window;
	}
});

test('initialConfig: ?base=2 aus der URL wird zum Startwert', async () => {
	global.window = { location: { search: '?base=2&depth=5' } };
	try {
		const mod = await import('../../src/lib/configStore.js?withbase');
		assert.equal(get(mod.configStore).base, 2);
		assert.equal(get(mod.configStore).depth, 5);
		// nicht gesetzte Felder behalten ihren Default
		assert.equal(get(mod.configStore).transformMode, 'S');
	} finally {
		delete global.window;
	}
});
