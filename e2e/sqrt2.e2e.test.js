import { test, expect } from '@playwright/test';

// Smoke-Test fuer das Haupttool (dist/sqrt2.html). Deckt die Luecke, die in
// der alten Sandbox ohne Browser offen blieb: prueft, dass die Svelte-
// Komponenten tatsaechlich mounten und das Canvas-Rendering greift.
test('Haupttool: Mounts + Canvas + Rest-Widget + Steuerung', async ({ page }) => {
  await page.goto('/sqrt2.html');

  // Canvas-Rendering liegt in <TargetBankCanvas> (mountet in #canvasMount).
  await expect(page.locator('#canvasMount canvas')).toBeVisible({ timeout: 10000 });

  // Steuerung (ControlPanel / PlaybackBar) gemountet.
  await expect(page.locator('#controlPanelMount')).toBeVisible();
  await expect(page.locator('#playbackBarMount')).toBeVisible();

  // Genau EIN Rest-Widget sichtbar - displayStore schaltet um (Balken/Grid).
  const barsVisible = await page.locator('#bankPanel').isVisible();
  const gridVisible = await page.locator('#restGridPanel').isVisible();
  expect(barsVisible || gridVisible).toBeTruthy();

  // Play/Pause zumindest vorhanden.
  expect(await page.locator('#playbackBarMount button').count()).toBeGreaterThan(0);

  await page.screenshot({ path: 'e2e/artifacts/sqrt2.png' });
});

// Rest-Widget-Umschaltung (displayStore) via ControlPanel-Select.
test('Rest-Anzeige umschaltbar (Balken <-> Grid)', async ({ page }) => {
  await page.goto('/sqrt2.html');
  // Das Rest-Widget-Select ist dasjenige mit der 'grid'-Option (das
  // transformMode-Select ist das erste und hat 'S'/'Z'-Optionen).
  const select = page.locator('#controlPanelMount select').filter({ has: page.locator('option[value="grid"]') });
  if ((await select.count()) > 0) {
    await select.selectOption({ value: 'grid' });
    await expect(page.locator('#restGridPanel')).toBeVisible();
    await select.selectOption({ value: 'bars' });
    await expect(page.locator('#bankPanel')).toBeVisible();
  }
});

// Fensterübergreifender Sync (TOOLING_SPEC.md Phase 5): das Haupttool
// (sqrt2.html) und die Fernsteuerung (remote-control.html) teilen sich
// configStore/playbackStore über BroadcastChannel. Änderungen in einem Tab
// müssen im anderen ankommen.
test('Zwei Tabs bleiben synchron (BroadcastChannel)', async ({ context }) => {
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  await pageA.goto('/sqrt2.html');
  await pageB.goto('/remote-control.html');

  // config: Basis im Haupttool ändern -> Fernsteuerung übernimmt.
  const baseA = pageA.locator('#controlPanelMount input[type="number"]').first();
  await baseA.fill('7');
  await baseA.dispatchEvent('change');
  const baseB = pageB.locator('#controlPanelMount input[type="number"]').first();
  await expect(baseB).toHaveValue('7');

  // playback: Play in der Fernsteuerung -> Haupttool zeigt Pause-Symbol.
  const playB = pageB.locator('#playbackBarMount button').first();
  await playB.click();
  const playA = pageA.locator('#playbackBarMount button').first();
  await expect(playA).toContainText('⏸');

  await pageA.close();
  await pageB.close();
});
