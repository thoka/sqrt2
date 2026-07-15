import { mount, unmount, flushSync, tick } from 'svelte';
import { expect, test } from 'vitest';
import App from './App.svelte';

test('App.svelte mountet die Haupttool-Skeleton (Canvas + Steuerungs-Mounts)', async () => {
  const app = mount(App, { target: document.body });

  // Mount der Kind-Komponenten (in onMount) läuft asynchron als Effect ab -
  // erst nach flushSync() sind Canvas-/Steuerungs-Mounts im DOM.
  await tick();
  flushSync();

  // Skeleton-Elemente vorhanden, in die die Kind-Komponenten mounten.
  expect(document.getElementById('canvasMount')).toBeTruthy();
  expect(document.getElementById('controlPanelMount')).toBeTruthy();
  expect(document.getElementById('playbackBarMount')).toBeTruthy();
  expect(document.getElementById('bankPanelMount')).toBeTruthy();
  expect(document.getElementById('restGridMount')).toBeTruthy();

  // Kind-Komponenten haben gerendert (ControlPanel + PlaybackBar).
  expect(document.getElementById('playbackBarMount').querySelector('button')).toBeTruthy();
  expect(document.getElementById('controlPanelMount').querySelector('input')).toBeTruthy();

  unmount(app);
});
