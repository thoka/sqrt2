<script>
	// Control-Panel (TOOLING_SPEC.md Phase 3) - Port des bisherigen statischen
	// #settingsPanel-Inhalts aus sqrt2.html. Schreibt ausschließlich in
	// configStore/playbackStore, liest kompilierte Werte (GLOBAL_TTM) aus
	// compiledStore - kein direkter DOM-Zugriff auf das restliche Tool nötig.
	//
	// "pre"-Felder (base/depth/mode/zoomThreshold/zoomSpeed/compaction/
	// compactionTransition) lösen wie zuvor NUR bei "change" (Blur/Enter) eine
	// Änderung aus, nicht bei jedem Tastendruck - deshalb bewusst kein
	// bind:value (das würde bei <input type=number> auf "input" reagieren),
	// sondern explizite onchange-Handler. Die reinen Laufzeit-/Renderregler
	// (modeAB/autoZoomMinPx/lineWidth/pause/speed) reagieren dagegen live
	// (oninput), genau wie im alten Panel.
	import { configStore, playbackStore, compiledStore } from '../lib/stores.js';
	import { displayStore } from '../lib/displayStore.js';
	import { buildStateParams } from '../lib/urlState.js';
	import { initNetworkSync } from '../lib/syncedStore.js';
	import {
		buildWsUrl,
		buildGuestLink,
		mintHostToken,
		rotatePin,
		revokeToken,
		randomPin,
		createWsRoom,
	} from '../lib/connection.js';

	function onChangeInt(field, fallback) {
		return (e) => {
			let v = parseInt(e.target.value);
			configStore.update((c) => ({ ...c, [field]: Number.isNaN(v) ? fallback : v }));
		};
	}
	function onInputFloat(field, fallback) {
		return (e) => {
			let v = parseFloat(e.target.value);
			configStore.update((c) => ({ ...c, [field]: Number.isNaN(v) ? fallback : v }));
		};
	}
	function onChangeFloat(field, fallback) {
		return onInputFloat(field, fallback);
	}
	function onChangeChecked(field) {
		return (e) => configStore.update((c) => ({ ...c, [field]: e.target.checked }));
	}
	function onChangeValue(field) {
		return (e) => configStore.update((c) => ({ ...c, [field]: e.target.value }));
	}

	// Tick-Eingabe: alternative Zeitachse (Vergleich mit Test-Tool, siehe
	// README Abschnitt 5). Wird nur live nachgeführt, solange das Feld nicht
	// fokussiert ist (der Nutzer also nicht gerade selbst tippt) - $effect
	// statt bind:value, weil der angezeigte Wert (Tick) aus playbackStore.time
	// ABGELEITET ist, nicht selbst der Store-Wert.
	let tickEl = $state(undefined);
	let tickFocused = $state(false);
	$effect(() => {
		let ttm = $compiledStore.GLOBAL_TTM;
		let t = $playbackStore.time;
		if (ttm && tickEl && !tickFocused) tickEl.value = Math.round(ttm.timeToTick(t));
	});
	function onTickChange(e) {
		let ttm = $compiledStore.GLOBAL_TTM;
		if (!ttm) return;
		let tick = Math.max(0, Math.min(ttm.maxTick, Math.round(parseFloat(e.target.value) || 0)));
		e.target.value = tick;
		playbackStore.update((p) => ({ ...p, time: ttm.tickToTime(tick) }));
	}

	let urlCopied = $state(false);
	let paramsCopied = $state(false);
	function copyUrl() {
		let url =
			location.origin +
			location.pathname +
			'?' +
			buildStateParams($configStore, $playbackStore).toString();
		navigator.clipboard.writeText(url).then(() => {
			urlCopied = true;
			setTimeout(() => {
				urlCopied = false;
			}, 1200);
		});
	}
	function copyParams() {
		navigator.clipboard
			.writeText(buildStateParams($configStore, $playbackStore).toString())
			.then(() => {
				paramsCopied = true;
				setTimeout(() => {
					paramsCopied = false;
				}, 1200);
			});
	}

	// === Fernsteuerung / Cross-Device (Connection-Service, Spec §12 3/4) ===
	// Das Exponat (Haupttool) startet eine Sitzung: mintet ein Join-Token
	// beim Relay, verbindet sich als Host via WebSocket und zeigt Gästen
	// einen QR-Code (Link zur Svelte-Fernsteuerung) sowie die PIN.
	const LS_RELAY = 'sqrt2.relayUrl';
	const LS_APIKEY = 'sqrt2.apiKey';

	let relayUrl = $state(localStorage.getItem(LS_RELAY) ?? 'http://localhost:8080');
	let apiKey = $state(localStorage.getItem(LS_APIKEY) ?? '');
	let seats = $state(4);
	let pinInput = $state('');
	let session = $state(null); // { token, wsUrl, pin, seats, expiresAt, guestLink, room }
	let connStatus = $state('idle');
	let guestCount = $state(0);
	let sessionError = $state('');
	let qrCanvas = $state(null);
	let linkCopied = $state(false);

	function persistSettings() {
		localStorage.setItem(LS_RELAY, relayUrl);
		localStorage.setItem(LS_APIKEY, apiKey);
	}

	// Relativer Pfad zur Fernsteuerung (berücksichtigt base: '/sqrt2/').
	function remoteControlPath() {
		return new URL('remote-control.html', location.href).pathname;
	}

	async function renderQr(text) {
		if (!qrCanvas) return;
		const QRCode = (await import('qrcode')).default;
		await QRCode.toCanvas(qrCanvas, text, { width: 200, margin: 1 });
	}

	// QR erst zeichnen, sobald der Canvas im DOM ist (er liegt im Session-
	// Zweig, der beim Klick noch nicht gemountet war - direktes renderQr im
	// startSession traf einen noch nicht existierenden Canvas). $effect läuft
	// nach dem DOM-Update, wenn qrCanvas gebunden ist.
	$effect(() => {
		if (session && qrCanvas) renderQr(session.guestLink);
	});

	async function startSession() {
		sessionError = '';
		persistSettings();
		const pin = pinInput.trim() === '' ? null : pinInput.trim();
		try {
			const minted = await mintHostToken({ baseUrl: relayUrl, apiKey, seats, pin, label: 'sqrt2' });
			const hostWs = buildWsUrl(minted.wsUrl, {
				token: minted.token,
				role: 'host',
				pin: minted.pin,
			});
			const room = createWsRoom({
				url: hostWs,
				onStatus: (s, detail) => {
					connStatus = s;
					if ((s === 'presence' || s === 'joined') && detail?.occupied != null) {
						guestCount = detail.occupied;
					}
					if (s === 'closed') connStatus = 'closed';
				},
			});
			initNetworkSync(room);
			const guestLink = buildGuestLink({
				pageOrigin: location.origin,
				pagePath: remoteControlPath(),
				wsUrl: minted.wsUrl,
				token: minted.token,
				pin: minted.pin,
			});
			session = { ...minted, guestLink, room };
		} catch (e) {
			console.error('[Fernsteuerung] Sitzung starten fehlgeschlagen:', e);
			sessionError = String(e?.message ?? e);
		}
	}

	async function rotateSessionPin() {
		if (!session) return;
		const pin = randomPin(4);
		try {
			await rotatePin({ baseUrl: relayUrl, apiKey, token: session.token, pin });
			const guestLink = buildGuestLink({
				pageOrigin: location.origin,
				pagePath: remoteControlPath(),
				wsUrl: session.wsUrl,
				token: session.token,
				pin,
			});
			session = { ...session, pin, guestLink };
		} catch (e) {
			console.error('[Fernsteuerung] PIN-Rotation fehlgeschlagen:', e);
			sessionError = String(e?.message ?? e);
		}
	}

	async function endSession() {
		if (session?.room) session.room.close();
		if (session?.token) {
			try {
				await revokeToken({ baseUrl: relayUrl, apiKey, token: session.token });
			} catch {
				/* ignore revoke failure */
			}
		}
		session = null;
		guestCount = 0;
		connStatus = 'idle';
	}

	function copyGuestLink() {
		if (!session) return;
		navigator.clipboard.writeText(session.guestLink).then(() => {
			linkCopied = true;
			setTimeout(() => {
				linkCopied = false;
			}, 1200);
		});
	}
