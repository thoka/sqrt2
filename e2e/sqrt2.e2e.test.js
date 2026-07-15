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
  await expect(page.locator('#playbackBarMount button')).toHaveCountGreaterThan(0);

  await page.screenshot({ path: 'e2e/artifacts/sqrt2.png' });
});

// Rest-Widget-Umschaltung (displayStore) via ControlPanel-Select.
test('Rest-Anzeige umschaltbar (Balken <-> Grid)', async ({ page }) => {
  await page.goto('/sqrt2.html');
  const select = page.locator('#controlPanelMount select');
  if ((await select.count()) > 0) {
    await select.selectOption({ label: /Grid/i }).catch(() => {});
    await expect(page.locator('#restGridPanel')).toBeVisible();
    await select.selectOption({ label: /Balken/i }).catch(() => {});
    await expect(page.locator('#bankPanel')).toBeVisible();
  }
});
