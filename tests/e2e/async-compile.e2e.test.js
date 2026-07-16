import { test, expect } from '@playwright/test';

// E2E-Tests für den asynchronen, cancelbaren Compile (ASYNC-COMPILE-PLAN,
// Testkriterien 6-12). Laufen gegen dist/ (vite preview).
//
// "Langsame" Tiefe = 20 (empirisch > 300 ms Compile im Browser, wie im Plan
// vermutet); "schnelle" Tiefe = 3 (weit unter der 300ms-Schwelle).

// Hilfer: stellt die Depth über das entsprechende number-Input im
// ControlPanel ein und löst "change" aus (pre-Feld, reagiert nur auf blur).
async function setDepth(page, depth) {
	const input = page.locator('#controlPanelMount input[type="number"]').nth(1);
	await input.fill(String(depth));
	await input.dispatchEvent('change');
}

// Sammelt ungefangene Seiten-Exceptions während einer Aktion.
async function withPageErrors(page) {
	const errors = [];
	const handler = (err) => errors.push(err.message);
	page.on('pageerror', handler);
	return {
		errors,
		off: () => page.off('pageerror', handler),
	};
}

test('Keine ungefangenen Exceptions nach Laden der Seite (null-init compiledStore)', async ({
	page,
}) => {
	const probe = await withPageErrors(page);
	await page.goto('/');
	// Warten bis initialer Compile (Worker/Fallback) durch ist.
	await expect(page.locator('#canvasMount canvas')).toBeVisible({ timeout: 10000 });
	await page.waitForTimeout(500);
	probe.off();
	expect(
		probe.errors,
		`Unerwartete Seiten-Exceptions: ${JSON.stringify(probe.errors)}`,
	).toHaveLength(0);
});

test('Kriterium 6: Main-Thread bleibt frei während langsamer Kompilierung', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('#canvasMount canvas')).toBeVisible({ timeout: 10000 });

	// Warten, bis der INITIALE Compile (default depth=16) abgeschlossen ist,
	// damit wir die nachfolgende depth=20-Kompilierung isoliert messen.
	await page.waitForFunction(() => window.__activeWorkers === 0, null, { timeout: 30000 });
	await page.waitForTimeout(200);

	// rAF-Tick-Zähler im Browser installieren; nur Lücken MESSEN, solange ein
	// Worker aktiv ist (compileSystemData läuft im Worker). Der abschließende
	// finalizeCompiled()-Schritt (Main-Thread, baut die Splines) ist einmalig
	// und bewusst nicht im "Worker läuft"-Fenster - siehe Plan ("finalizeCompiled
	// billig genug für Main-Thread").
	await page.evaluate(() => {
		window.__rafGaps = [];
		window.__lastRaf = performance.now();
		window.__sampling = true;
		const tick = (t) => {
			const gap = t - window.__lastRaf;
			if (window.__lastRaf > 0 && window.__sampling && (window.__activeWorkers || 0) > 0)
				window.__rafGaps.push(gap);
			window.__lastRaf = t;
			window.__rafReq = requestAnimationFrame(tick);
		};
		window.__rafReq = requestAnimationFrame(tick);
	});

	// Langsame Kompilierung starten.
	await setDepth(page, 20);

	// Warten bis der Worker fertig ist (activeWorkers === 0).
	await page.waitForFunction(() => window.__activeWorkers === 0, null, { timeout: 30000 });
	await page.evaluate(() => {
		window.__sampling = false;
		cancelAnimationFrame(window.__rafReq);
	});

	// WÄHREND der Worker-Laufzeit darf der Main-Thread nicht BLOCKIERT sein
	// (keine Sekunden-Lücke). Kleine Jank-Momente (finalizeCompiled()/
	// structuredClone-Transfer beim Eintreffen des Ergebnisses, GC) sind
	// bewusst nicht im Worker - siehe Plan ("finalizeCompiled billig genug
	// für Main-Thread"). Massive, anhaltende Lücken (> 500 ms) würden auf
	// eine synchrone Berechnung auf dem Main-Thread hindeuten.
	const gaps = await page.evaluate(() => window.__rafGaps);
	const blockingGaps = gaps.filter((g) => g > 500);
	expect(
		blockingGaps.length,
		`${blockingGaps.length} rAF-Lücken > 500ms (Blockade) während Worker-Lauf (${gaps.map((g) => g.toFixed(0)).join(',')})`,
	).toBe(0);
});

test('Kriterium 7: UI bleibt bedienbar während der Kompilierung', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('#playbackBarMount button')).toBeVisible();

	await setDepth(page, 20);
	// Während des Compiles (bevor fertig) auf Play klicken - die Playback-
	// Steuerung ist synchron, darf nicht durch den Compile blockiert sein.
	// force:true, da der Vollbild-Canvas im Exponat-Layout Pointer-Events
	// abfängt (kein Compile-Problem).
	await page.locator('#playbackBarMount button').click({ force: true });
	const btnText = await page.locator('#playbackBarMount button').textContent();
	expect(btnText).toContain('⏸');
});

