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
// Default bewusst 'en' (NICHT per getLocaleFromNavigator() aus dem Browser
// abgeleitet) - Vorgabe: Interface soll zum Testen auf Englisch als Default
// erscheinen. Eine bereits getroffene Nutzerwahl (Sprachumschalter im
// Admin-Tab) wird in localStorage gemerkt und hat Vorrang.
import { addMessages, init, locale, _ } from 'svelte-i18n';
import en from './locales/en.js';
import de from './locales/de.js';

export const SUPPORTED_LOCALES = ['en', 'de'];
const DEFAULT_LOCALE = 'en';
const STORAGE_KEY = 'sqrt2.locale';

addMessages('en', en);
addMessages('de', de);

// Priorität: `?lang=`-URL-Parameter (explizite Wahl, z.B. geteilter Link
// oder Gast-Link/QR der Fernsteuerung) > localStorage (letzte Wahl im
// Sprachumschalter) > Default. Reine Funktion (kein DOM-Zugriff), daher
// per node --test/vitest ohne Browser-Mocking testbar - siehe i18n.test.js.
export function pickLocale(urlLang, storedLang) {
	if (SUPPORTED_LOCALES.includes(urlLang)) return urlLang;
	if (SUPPORTED_LOCALES.includes(storedLang)) return storedLang;
	return DEFAULT_LOCALE;
}

// Wird HIER (vor init()) ausgewertet, nicht erst in einem onMount, damit
// keine Komponente kurz in der falschen Sprache aufblitzt (App.svelte UND
// RemoteControl.svelte importieren i18n.js gleichermaßen - kein
// Extra-Wiring pro Entry-Point nötig).
function initialLocale() {
	const urlLang =
		typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('lang') : null;
	const storedLang = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
	return pickLocale(urlLang, storedLang);
}

init({
	fallbackLocale: DEFAULT_LOCALE,
	initialLocale: initialLocale(),
});

if (typeof document !== 'undefined') {
	locale.subscribe((value) => {
		if (!value) return;
		document.documentElement.lang = value;
		if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, value);
	});
}

export { locale, _ };
