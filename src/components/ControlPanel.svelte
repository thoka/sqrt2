<script>
	// Control-Panel (TOOLING_SPEC.md Phase 3) - Port des bisherigen statischen
	// #settingsPanel-Inhalts aus sqrt2.html. Schreibt ausschließlich in
	// configStore/playbackStore, liest kompilierte Werte (GLOBAL_TTM) aus
	// compiledStore - kein direkter DOM-Zugriff auf das restliche Tool nötig.
	//
	// INTERFACE-TODO Phase 1: Einstellungen in Tabs gegliedert
	// (Grundeinstellungen / Animation / Admin / Remote-Connect). Die
	// Fernsteuerung (RemoteControl.svelte) zeigt per `visibleTabs`-Prop nur
	// "Grundeinstellungen"; das Exponat-Overlay und die künftige /admin-Route
	// zeigen alle Tabs (gleiche Komponente, eigener Host).
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

	// Welche Tabs sichtbar sind. Default: alle. Die Fernsteuerung übergibt
	// nur ['Grundeinstellungen'] (Besucher-QR zeigt nur die Grundeinstellungen).
	const ALL_TABS = ['Grundeinstellungen', 'Animation', 'Admin', 'Remote-Connect'];
	let { visibleTabs = ALL_TABS } = $props();

	let activeTab = $state('Grundeinstellungen');
	// Wenn der erlaubte Tab-Satz wechselt (z.B. Remote ohne Admin), sicher-
	// stellen, dass ein sichtbarer Tab aktiv ist.
	$effect(() => {
		if (!visibleTabs.includes(activeTab)) {
			activeTab = visibleTabs[0] ?? 'Grundeinstellungen';
		}
	});
	const showTab = (t) => visibleTabs.includes(t);

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

	// Logarithmischer Schieberegler fuer die Auto-Zoom-Mindestpixelgroesse
	// (autoZoomMinPx): Bereich 0.001 .. 100 px. Position t in [0,1]
	// <-> Wert v = MINPX_LO * (MINPX_HI/MINPX_LO)^t.
	// Ganz nach links (v < 1.5 * MINPX_LO) wird effektiv auf 0 gesetzt,
	// was den Auto-Zoom deaktiviert (AUTO_ZOOM_MIN_PX <= 0 im Canvas).
	const MINPX_LO = 0.001;
	const MINPX_HI = 100;
	const MINPX_SPAN = Math.log(MINPX_HI / MINPX_LO);
	const MINPX_EFF_ZERO = 1.5 * MINPX_LO;
	// Position aus dem Store-Wert abgeleitet (kein $effect + bind:value,
	// das eine Endlosschleife ausloest): t = log(v/LO)/SPAN.
	const minPxPos = $derived(
		Math.max(
			0,
			Math.min(1, Math.log(Math.max(MINPX_LO, $configStore.autoZoomMinPx) / MINPX_LO) / MINPX_SPAN),
		),
	);
	function onMinPxInput(e) {
		let t = parseFloat(e.target.value);
		let v = MINPX_LO * Math.exp(t * MINPX_SPAN);
		if (v < MINPX_EFF_ZERO) v = 0;
		configStore.update((c) => ({ ...c, autoZoomMinPx: v }));
	}
	function onChangeChecked(field) {
		return (e) => configStore.update((c) => ({ ...c, [field]: e.target.checked }));
	}
	function onChangeValue(field) {
		return (e) => configStore.update((c) => ({ ...c, [field]: e.target.value }));
	}

	// Zoom-Schwellwert: in der UI "Zoom-Schwellwert" (immer Basis 10), im
	// Store als Potenzen zur echten Basis. Umrechnung 10/base (siehe
	// INTERFACE-TODO Admin).
	const base10Threshold = $derived(
		Math.round(($configStore.bankZoomThresholdPowers * 10) / $configStore.base),
	);
	function onThreshold10Change(e) {
		let v10 = parseInt(e.target.value);
		if (Number.isNaN(v10)) v10 = 0;
		configStore.update((c) => ({ ...c, bankZoomThresholdPowers: Math.round((v10 * c.base) / 10) }));
	}

	// Tick-Eingabe: alternative Zeitachse (Vergleich mit Test-Tool, siehe
	// README Abschnitt 5). Wird nur live nachgeführt, solange das Feld nicht
	// fokussiert ist (der Nutzer also nicht gerade selbst tippt) - $effect
	// statt bind:value, weil der angezeigte Wert (Tick) aus playbackStore.time
	// ABGELEITET ist, nicht selbst der Store-Wert.
	let tickEl = $state(undefined);
	let tickFocused = $state(false);
	$effect(() => {
		let ttm = $compiledStore?.GLOBAL_TTM;
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
	const LS_RELAY = 'sqrt2.relayUrl';
	const LS_APIKEY = 'sqrt2.apiKey';

	let relayUrl = $state(
		typeof localStorage !== 'undefined'
			? (localStorage.getItem(LS_RELAY) ?? location.origin)
			: location.origin,
	);
	let apiKey = $state(
		typeof localStorage !== 'undefined' ? (localStorage.getItem(LS_APIKEY) ?? '') : '',
	);
	let seats = $state(4);
	let pinInput = $state('');
	let session = $state(null);
	let connStatus = $state('idle');
	let guestCount = $state(0);
	let sessionError = $state('');
	let qrCanvas = $state(null);
	let linkCopied = $state(false);

	function persistSettings() {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(LS_RELAY, relayUrl);
			localStorage.setItem(LS_APIKEY, apiKey);
		}
	}

	function remoteControlPath() {
		return new URL('remote.html', location.href).pathname;
	}

	async function renderQr(text) {
		if (!qrCanvas) return;
		const QRCode = (await import('qrcode')).default;
		await QRCode.toCanvas(qrCanvas, text, { width: 200, margin: 1 });
	}

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

<div class="tabs" role="tablist">
	{#each ALL_TABS as tab}
		{#if showTab(tab)}
			<button
				role="tab"
				class="tab-btn"
				class:active={activeTab === tab}
				onclick={() => (activeTab = tab)}>{tab}</button
			>
		{/if}
	{/each}
</div>

<div class="tab-body">
	{#if showTab('Grundeinstellungen') && activeTab === 'Grundeinstellungen'}
		<div class="control-row">
			<label class="control-group"
				>Basis
				<input
					type="number"
					min="2"
					max="16"
					value={$configStore.base}
					onchange={onChangeInt('base', $configStore.base)}
				/>
			</label>
			<label class="control-group"
				>Tiefe
				<input
					type="number"
					min="1"
					max="100"
					value={$configStore.depth}
					onchange={onChangeInt('depth', $configStore.depth)}
				/>
			</label>
		</div>

		<label class="control-group" style="margin-top:6px;"
			>Auto-Zoom: Mindestpixelgröße
			<input type="range" min="0" max="1" step="0.001" value={minPxPos} oninput={onMinPxInput} />
			<span class="zoom-readout"
				>{$configStore.autoZoomMinPx.toLocaleString('de-DE', {
					minimumFractionDigits: 3,
					maximumFractionDigits: 3,
				})} px</span
			>
		</label>

		<label class="control-group" style="margin-top: 5px;"
			>Zoom
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

		<label
			class="control-group"
			style="margin-top:10px; flex-direction: row; align-items: center; gap: 8px;"
		>
			<input
				type="checkbox"
				style="width: auto;"
				checked={$configStore.showLabels}
				onchange={onChangeChecked('showLabels')}
			/>
			Beschriftung an/aus
		</label>

		<div class="control-group" style="margin-top:10px;">
			<div>
				Bank-Zoom (automatisch, reale Basis) — <span class="zoom-readout" id="bankZoomLabel"
					>1,0×</span
				>
			</div>
			<div style="margin-top:-4px;">
				Restfläche der Bank — <span class="zoom-readout" id="bankAreaLabel">100%</span>
			</div>
		</div>
	{/if}

	{#if showTab('Animation') && activeTab === 'Animation'}
		<label class="control-group" style="margin-top: 5px;"
			>Flug-Modus
			<select value={$configStore.transformMode} onchange={onChangeValue('transformMode')}>
				<option value="S">S: Strecken (Morphing)</option>
				<option value="Z">Z: Zerschneiden (Montessori) - Rück-Verschmelzung noch buggy</option>
			</select>
		</label>

		<label class="control-group" style="margin-top:6px;"
			>Zoom-Trägheit (kleiner = schneller)
			<input
				type="number"
				min="0.002"
				max="0.08"
				step="0.001"
				value={$configStore.zoomSpeedCoef}
				onchange={onChangeFloat('zoomSpeedCoef', $configStore.zoomSpeedCoef)}
			/>
		</label>

		<label class="control-group" style="margin-top:6px;"
			>Linienbreite
			<span class="zoom-readout"
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

		<label class="control-group" style="margin-top:6px;"
			>Wartezeit (Anfang/Ende) (Sekunden)
			<input
				type="number"
				min="0"
				max="10"
				step="0.1"
				value={$configStore.pauseDuration}
				oninput={onInputFloat('pauseDuration', 1.5)}
			/>
		</label>

		<label class="control-group" style="margin-top:6px;">
			<input
				type="checkbox"
				checked={$configStore.flightRotation}
				onchange={onChangeChecked('flightRotation')}
			/>
			Pieces drehen
		</label>
		<label class="control-group" style="margin-top:6px;"
			>Fliegende Teile: Transparenz
			<input
				type="range"
				min="0"
				max="1"
				step="0.01"
				value={$configStore.flyingAlpha}
				oninput={onInputFloat('flyingAlpha', 0.59)}
			/>
			<span class="zoom-readout">{Math.round($configStore.flyingAlpha * 100)} %</span>
		</label>
		<label class="control-group" style="margin-top:6px;"
			>Flug-Animation aus ab Geschwindigkeit
			<input
				type="number"
				min="0.1"
				step="0.1"
				value={$configStore.flightAnimSpeedThreshold}
				onchange={onChangeFloat('flightAnimSpeedThreshold', 3.0)}
			/>
		</label>

		<div class="muted-note" style="margin-top:10px;">Diagnose (Stotter-Untersuchung):</div>
		<label
			class="control-group"
			style="margin-top:4px; flex-direction: row; align-items: center; gap: 8px;"
		>
			<input
				type="checkbox"
				style="width: auto;"
				checked={$configStore.hudUpdateEnabled}
				onchange={onChangeChecked('hudUpdateEnabled')}
			/>
			Zahlendarstellung Update (l/l²/R)
		</label>
		<label
			class="control-group"
			style="margin-top:4px; flex-direction: row; align-items: center; gap: 8px;"
		>
			<input
				type="checkbox"
				style="width: auto;"
				checked={$configStore.bankRenderEnabled}
				onchange={onChangeChecked('bankRenderEnabled')}
			/>
			Update der Bank (Canvas + Flug)
		</label>
	{/if}

	{#if showTab('Admin') && activeTab === 'Admin'}
		<label class="control-group" style="margin-top: 5px;"
			>Zoom-Schwellwert
			<input
				type="number"
				min="0"
				max="10"
				step="1"
				value={base10Threshold}
				disabled={$configStore.compactionEnabled}
				onchange={onThreshold10Change}
			/>
		</label>
		{#if $configStore.compactionEnabled}
			<div class="muted-note" style="margin-top:-4px;">
				Bei aktiver Kompaktierung nicht verwendet.
			</div>
		{/if}

		<label class="control-group" style="margin-top:10px;"
			>Tick (Debug) — {$compiledStore?.GLOBAL_TTM
				? $compiledStore.GLOBAL_TTM.timeToTick($playbackStore.time).toFixed(2)
				: 0} / {$compiledStore?.GLOBAL_TTM ? $compiledStore.GLOBAL_TTM.maxTick : 0}
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

		<label class="control-group" style="margin-top:6px;"
			>Rest-Anzeige
			<select
				value={$displayStore.restWidget}
				onchange={(e) => displayStore.update((d) => ({ ...d, restWidget: e.target.value }))}
			>
				<option value="bars">Balken (vertikal)</option>
				<option value="grid">Grid (4×4, horizontal)</option>
			</select>
		</label>

		<div class="control-group" style="margin-top:10px;">
			<div>Aktuellen Zustand teilen (kopiert in die Zwischenablage)</div>
			<div class="control-row">
				<button type="button" class="settings-btn" class:copied={urlCopied} onclick={copyUrl}
					>{urlCopied ? 'Kopiert ✓' : 'Als URL kopieren'}</button
				>
				<button type="button" class="settings-btn" class:copied={paramsCopied} onclick={copyParams}
					>{paramsCopied ? 'Kopiert ✓' : 'Nur Parameter kopieren'}</button
				>
			</div>
		</div>
	{/if}

	{#if showTab('Remote-Connect') && activeTab === 'Remote-Connect'}
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
						<button type="button" class="settings-btn" onclick={rotateSessionPin}
							>PIN rotieren</button
						>
						<button type="button" class="settings-btn" onclick={endSession}>Beenden</button>
					</div>
				</div>
				<div class="muted-note" style="margin-top:6px; word-break:break-all;">
					Gast-Link: {session.guestLink}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.tabs {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		margin-bottom: 10px;
		border-bottom: 1px solid #334155;
	}
	.tab-btn {
		background: transparent;
		color: #94a3b8;
		border: none;
		border-bottom: 2px solid transparent;
		padding: 6px 10px;
		cursor: pointer;
		font-size: 0.85em;
		border-radius: 4px 4px 0 0;
	}
	.tab-btn:hover {
		color: #cbd5e1;
	}
	.tab-btn.active {
		color: #f8fafc;
		border-bottom-color: #3b82f6;
	}
	.tab-body {
		display: block;
	}
	.muted-note {
		color: #64748b;
		font-size: 0.78em;
	}
</style>
