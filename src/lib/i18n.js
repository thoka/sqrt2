// i18n-Setup (svelte-i18n: ICU-MessageFormat auf Basis von Intl, reaktive
// Stores). Katalog wird EAGER (statischer Import + addMessages) geladen statt
// per register()+dynamic import: bei diesem Katalogumfang (ein paar KB) ist
// Lazy-Loading kein Gewinn, macht aber die $_-Übersetzung erst nach einem
// await asynchron verfügbar - das würde in Unit-Tests, die Komponenten ohne
// await mounten (z.B. ControlPanel.test.js), zu einem Flash unübersetzter
// Keys führen.
//
// Kataloge als .js (export default {...}) statt .json: `compileOrchestrator.js`
// importiert dieses Modul und läuft auch unter `node --test` (nativer
// ESM-Loader, siehe AGENTS.md) - dort braucht ein JSON-Import
// Import-Attribute (`with { type: 'json' }`), was den Node/Vite-Support
// unnötig verkompliziert. Ein JS-Modul mit Objekt-Literal funktioniert
// identisch unter Vite UND nativem Node ohne Sondersyntax.
//
// Default (Fallback, falls weder URL, localStorage noch Browsersprache
// passen) ist 'en'. Eine bereits getroffene Nutzerwahl (Sprachumschalter im
// Admin-Tab) wird in localStorage gemerkt und hat Vorrang vor der
// Browsersprache - siehe pickLocale()-Priorität unten.
import { addMessages, init, locale, _ } from 'svelte-i18n';
import { writable } from 'svelte/store';
import en from './locales/en.js';
import de from './locales/de.js';

export const SUPPORTED_LOCALES = ['en', 'de'];
const DEFAULT_LOCALE = 'en';
const STORAGE_KEY = 'sqrt2.locale';

// Sentinel für "keine explizite Wahl getroffen, folge der Browsersprache".
// Muss von SUPPORTED_LOCALES unterschieden bleiben: es ist die Auswahl im
// Sprachumschalter (localePreference), NICHT ein Wert von `locale` selbst -
// der Umschalter braucht diesen Wert, um "Auto" anzeigen zu können, statt
// so zu tun als sei die browser-abgeleitete Sprache eine bewusste Wahl.
export const AUTO = 'auto';

addMessages('en', en);
addMessages('de', de);

// Auf den unterstützten Basis-Sprachcode reduzieren, z.B. "de-AT" oder
// "de-DE" -> "de". navigator.language liefert i.d.R. einen BCP-47-Tag mit
// Region, unser Katalog kennt aber nur die Basissprache.
function matchBrowserLocale(browserLang) {
	if (!browserLang) return null;
	const base = browserLang.split('-')[0].toLowerCase();
	return SUPPORTED_LOCALES.includes(base) ? base : null;
}

// Priorität: `?lang=`-URL-Parameter (explizite Wahl, z.B. geteilter Link
// oder Gast-Link/QR der Fernsteuerung) > localStorage (letzte Wahl im
// Sprachumschalter) > Browser-/Systemsprache > Default. Reine Funktion (kein
// DOM-Zugriff), daher per node --test/vitest ohne Browser-Mocking testbar -
// siehe i18n.test.js.
export function pickLocale(urlLang, storedLang, browserLang) {
	if (SUPPORTED_LOCALES.includes(urlLang)) return urlLang;
	if (SUPPORTED_LOCALES.includes(storedLang)) return storedLang;
	const browserLocale = matchBrowserLocale(browserLang);
	if (browserLocale) return browserLocale;
	return DEFAULT_LOCALE;
}

function storedLocale() {
	const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
	return SUPPORTED_LOCALES.includes(stored) ? stored : null;
}

// Wird HIER (vor init()) ausgewertet, nicht erst in einem onMount, damit
// keine Komponente kurz in der falschen Sprache aufblitzt (App.svelte UND
// RemoteControl.svelte importieren i18n.js gleichermaßen - kein
// Extra-Wiring pro Entry-Point nötig).
function initialLocale() {
	const urlLang =
		typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('lang') : null;
	const browserLang = typeof navigator !== 'undefined' ? navigator.language : null;
	return pickLocale(urlLang, storedLocale(), browserLang);
}

init({
	fallbackLocale: DEFAULT_LOCALE,
	initialLocale: initialLocale(),
});

// Zeigt im Sprachumschalter die BEWUSST GETROFFENE Wahl an (localStorage),
// oder AUTO, wenn noch keine getroffen wurde - unabhängig davon, welche
// Sprache gerade dank Browser-Erkennung oder `?lang=`-Link angezeigt wird.
// Ohne diese Trennung würde jede browser-abgeleitete Anzeige wie eine
// bewusste Wahl aussehen und es gäbe keinen Weg zurück zu "folge Browser".
export const localePreference = writable(storedLocale() ?? AUTO);

// Einzige Stelle, die die Sprache ändert UND in localStorage persistiert.
// `locale.set()` direkt aufzurufen (z.B. aus einem Komponenten-Handler)
// würde localePreference nicht mitziehen - deshalb hier bündeln.
export function setLocalePreference(pref) {
	if (pref === AUTO) {
		if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
		localePreference.set(AUTO);
		const browserLang = typeof navigator !== 'undefined' ? navigator.language : null;
		locale.set(matchBrowserLocale(browserLang) ?? DEFAULT_LOCALE);
		return;
	}
	if (!SUPPORTED_LOCALES.includes(pref)) return;
	if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, pref);
	localePreference.set(pref);
	locale.set(pref);
}

if (typeof document !== 'undefined') {
	locale.subscribe((value) => {
		if (!value) return;
		document.documentElement.lang = value;
	});
}

export { locale, _ };