</script>

<div style="font-weight: bold; margin-bottom: 5px; color: #3b82f6;">System-Compiler</div>
<div class="control-row">
	<label class="control-group"
		>Basis (b)
		<input
			type="number"
			min="2"
			max="16"
			value={$configStore.base}
			onchange={onChangeInt('base', $configStore.base)}
		/>
	</label>
	<label class="control-group"
		>{'Tiefe ($n_{max}$)'}
		<input
			type="number"
			min="1"
			max="100"
			value={$configStore.depth}
			onchange={onChangeInt('depth', $configStore.depth)}
		/>
	</label>
</div>
{#if $configStore.depth > 5}
	<div class="warning">Tiefe &gt; 5 kann Leistung beeinträchtigen.</div>
{/if}

<label class="control-group" style="margin-top: 5px;"
	>Transformation (Flug-Modus)
	<select value={$configStore.transformMode} onchange={onChangeValue('transformMode')}>
		<option value="S">S: Strecken (Morphing)</option>
		<option value="Z">Z: Zerschneiden (Montessori) - Rück-Verschmelzung noch buggy</option>
	</select>
</label>

<hr style="border: 1px solid #334155; margin: 10px 0;" />

<label class="control-group"
	>Tick (Vergleich mit Test-Tool) — {$compiledStore.GLOBAL_TTM
		? $compiledStore.GLOBAL_TTM.timeToTick($playbackStore.time).toFixed(2)
		: 0} / {$compiledStore.GLOBAL_TTM ? $compiledStore.GLOBAL_TTM.maxTick : 0}
	<input
		bind:this={tickEl}
		type="number"
		min="0"
		step="1"
		value="0"
		onfocus={() => {
			tickFocused = true;
		}}
		onblur={() => {
			tickFocused = false;
		}}
		onchange={onTickChange}
	/>
</label>

<div class="control-group" style="margin-top:10px;">
	<label class="control-group"
		>Modus B (Hypothetische Basis $b \to 1$)
		<div class="slider-with-marker">
			<input
				type="range"
				min="0"
				max="1"
				step="0.01"
				value={$configStore.modeAB}
				oninput={onInputFloat('modeAB', 0)}
			/>
			<div class="auto-zoom-marker" id="autoZoomMarker" title="Auto-Zoom-Mindestwert"></div>
		</div>
	</label>
	<div class="auto-zoom-note" id="autoZoomNote">
		Auto-Zoom aktiv - übersteuert den Regler nach oben
	</div>
</div>
<label class="control-group" style="margin-top:6px;"
	>Auto-Zoom: Mindestbreite feinste Stelle (Pixel, 0 = aus)
	<input
		type="number"
		min="0"
		max="200"
		step="1"
		value={$configStore.autoZoomMinPx}
		oninput={onInputFloat('autoZoomMinPx', 0)}
	/>
</label>

<div class="control-group" style="margin-top:10px;">
	<div>
		Bank-Zoom (automatisch, reale Basis) — <span class="zoom-readout" id="bankZoomLabel">1,0×</span>
	</div>
	<div style="margin-top:-4px;">
		Restfläche der Bank — <span class="zoom-readout" id="bankAreaLabel">100%</span>
	</div>
</div>
<label class="control-group" style="margin-top:6px;"
	>Zoom-Schwellwert (Potenzen ignorieren)
	<input
		type="number"
		min="0"
		max="10"
		step="1"
		value={$configStore.bankZoomThresholdPowers}
		onchange={onChangeInt('bankZoomThresholdPowers', $configStore.bankZoomThresholdPowers)}
	/>
</label>
<label class="control-group" style="margin-top:6px;"
	>Bank-/Kompaktierungs-Zoom: Trägheit (kleiner = schneller)
	<input
		type="number"
		min="0.002"
		max="0.08"
		step="0.001"
		value={$configStore.zoomSpeedCoef}
		onchange={onChangeFloat('zoomSpeedCoef', $configStore.zoomSpeedCoef)}
	/>
</label>
<label
	class="control-group"
	style="margin-top:6px; flex-direction: row; align-items: center; gap: 8px;"
>
	<input
		type="checkbox"
		style="width: auto;"
		checked={$configStore.compactionEnabled}
		onchange={onChangeChecked('compactionEnabled')}
	/>
	Kompaktierung ("Zeilen/Spalten ausblenden") statt Bank-Zoom
</label>
<label class="control-group" style="margin-top:6px;"
	>Kompaktierung: Übergangsdauer (Ticks)
	<input
		type="number"
		min="0"
		max="30"
		step="1"
		value={$configStore.compactionTransitionTicks}
		onchange={onChangeInt('compactionTransitionTicks', $configStore.compactionTransitionTicks)}
	/>
</label>

<hr style="border: 1px solid #334155; margin: 10px 0;" />

<label class="control-group" style="margin-top:6px;"
	>Linienbreite (dicker = weniger Flirren, kaum Performance-Kosten) — <span class="zoom-readout"
		>{$configStore.lineWidth.toLocaleString('de-DE', {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1,
		})}px</span
	>
	<input
		type="range"
		min="0"
		max="4"
		step="0.1"
		value={$configStore.lineWidth}
		oninput={onInputFloat('lineWidth', 0.3)}
	/>
</label>

<hr style="border: 1px solid #334155; margin: 10px 0;" />

<label class="control-group"
	>Wiedergabe: Wartezeit an Anfang &amp; Ende (Sekunden)
	<input
		type="number"
		min="0"
		max="10"
		step="0.1"
		value={$configStore.pauseDuration}
		oninput={onInputFloat('pauseDuration', 1.5)}
	/>
</label>
<label class="control-group"
	>Wiedergabe: Geschwindigkeit (Multiplikator)
	<input
		type="number"
		min="0.1"
		max="20"
		step="0.1"
		value={$configStore.playSpeed}
		oninput={onInputFloat('playSpeed', 2.0)}
	/>
</label>

<hr style="border: 1px solid #334155; margin: 10px 0;" />

<label class="control-group" style="margin-top:6px;"
	>Rest-Anzeige (austauschbares Widget)
	<select
		value={$displayStore.restWidget}
		onchange={(e) => displayStore.update((d) => ({ ...d, restWidget: e.target.value }))}
	>
		<option value="bars">Balken (vertikal)</option>
		<option value="grid">Grid (4×4, horizontal)</option>
	</select>
</label>

<hr style="border: 1px solid #334155; margin: 10px 0;" />

<div class="control-group">
	<div>Aktuellen Zustand teilen (kopiert in die Zwischenablage)</div>
	<div class="control-row">
		<button type="button" class="settings-btn" class:copied={urlCopied} onclick={copyUrl}
			>{urlCopied ? 'Kopiert ✓' : 'Als URL kopieren'}</button
		>
		<button type="button" class="settings-btn" class:copied={paramsCopied} onclick={copyParams}
			>{paramsCopied ? 'Kopiert ✓' : 'Nur Parameter kopieren'}</button
		>
	</div>

	<hr style="border: 1px solid #334155; margin: 10px 0;" />

	<div class="control-group">
		<div style="font-weight: bold; color: #3b82f6;">Fernsteuerung (Handy via QR)</div>
		{#if !session}
			<label class="control-group" style="margin-top:5px;"
				>Relay-URL (des Connection-Service)
				<input type="text" bind:value={relayUrl} placeholder="http://host:8080" />
			</label>
			<label class="control-group" style="margin-top:5px;"
				>API-Key (Exponat)
				<input type="text" bind:value={apiKey} placeholder="Relay-API_KEY" />
			</label>
			<div class="control-row" style="margin-top:5px;">
				<label class="control-group"
					>Plätze (Seats)
					<input type="number" min="1" max="999" bind:value={seats} />
				</label>
				<label class="control-group"
					>PIN (optional)
					<input type="text" bind:value={pinInput} placeholder="leer = keine PIN" />
				</label>
			</div>
			<button type="button" class="settings-btn" onclick={startSession}>Sitzung starten</button>
			{#if sessionError}
				<div class="error-msg">{sessionError}</div>
			{/if}
		{:else}
			<div class="control-row" style="align-items:center; gap:14px; margin-top:5px;">
				<canvas bind:this={qrCanvas} width="200" height="200"></canvas>
				<div class="control-group" style="gap:6px;">
					<div>
						Status:
						<span class="zoom-readout">{connStatus}</span>
					</div>
					<div>
						Gäste verbunden: <span class="zoom-readout">{guestCount}</span>
					</div>
					{#if session.pin}
						<div>
							PIN: <span class="zoom-readout" style="font-size:1.3rem; letter-spacing:2px;"
								>{session.pin}</span
							>
						</div>
					{:else}
						<div class="muted-note">Keine PIN - Gäste joinen ohne Code.</div>
					{/if}
					<button type="button" class="settings-btn" onclick={copyGuestLink}
						>{linkCopied ? 'Kopiert ✓' : 'Link kopieren'}</button
					>
					<button type="button" class="settings-btn" onclick={rotateSessionPin}>PIN rotieren</button
					>
					<button type="button" class="settings-btn" onclick={endSession}>Beenden</button>
				</div>
			</div>
			<div class="muted-note" style="margin-top:6px; word-break:break-all;">
				Gast-Link: {session.guestLink}
			</div>
		{/if}
	</div>
</div>
