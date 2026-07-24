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
	const select = page
		.locator('#controlPanelMount select')
		.filter({ has: page.locator('option[value="grid"]') });
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

	// Auf die beiden gefuellten weissen Quadrate warten, statt auf eine
	// starre Verzoegerung - der async Compile (Worker) braucht beim
	// Cold-Load etwas Laengeres, bis das Modell tatsaechlich gerendert ist.
	await page.waitForFunction(
		() => {
			const c = document.querySelector('#canvasMount canvas');
			if (!c) return false;
			if (c.width < 400 || c.height < 400) return false;
			const ctx = c.getContext('2d');
			const w = c.width,
				h = c.height;
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
					const a = data[i + 3],
						lp = lum(data[i], data[i + 1], data[i + 2]);
					if (a > 0 && lp > 180) {
						let minX = x,
							minY = y,
							maxX = x,
							maxY = y,
							cnt = 0;
						stack.push(idx);
						seen[idx] = 1;
						while (stack.length) {
							const cur = stack.pop();
							const cy = Math.floor(cur / w),
								cx = cur % w;
							cnt++;
							if (cx < minX) minX = cx;
							if (cx > maxX) maxX = cx;
							if (cy < minY) minY = cy;
							if (cy > maxY) maxY = cy;
							const ns = [
								[cx + 1, cy],
								[cx - 1, cy],
								[cx, cy + 1],
								[cx, cy - 1],
							];
							for (const [nx, ny] of ns) {
								if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
								const nidx = ny * w + nx;
								if (seen[nidx]) continue;
								const ni = nidx * 4;
								if (data[ni + 3] > 0 && lum(data[ni], data[ni + 1], data[ni + 2]) > 180) {
									seen[nidx] = 1;
									stack.push(nidx);
								}
							}
						}
						const bw = maxX - minX + 1,
							bh = maxY - minY + 1;
						comps.push({
							w: bw,
							h: bh,
							aspect: bw / bh,
							fill: cnt / (bw * bh),
						});
					}
				}
			}
			const sq = comps.filter(
				(o) => o.aspect > 0.6 && o.aspect < 1.6 && o.w >= 120 && o.h >= 120 && o.fill > 0.5,
			);
			return sq.length === 2;
		},
		{ timeout: 10000 },
	);

	const squares = await page.evaluate(() => {
		const c = document.querySelector('#canvasMount canvas');
		if (!c) return { error: 'no canvas' };
		// Canvas muss die echte Viewport-Groesse haben (Port-Bug liess es bei
		// 300x150 Default).
		if (c.width < 400 || c.height < 400)
			return { error: 'canvas not sized', w: c.width, h: c.height };
		const ctx = c.getContext('2d');
		const w = c.width,
			h = c.height;
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
				const a = data[i + 3],
					lp = lum(data[i], data[i + 1], data[i + 2]);
				if (a > 0 && lp > 180) {
					let minX = x,
						minY = y,
						maxX = x,
						maxY = y,
						cnt = 0;
					stack.push(idx);
					seen[idx] = 1;
					while (stack.length) {
						const cur = stack.pop();
						const cy = Math.floor(cur / w),
							cx = cur % w;
						cnt++;
						if (cx < minX) minX = cx;
						if (cx > maxX) maxX = cx;
						if (cy < minY) minY = cy;
						if (cy > maxY) maxY = cy;
						const ns = [
							[cx + 1, cy],
							[cx - 1, cy],
							[cx, cy + 1],
							[cx, cy - 1],
						];
						for (const [nx, ny] of ns) {
							if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
							const nidx = ny * w + nx;
							if (seen[nidx]) continue;
							const ni = nidx * 4;
							if (data[ni + 3] > 0 && lum(data[ni], data[ni + 1], data[ni + 2]) > 180) {
								seen[nidx] = 1;
								stack.push(nidx);
							}
						}
					}
					const bw = maxX - minX + 1,
						bh = maxY - minY + 1;
					comps.push({
						minX,
						minY,
						maxX,
						maxY,
						w: bw,
						h: bh,
						cnt,
						aspect: bw / bh,
						fill: cnt / (bw * bh),
					});
				}
			}
		}
		// "Quadrat": grob quadratisch (0.6..1.6), mind. 120px Kantenlaenge UND
		// gefuellt (fill > 0.5). Die schwachen Rahmen-Strokes (alpha 0.1) erfuellen
		// das Aspekt-/Groessenkriterium, sind aber nur duenne Umrisse (fill ~0) und
		// werden so ausgeblendet.
		const sq = comps.filter(
			(o) => o.aspect > 0.6 && o.aspect < 1.6 && o.w >= 120 && o.h >= 120 && o.fill > 0.5,
		);
		return { total: comps.length, squares: sq.length, sq };
	});

	expect(squares.error, JSON.stringify(squares)).toBeUndefined();
	expect(
		squares.squares,
		`erwartet 2 weisse Quadrate, gefunden ${JSON.stringify(squares.sq)}`,
	).toBe(2);
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
			playX: play.x,
			sliderX: slider.x,
			sliderW: slider.width,
			sliderR: slider.right,
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
	await pageA.goto('/');
	await pageB.goto('/remote.html');

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

