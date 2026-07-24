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

function initialLocale() {
	if (typeof localStorage === 'undefined') return DEFAULT_LOCALE;
	const saved = localStorage.getItem(STORAGE_KEY);
	return SUPPORTED_LOCALES.includes(saved) ? saved : DEFAULT_LOCALE;
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
