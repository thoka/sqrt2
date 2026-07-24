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
	// (targetDisplayEngagement/targetDisplayLevel/lineWidth/pause/speed)
	// reagieren dagegen live (oninput), genau wie im alten Panel.
	import { configStore, playbackStore, compiledStore } from '../lib/stores.js';
	import { levelToPx, targetDisplayMaxPxStore } from '../lib/targetDisplayLevel.js';
	import { displayStore } from '../lib/displayStore.js';
	import { buildStateParams } from '../lib/urlState.js';
	import { initNetworkSync } from '../lib/syncedStore.js';
	import { locale, _, SUPPORTED_LOCALES } from '../lib/i18n.js';
	import {
		buildWsUrl,
		buildGuestLink,
		mintHostToken,
		rotatePin,
		revokeToken,
		randomPin,
		createWsRoom,
	} from '../lib/connection.js';

	// Tab-IDs sind stabile, sprachunabhängige Kennungen (NICHT die
	// angezeigten Labels, die kommen aus $_('controlPanel.tabs.<id>')) -
	// Welche Tabs sichtbar sind. Default: alle. Die Fernsteuerung übergibt
	// nur ['basics'] (Besucher-QR zeigt nur die Grundeinstellungen).
	const ALL_TABS = ['basics', 'animation', 'admin', 'remote'];
	let { visibleTabs = ALL_TABS } = $props();

	let activeTab = $state('basics');
	// Wenn der erlaubte Tab-Satz wechselt (z.B. Remote ohne Admin), sicher-
	// stellen, dass ein sichtbarer Tab aktiv ist.
	$effect(() => {
		if (!visibleTabs.includes(activeTab)) {
			activeTab = visibleTabs[0] ?? 'basics';
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

	function onChangeChecked(field) {
		return (e) => configStore.update((c) => ({ ...c, [field]: e.target.checked }));
	}
	function onChangeValue(field) {
		return (e) => configStore.update((c) => ({ ...c, [field]: e.target.value }));
	}

	// Alternative Rand-Ziel-Darstellung-Steuerung (docs/Alternative
	// Ziel-Darstellung-Steuerung.md): Radio-Klick setzt NUR
	// targetDisplayState - der eigentliche (weiche) Uebergang von
	// targetDisplayEngagement/abstraction auf das Preset dieses Zustands
	// laeuft in targetDisplayStateTween.js, angestossen durch genau diese
	// Store-Aenderung.
	function onTargetDisplayStateChange(state) {
		return () => configStore.update((c) => ({ ...c, targetDisplayState: state }));
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
	// Aktuelle Sprache im geteilten Link mitgeben (`lang`, siehe i18n.js
	// initialLocale()) - sonst oeffnet ein geteilter/QR-Link immer in der
	// Default-Sprache statt in der, die der Teilende gerade eingestellt hat.
	function buildShareParams() {
		let params = buildStateParams($configStore, $playbackStore);
		params.set('lang', $locale);
		return params;
	}
	function copyUrl() {
		let url = location.origin + location.pathname + '?' + buildShareParams().toString();
		navigator.clipboard.writeText(url).then(() => {
			urlCopied = true;
			setTimeout(() => {
				urlCopied = false;
			}, 1200);
		});
	}
	function copyParams() {
		navigator.clipboard.writeText(buildShareParams().toString()).then(() => {
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
				lang: $locale,
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
				lang: $locale,
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
				onclick={() => (activeTab = tab)}>{$_(`controlPanel.tabs.${tab}`)}</button
			>
		{/if}
	{/each}
</div>

<div class="tab-body">
	{#if showTab('basics') && activeTab === 'basics'}
		<div class="control-row">
			<label class="control-group"
				>{$_('controlPanel.basics.base')}
				<input
					type="number"
					min="2"
					max="16"
					value={$configStore.base}
					onchange={onChangeInt('base', $configStore.base)}
				/>
			</label>
			<label class="control-group"
				>{$_('controlPanel.basics.depth')}
				<input
					type="number"
					min="1"
					max="100"
					value={$configStore.depth}
					onchange={onChangeInt('depth', $configStore.depth)}
				/>
			</label>
		</div>

		{#if $configStore.edgeTargetDisplayControlMode}
			<fieldset class="control-group target-display-state-group" style="margin-top:6px;">
				<legend>{$_('controlPanel.basics.targetDisplay')}</legend>
				<label class="radio-row">
					<input
						type="radio"
						name="targetDisplayState"
						checked={$configStore.targetDisplayState === 'flaechentreu'}
						onchange={onTargetDisplayStateChange('flaechentreu')}
					/>
					{$_('controlPanel.basics.targetDisplayFlaechentreu')}
				</label>
				<label class="radio-row">
					<input
						type="radio"
						name="targetDisplayState"
						checked={$configStore.targetDisplayState === 'rand'}
						onchange={onTargetDisplayStateChange('rand')}
					/>
					{$_('controlPanel.basics.targetDisplayRand')}
				</label>
				<label class="radio-row">
					<input
						type="radio"
						name="targetDisplayState"
						checked={$configStore.targetDisplayState === 'gleichmaessig'}
						onchange={onTargetDisplayStateChange('gleichmaessig')}
					/>
					{$_('controlPanel.basics.targetDisplayGleichmaessig')}
				</label>
			</fieldset>
		{:else}
			<label class="control-group" style="margin-top:6px;"
				>{$_('controlPanel.basics.targetDisplayEngagement')}
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={$configStore.targetDisplayEngagement}
					oninput={onInputFloat('targetDisplayEngagement', 1)}
				/>
				<span class="target-display-readout"
					>{Math.round($configStore.targetDisplayEngagement * 100)} %</span
				>
			</label>
		{/if}

		<label class="control-group" style="margin-top: 5px;"
			>{$_('controlPanel.basics.targetDisplayLevel')}
			<input
				type="range"
				min="0"
				max="1"
				step="0.001"
				value={$configStore.targetDisplayLevel}
				oninput={onInputFloat('targetDisplayLevel', 0)}
			/>
			<span class="target-display-readout"
				>{levelToPx($configStore.targetDisplayLevel, $targetDisplayMaxPxStore).toLocaleString(
					$locale,
					{
						minimumFractionDigits: 3,
						maximumFractionDigits: 3,
					},
				)} px</span
			>
		</label>

		{#if !$configStore.edgeTargetDisplayControlMode}
			<label class="control-group" style="margin-top: 5px;"
				>{$_('controlPanel.basics.abstraction')}
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={$configStore.abstraction}
					oninput={onInputFloat('abstraction', 0)}
				/>
				<span class="target-display-readout">{Math.round($configStore.abstraction * 100)} %</span>
			</label>
		{/if}

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
			{$_('controlPanel.basics.showLabels')}
		</label>

		<div class="control-group" style="margin-top:10px;">
			<div>
				{$_('controlPanel.basics.bankZoomLabel')}
				<span class="zoom-readout" id="bankZoomLabel"
					>{(1).toLocaleString($locale, {
						minimumFractionDigits: 1,
						maximumFractionDigits: 1,
					})}×</span
				>
			</div>
			<div style="margin-top:-4px;">
				{$_('controlPanel.basics.bankAreaLabel')}
				<span class="zoom-readout" id="bankAreaLabel">100%</span>
			</div>
		</div>
	{/if}

	{#if showTab('animation') && activeTab === 'animation'}
		<label class="control-group" style="margin-top: 5px;"
			>{$_('controlPanel.animation.flightMode')}
			<select value={$configStore.transformMode} onchange={onChangeValue('transformMode')}>
				<option value="S">{$_('controlPanel.animation.flightModeStretch')}</option>
				<option value="Z">{$_('controlPanel.animation.flightModeCut')}</option>
			</select>
		</label>

		<label class="control-group" style="margin-top:6px;"
			>{$_('controlPanel.animation.stateTransitionDuration')}
			<input
				type="range"
				min="0"
				max="10"
				step="0.1"
				value={$configStore.targetDisplayStateTransitionDuration}
				oninput={onInputFloat('targetDisplayStateTransitionDuration', 1.0)}
			/>
			<span class="target-display-readout"
				>{$configStore.targetDisplayStateTransitionDuration.toLocaleString($locale, {
					minimumFractionDigits: 1,
					maximumFractionDigits: 1,
				})} s</span
			>
		</label>

		<label class="control-group" style="margin-top:6px;"
			>{$_('controlPanel.animation.zoomInertia')}
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
			>{$_('controlPanel.animation.lineWidth')}
			<span class="zoom-readout"
				>{$configStore.lineWidth.toLocaleString($locale, {
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
			>{$_('controlPanel.animation.waitTime')}
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
			{$_('controlPanel.animation.flightRotation')}
		</label>
		<label class="control-group" style="margin-top:6px;"
			>{$_('controlPanel.animation.flyingAlpha')}
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
			>{$_('controlPanel.animation.flightSpeedThreshold')}
			<input
				type="number"
				min="0.1"
				step="0.1"
				value={$configStore.flightAnimSpeedThreshold}
				onchange={onChangeFloat('flightAnimSpeedThreshold', 3.0)}
			/>
		</label>

		<div class="muted-note" style="margin-top:10px;">
			{$_('controlPanel.animation.diagnostics')}
		</div>
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
			{$_('controlPanel.animation.hudUpdate')}
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
			{$_('controlPanel.animation.bankUpdate')}
		</label>
	{/if}

	{#if showTab('admin') && activeTab === 'admin'}
		<label
			class="control-group"
			style="margin-top: 5px; flex-direction: row; align-items: center; gap: 8px;"
		>
			<input
				type="checkbox"
				style="width: auto;"
				checked={$configStore.edgeTargetDisplayControlMode}
				onchange={onChangeChecked('edgeTargetDisplayControlMode')}
			/>
			{$_('controlPanel.admin.edgeTargetDisplayMode')}
		</label>

		<label class="control-group" style="margin-top:10px;"
			>{$_('controlPanel.admin.language')}
			<select value={$locale} onchange={(e) => locale.set(e.target.value)}>
				{#each SUPPORTED_LOCALES as loc}
					<option value={loc}>{loc.toUpperCase()}</option>
				{/each}
			</select>
		</label>

		<label class="control-group" style="margin-top:10px;"
			>{$_('controlPanel.admin.zoomThreshold')}
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
				{$_('controlPanel.admin.zoomThresholdDisabledNote')}
			</div>
		{/if}

		<label class="control-group" style="margin-top:10px;"
			>{$_('controlPanel.admin.tickDebug')}
			{$compiledStore?.GLOBAL_TTM
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
			>{$_('controlPanel.admin.restDisplay')}
			<select
				value={$displayStore.restWidget}
				onchange={(e) => displayStore.update((d) => ({ ...d, restWidget: e.target.value }))}
			>
				<option value="bars">{$_('controlPanel.admin.restDisplayBars')}</option>
				<option value="grid">{$_('controlPanel.admin.restDisplayGrid')}</option>
			</select>
		</label>

		<div class="control-group" style="margin-top:10px;">
			<div>{$_('controlPanel.admin.shareState')}</div>
			<div class="control-row">
				<button type="button" class="settings-btn" class:copied={urlCopied} onclick={copyUrl}
					>{urlCopied
						? $_('controlPanel.admin.copied')
						: $_('controlPanel.admin.copyAsUrl')}</button
				>
				<button type="button" class="settings-btn" class:copied={paramsCopied} onclick={copyParams}
					>{paramsCopied
						? $_('controlPanel.admin.copied')
						: $_('controlPanel.admin.copyParamsOnly')}</button
				>
			</div>
		</div>
	{/if}

	{#if showTab('remote') && activeTab === 'remote'}
		<div class="control-group">
			<div style="font-weight: bold; color: #3b82f6;">{$_('controlPanel.remote.heading')}</div>
			{#if !session}
				<label class="control-group" style="margin-top:5px;"
					>{$_('controlPanel.remote.relayUrl')}
					<input type="text" bind:value={relayUrl} placeholder="http://host:8080" />
				</label>
				<label class="control-group" style="margin-top:5px;"
					>{$_('controlPanel.remote.apiKey')}
					<input type="text" bind:value={apiKey} placeholder="Relay-API_KEY" />
				</label>
				<div class="control-row" style="margin-top:5px;">
					<label class="control-group"
						>{$_('controlPanel.remote.seats')}
						<input type="number" min="1" max="999" bind:value={seats} />
					</label>
					<label class="control-group"
						>{$_('controlPanel.remote.pin')}
						<input
							type="text"
							bind:value={pinInput}
							placeholder={$_('controlPanel.remote.pinPlaceholder')}
						/>
					</label>
				</div>
				<button type="button" class="settings-btn" onclick={startSession}
					>{$_('controlPanel.remote.startSession')}</button
				>
				{#if sessionError}
					<div class="error-msg">{sessionError}</div>
				{/if}
			{:else}
				<div class="control-row" style="align-items:center; gap:14px; margin-top:5px;">
					<canvas bind:this={qrCanvas} width="200" height="200"></canvas>
					<div class="control-group" style="gap:6px;">
						<div>
							{$_('controlPanel.remote.status')}
							<span class="zoom-readout"
								>{$_(`connStatus.${connStatus}`, { default: connStatus })}</span
							>
						</div>
						<div>
							{$_('controlPanel.remote.guestsConnected')}
							<span class="zoom-readout">{guestCount}</span>
						</div>
						{#if session.pin}
							<div>
								{$_('controlPanel.remote.pinLabel')}
								<span class="zoom-readout" style="font-size:1.3rem; letter-spacing:2px;"
									>{session.pin}</span
								>
							</div>
						{:else}
							<div class="muted-note">{$_('controlPanel.remote.noPin')}</div>
						{/if}
						<button type="button" class="settings-btn" onclick={copyGuestLink}
							>{linkCopied
								? $_('controlPanel.admin.copied')
								: $_('controlPanel.remote.copyLink')}</button
						>
						<button type="button" class="settings-btn" onclick={rotateSessionPin}
							>{$_('controlPanel.remote.rotatePin')}</button
						>
						<button type="button" class="settings-btn" onclick={endSession}
							>{$_('controlPanel.remote.endSession')}</button
						>
					</div>
				</div>
				<div class="muted-note" style="margin-top:6px; word-break:break-all;">
					{$_('controlPanel.remote.guestLink')}
					{session.guestLink}
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
	.target-display-state-group {
		border: none;
		margin: 0;
		padding: 0;
	}
	.target-display-state-group legend {
		font-size: 0.9em;
		padding: 0;
		margin-bottom: 2px;
	}
	.radio-row {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 8px;
	}
	.radio-row input[type='radio'] {
		width: auto;
	}
</style>
