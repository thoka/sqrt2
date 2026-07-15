import { mount, unmount, flushSync } from 'svelte';
import { expect, test } from 'vitest';
import App from './App.svelte';

test('App.svelte mounts and reacts to clicks (Svelte-Tooling Phase 0 Smoke-Test)', () => {
  const app = mount(App, { target: document.body });

  expect(document.body.innerHTML).toContain('Svelte-Setup OK');
  expect(document.body.innerHTML).toContain('Klicks: 0');

  document.querySelector('button')?.click();
  flushSync();

  expect(document.body.innerHTML).toContain('Klicks: 1');

  unmount(app);
});
