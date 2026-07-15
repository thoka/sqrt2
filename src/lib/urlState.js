// URL <-> Store Zustands-Synchronisierung (TOOLING_SPEC.md Phase 3). Ersetzt
// die frühere generische SETTINGS-Liste in sqrt2.html (bindEl() +
// applyPhase()/buildStateParams()), die auf DOM-Elemente angewiesen war -
// dieselbe "ein Eintrag pro Einstellung"-Idee (siehe CLAUDE.md "Einstellungen
// & URL-Zustand"), jetzt aber direkt über configStore/playbackStore-Felder
// statt über DOM-Elemente vermittelt. Reines Modul (kein DOM-Zugriff), daher
// per node --test testbar wie compiler.js/bank-core.js.
//
// Jeder Eintrag: URL-Parametername (key), das configStore-Feld (field),
// parse() für den Import (String -> Wert, undefined = ignorieren/Default
// behalten) und format() für den Export (Wert -> String).
const CONFIG_FIELDS = [
	{ key: 'base', field: 'base', parse: (v) => parseInt(v), format: (c) => String(c.base) },
	{ key: 'depth', field: 'depth', parse: (v) => parseInt(v), format: (c) => String(c.depth) },
	{ key: 'mode', field: 'transformMode', parse: (v) => v, format: (c) => c.transformMode },
	{
		key: 'zoomthresh',
		field: 'bankZoomThresholdPowers',
		parse: (v) => parseInt(v) || 0,
		format: (c) => String(c.bankZoomThresholdPowers),
	},
	{
		key: 'autozoom',
		field: 'autoZoomMinPx',
		parse: (v) => parseFloat(v) || 0,
		format: (c) => String(c.autoZoomMinPx),
	},
	{
		key: 'zoomspeed',
		field: 'zoomSpeedCoef',
		parse: (v) => parseFloat(v) || 0.012,
		format: (c) => String(c.zoomSpeedCoef),
	},
	{
		key: 'linewidth',
		field: 'lineWidth',
		parse: (v) => parseFloat(v) || 0,
		format: (c) => String(c.lineWidth),
	},
	{
		key: 'pause',
		field: 'pauseDuration',
		parse: (v) => parseFloat(v) || 0,
		format: (c) => String(c.pauseDuration),
	},
	{
		key: 'compaction',
		field: 'compactionEnabled',
		parse: (v) => v === '1',
		format: (c) => (c.compactionEnabled ? '1' : '0'),
	},
	{
		key: 'speed',
		field: 'playSpeed',
		parse: (v) => parseFloat(v) || 2.0,
		format: (c) => String(c.playSpeed),
	},
	{
		key: 'transition',
		field: 'compactionTransitionTicks',
		parse: (v) => parseInt(v),
		format: (c) => String(c.compactionTransitionTicks),
	},
	{
		key: 'modeab',
		field: 'modeAB',
		parse: (v) => Math.max(0, Math.min(1, parseFloat(v) || 0)),
		format: (c) => c.modeAB.toFixed(4),
	},
];

// Liest alle in `params` vorhandenen CONFIG_FIELDS-Parameter und liefert ein
// partielles Overrides-Objekt (nur tatsächlich in der URL gesetzte Felder) -
// zum Mergen in configStore, z.B. `configStore.update(c => ({...c, ...overrides}))`.
export function parseConfigFromUrl(params) {
	let overrides = {};
	for (let f of CONFIG_FIELDS) {
		if (!params.has(f.key)) continue;
		let raw = f.parse(params.get(f.key));
		if (raw === undefined || (typeof raw === 'number' && Number.isNaN(raw))) continue;
		overrides[f.field] = raw;
	}
	return overrides;
}

// time/tick/play hängen von der bereits kompilierten Simulation ab
// (MAX_TIME/GLOBAL_TTM) bzw. sind reiner Playback-Zustand - werden separat
// behandelt (entspricht der früheren "phase: post"-Unterscheidung in
// sqrt2.html, siehe TOOLING_SPEC.md). `compiled` ist das compiledStore-Ergebnis
// (braucht MAX_TIME/GLOBAL_TTM zum Clampen bzw. Tick->Zeit-Umrechnen).
export function parsePlaybackFromUrl(params, compiled) {
	let overrides = {};
	if (params.has('time')) {
		overrides.time = Math.max(0, Math.min(compiled.MAX_TIME, parseFloat(params.get('time')) || 0));
	} else if (params.has('tick') && compiled.GLOBAL_TTM) {
		let tick = Math.max(
			0,
			Math.min(compiled.GLOBAL_TTM.maxTick, Math.round(parseFloat(params.get('tick')) || 0)),
		);
		overrides.time = compiled.GLOBAL_TTM.tickToTime(tick);
	}
	if (params.has('play')) overrides.isPlaying = params.get('play') === '1';
	return overrides;
}

// Baut denselben Parameter-Satz, den parseConfigFromUrl()/parsePlaybackFromUrl()
// zurücklesen - Gegenstück für die "Zustand teilen"-Buttons.
export function buildStateParams(config, playback) {
	let p = new URLSearchParams();
	for (let f of CONFIG_FIELDS) p.set(f.key, f.format(config));
	p.set('time', playback.time.toFixed(3));
	p.set('play', playback.isPlaying ? '1' : '0');
	return p;
}