// Routing (vite appType 'mpa'): nur reale .html-Dateien werden
// ausgeliefert, unbekannte/clean-URLs antworten mit 404 - KEIN
// SPA-Fallback, der stumm index.html für alle Pfade serviert.
// Prüft rohe HTTP-Status über das request-Fixture (kein Seiten-Navigation).
test('Routing: / und /remote.html ok, unbekannte Pfade 404', async ({ request, page }) => {
	const main = await request.get('/');
	expect(main.status()).toBe(200);
	await page.goto('/');
	expect(await page.title()).toContain('Area Model');

	const remote = await request.get('/remote.html');
	expect(remote.status()).toBe(200);
	await page.goto('/remote.html');
	expect(await page.title()).toContain('Remote Control');

	// Unbekannter Pfad (clean URL ohne .html) darf NICHT auf index.html
	// umgeleitet werden - das wäre der alte SPA-Fallback-Bug.
	const unknown = await request.get('/control');
	expect(unknown.status()).toBe(404);
});

// INTERFACE-TODO "Korrektur: Geschwindigkeitsregler": im Hauptfenster liegt
// ein schmaler, dezenter Geschwindigkeitsregler rechts VOR dem Bank-Zähler
// (#bankPanel) - nicht die ganze Breite. Er muss betätigbar sein und
// configStore.playSpeed ändern (hier sichtbar im ControlPanel-Readout).
test('Geschwindigkeit: dezenter Regler im Hauptfenster rechts neben der Timeline unten, betätigbar', async ({
	page,
}) => {
	await page.goto('/');
	await page.waitForTimeout(1500);

	const speed = page.locator('#speedControl input[type="range"]');
	await expect(speed).toBeVisible();

	// Position: innerhalb #bottomBar, RECHTS neben der Timeline
	// (#playbackBarMount), ganz unten.
	const geo = await page.evaluate(() => {
		const sc = document.getElementById('speedControl').getBoundingClientRect();
		const bb = document.getElementById('bottomBar').getBoundingClientRect();
		const pb = document.getElementById('playbackBarMount').getBoundingClientRect();
		return {
			speedLeft: sc.left,
			speedRight: sc.right,
			speedTop: sc.top,
			speedBottom: sc.bottom,
			bbTop: bb.top,
			bbBottom: bb.bottom,
			pbRight: pb.right,
			speedW: sc.width,
			winW: window.innerWidth,
		};
	});
	// Regler liegt vertikal INNERHALB der bottomBar (ganz unten).
	expect(geo.speedTop).toBeGreaterThanOrEqual(geo.bbTop - 1);
	expect(geo.speedBottom).toBeLessThanOrEqual(geo.bbBottom + 1);
	// Regler beginnt RECHTS von der Timeline (playbackBarMount).
	expect(geo.speedLeft).toBeGreaterThan(geo.pbRight - 1);
	// Regler nimmt NICHT die ganze Breite ein.
	expect(geo.speedW).toBeLessThan(geo.winW * 0.5);

	// Betätigen: auf Maximum schieben -> playSpeed wird groß (Log-Regler,
	// Mitte = Faktor 1, rechtes Ende ~20×).
	await speed.fill('1');
	await page.waitForTimeout(400);
	const ctrlText = await page.locator('#controlPanelMount').textContent();
	// Das ControlPanel (Grundeinstellungen) zeigt die Geschwindigkeit als "x×"
	// (Dezimaltrennzeichen ist locale-abhängig: "." im Default (en), "," bei de).
	expect(ctrlText).toMatch(/\d{2}[.,]\d×/);
});