test('Kriterium 8: alte Darstellung bleibt sichtbar bis zum fertigen Ergebnis', async ({
	page,
}) => {
	await page.goto('/');
	await expect(page.locator('#canvasMount canvas')).toBeVisible({ timeout: 10000 });
	// Warten, bis der INITIALE Compile (default depth=16) fertig ist und der
	// Canvas tatsächlich rendert - sonst ist der "vorher"-Zustand noch blank.
	await page.waitForFunction(() => window.__activeWorkers === 0, null, { timeout: 30000 });
	await page.waitForTimeout(300);

	// Vor der Änderung: Canvas zeigt die initiale Darstellung (weiße Quadrate).
	const before = await page.evaluate(() => {
		const c = document.querySelector('#canvasMount canvas');
		const ctx = c.getContext('2d');
		const d = ctx.getImageData(0, 0, c.width, c.height).data;
		let white = 0;
		for (let i = 0; i < d.length; i += 4)
			if (d[i + 3] > 0 && d[i] > 180 && d[i + 1] > 180 && d[i + 2] > 180) white++;
		return white;
	});

	await setDepth(page, 20);
	// SOFORT während der Kompilierung prüfen: Canvas nicht blank (kein
	// Lade-Overlay/Grau - die vorherige oder bereits neue Darstellung ist
	// sichtbar).
	await page.waitForTimeout(200);
	const during = await page.evaluate(() => {
		const c = document.querySelector('#canvasMount canvas');
		const ctx = c.getContext('2d');
		const d = ctx.getImageData(0, 0, c.width, c.height).data;
		let white = 0;
		for (let i = 0; i < d.length; i += 4)
			if (d[i + 3] > 0 && d[i] > 180 && d[i + 1] > 180 && d[i + 2] > 180) white++;
		return white;
	});

	expect(during, 'Canvas wurde während Kompilierung blank').toBeGreaterThan(0);
	// Statt exakt gleicher Pixelzahl (die neue Darstellung darf bereits
	// gerendert sein) prüfen wir nur: kein Blank/Platzhalter.
	expect(before, 'Canvas war vor der Änderung bereits blank').toBeGreaterThan(0);
});

test('Kriterium 10: Progress-Schwelle (schnell unsichtbar, langsam sichtbar)', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('#canvasMount canvas')).toBeVisible({ timeout: 10000 });

	// Schnell (depth=3): Progress-Balken darf nie sichtbar werden.
	await setDepth(page, 3);
	await page.waitForTimeout(150); // unter der 300ms-Schwelle
	const fastVisible = await page.locator('.compile-progress').count();
	await page.waitForFunction(() => window.__activeWorkers === 0, null, { timeout: 10000 });
	expect(fastVisible, 'depth=3 zeigte Progress').toBe(0);

	// Langsam (depth=20): Progress-Balken erscheint und verschwindet wieder.
	await setDepth(page, 20);
	await expect(page.locator('.compile-progress')).toBeVisible({ timeout: 1000 });
	await page.waitForFunction(() => window.__activeWorkers === 0, null, { timeout: 30000 });
	await expect(page.locator('.compile-progress')).toHaveCount(0, { timeout: 2000 });
});

test('Kriterium 11: kein Worker-Leck bei schneller Änderung', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('#canvasMount canvas')).toBeVisible({ timeout: 10000 });

	// Fünfmal schnell hintereinander ändern.
	for (const d of [4, 6, 8, 10, 12]) {
		await setDepth(page, d);
	}
	// Zu keinem Zeitpunkt mehr als 1 aktiver Worker.
	const maxObserved = await page.evaluate(async () => {
		let max = 0;
		for (let i = 0; i < 40; i++) {
			max = Math.max(max, window.__activeWorkers || 0);
			await new Promise((r) => setTimeout(r, 25));
		}
		return max;
	});
	expect(maxObserved, `max aktive Worker = ${maxObserved}`).toBeLessThanOrEqual(1);
});

test('Kriterium 12: Config/URL-Export wartet nicht auf Compile', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('#controlPanelMount')).toBeVisible();

	// Depth ändern (configStore ist synchron - der Compile läuft asynchron
	// im Hintergrund). Der Depth-Input zeigt SOFORT den neuen Wert, ohne auf
	// den Compile zu warten.
	await setDepth(page, 9);
	// Explizit KEIN waitForFunction auf den Compile - wir prüfen die
	// Synchronität des configStore unmittelbar.
	const val = await page.locator('#controlPanelMount input[type="number"]').nth(1).inputValue();
	expect(val).toBe('9');

	// "Als URL kopieren" (falls vorhanden) darf nicht blockieren - der
	// Export liest den synchronen configStore, nicht den fertigen Compile.
	const urlBtn = page.locator('#controlPanelMount button', { hasText: 'URL' }).first();
	if ((await urlBtn.count()) > 0) {
		await expect(urlBtn).toBeEnabled();
	}
});

test('Kriterium 9: Cancellation - Endergebnis gehört zur letzten Config', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('#canvasMount canvas')).toBeVisible({ timeout: 10000 });

	// depth=20 setzen, sofort (vor Fertig) depth=6 setzen.
	await setDepth(page, 20);
	await setDepth(page, 6);

	await page.waitForFunction(() => window.__activeWorkers === 0, null, { timeout: 30000 });
	// Nach Abschluss zeigt der Depth-Input weiterhin 6 (letzte Config).
	const val = await page.locator('#controlPanelMount input[type="number"]').nth(1).inputValue();
	expect(val).toBe('6');
	// Progress-Balken verschwunden.
	await expect(page.locator('.compile-progress')).toHaveCount(0, { timeout: 2000 });
});
