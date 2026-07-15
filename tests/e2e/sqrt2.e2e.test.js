import { test, expect } from '@playwright/test';

// Smoke-Test fuer das Haupttool (dist/sqrt2.html). Deckt die Luecke, die in
// der alten Sandbox ohne Browser offen blieb: prueft, dass die Svelte-
// Komponenten tatsaechlich mounten und das Canvas-Rendering greift.
test('Haupttool: Mounts + Canvas + Rest-Widget + Steuerung', async ({ page }) => {
  await page.goto('/');

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
  await page.goto('/');
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

// Nach der Initialisierung muessen im Canvas genau die zwei weissen Haupt-
// Quadrate sichtbar sein: das Ziel-Quadrat (sqrt2) links und das
// Einheits-Quadrat der Bank rechts. Erkennung ueber zusammenhängende helle
// (weisse) Pixel-Komponenten - so schlaegt der Test auch bei dem
// "kein Canvas zu sehen"-Bug (Canvas-Variable undefined -> leeres 300x150
// Canvas) fehl.
test('Canvas zeigt zwei weisse Quadrate nach Initialisierung', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#canvasMount canvas')).toBeVisible({ timeout: 10000 });

  // Rendering braucht einen Frame; Initialzustand (u_time=0) erwartet.
  await page.waitForTimeout(500);

  const squares = await page.evaluate(() => {
    const c = document.querySelector('#canvasMount canvas');
    if (!c) return { error: 'no canvas' };
    // Canvas muss die echte Viewport-Groesse haben (Port-Bug liess es bei
    // 300x150 Default).
    if (c.width < 400 || c.height < 400) return { error: 'canvas not sized', w: c.width, h: c.height };
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
    const seen = new Uint8Array(w * h);
    const stack = [];
    const comps = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (seen[idx]) continue;
        const i = idx * 4;
        const a = data[i + 3], lp = lum(data[i], data[i + 1], data[i + 2]);
        if (a > 0 && lp > 180) {
          let minX = x, minY = y, maxX = x, maxY = y, cnt = 0;
          stack.push(idx); seen[idx] = 1;
          while (stack.length) {
            const cur = stack.pop();
            const cy = Math.floor(cur / w), cx = cur % w;
            cnt++;
            if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
            const ns = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
            for (const [nx, ny] of ns) {
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const nidx = ny * w + nx;
              if (seen[nidx]) continue;
              const ni = nidx * 4;
              if (data[ni + 3] > 0 && lum(data[ni], data[ni + 1], data[ni + 2]) > 180) {
                seen[nidx] = 1; stack.push(nidx);
              }
            }
          }
          const bw = maxX - minX + 1, bh = maxY - minY + 1;
          comps.push({ minX, minY, maxX, maxY, w: bw, h: bh, cnt, aspect: bw / bh, fill: cnt / (bw * bh) });
        }
      }
    }
    // "Quadrat": grob quadratisch (0.6..1.6), mind. 120px Kantenlaenge UND
    // gefuellt (fill > 0.5). Die schwachen Rahmen-Strokes (alpha 0.1) erfuellen
    // das Aspekt-/Groessenkriterium, sind aber nur duenne Umrisse (fill ~0) und
    // werden so ausgeblendet.
    const sq = comps.filter((o) => o.aspect > 0.6 && o.aspect < 1.6 && o.w >= 120 && o.h >= 120 && o.fill > 0.5);
    return { total: comps.length, squares: sq.length, sq };
  });

  expect(squares.error, JSON.stringify(squares)).toBeUndefined();
  expect(squares.squares, `erwartet 2 weisse Quadrate, gefunden ${JSON.stringify(squares.sq)}`).toBe(2);
});

// Playback-Leiste (TOOLING_SPEC.md Phase 3): Play-Button VOR der Timeline,
// Slider dehnt sich ueber die verbleibende Breite. Regressionsschutz fuer
// den Bug, bei dem #playbackBarMount kein Flex-Container war und Button +
// Slider/Readout untereinander stapelten.
test('PlaybackBar: Play-Button vor Slider, Slider spannnt Breite', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#playbackBarMount')).toBeVisible();

  const b = await page.evaluate(() => {
    const bb = document.getElementById('bottomBar').getBoundingClientRect();
    const play = document.getElementById('playBtn').getBoundingClientRect();
    const slider = document.getElementById('timeSlider').getBoundingClientRect();
    const readout = document.getElementById('timeReadout').getBoundingClientRect();
    return {
      barW: bb.width,
      playX: play.x, sliderX: slider.x, sliderW: slider.width, sliderR: slider.right,
      readoutX: readout.x,
    };
  });

  // Play-Button liegt vor dem Slider, Readout nach dem Slider.
  expect(b.playX).toBeLessThan(b.sliderX);
  expect(b.sliderX).toBeLessThan(b.readoutX);
  // Slider fuellt den Hauptteil der Leiste aus (nicht nur Auto-Breite).
  expect(b.sliderW).toBeGreaterThan(b.barW * 0.5);
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