// Geschwindigkeit in der Fernsteuerung (/remote.html) ändert die
// Wiedergabegeschwindigkeit im Hauptfenster (Sync via BroadcastChannel),
// analog zum bestehenden Config-Sync-Test.
test('Geschwindigkeit: Fernsteuerung ändert Speed im Hauptfenster (Sync)', async ({ context }) => {
	const pageA = await context.newPage();
	const pageB = await context.newPage();
	await pageA.goto('/');
	await pageB.goto('/remote.html');
	await pageA.waitForTimeout(1500);

	// Speed in der Fernsteuerung auf Maximum schieben (Regler im
	// "Speed"-Label, nicht der Zoom-Regler).
	const remoteSpeed = pageB
		.locator('#controlPanelMount .control-group', { hasText: 'Speed' })
		.locator('input[type="range"]');
	await remoteSpeed.fill('1');
	await pageA.waitForTimeout(800);

	// Hauptfenster-ControlPanel zeigt die geänderte Geschwindigkeit.
	const ctrlText = await pageA.locator('#controlPanelMount').textContent();
	expect(ctrlText).toMatch(/\d{2}[.,]\d×/);

	await pageA.close();
	await pageB.close();
});

// Intro-Screen (TODO.md "Intro-Screen"): kurz sichtbar beim Start, blendet
// sich aus, sobald die Wiedergabe startet (Space) - und blockiert dabei
// selbst keine Klicks/Tastatur (pointer-events: none).
test('Intro-Screen: sichtbar beim Start, verschwindet bei Play', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.intro-overlay')).toBeVisible();
	await expect(page.locator('.intro-settings-hint')).toContainText('Einstellungen');

	await page.keyboard.press(' ');
	await expect(page.locator('.intro-overlay')).not.toBeVisible({ timeout: 2000 });
});

// Achsen-Beschriftung (docs/Beschriftung.md): nutzt echtes, gecachtes
// MathJax statt eines Nachbau-Renderers. Zwei Eigenschaften werden hier
// abgesichert (nicht nur "sieht richtig aus", das prüft AGENTS.md zufolge
// nur ein Mensch/Screenshot-Vergleich):
//  1. Keine Laufzeitfehler, wenn Beschriftung aktiv ist (MathJax lädt +
//     rendert im Hintergrund, Labels erscheinen nachträglich).
//  2. Der schwere MathJax-Renderer-Chunk (@mathjax/src) wird beim ZWEITEN
//     Seitenaufruf NICHT erneut geladen - alle Beschriftungen kommen dann
//     aus dem persistenten IndexedDB-Cache (mathJaxImageCache.js).
test('Beschriftung: MathJax-Renderer lädt einmalig, zweiter Aufruf nutzt den IndexedDB-Cache', async ({
	context,
}) => {
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));

	const firstVisitChunks = [];
	page.on('request', (req) => {
		if (req.url().includes('mathJaxRenderer')) firstVisitChunks.push(req.url());
	});
	await page.goto('/?base=2&depth=4&time=999&play=0&labels=1');
	await page.waitForTimeout(2000);
	expect(errors).toEqual([]);
	expect(firstVisitChunks.length).toBeGreaterThan(0);

	const page2 = await context.newPage();
	const secondVisitChunks = [];
	page2.on('request', (req) => {
		if (req.url().includes('mathJaxRenderer')) secondVisitChunks.push(req.url());
	});
	await page2.goto('/?base=2&depth=4&time=999&play=0&labels=1');
	await page2.waitForTimeout(2000);
	expect(secondVisitChunks.length).toBe(0);

	await page.close();
	await page2.close();
});
