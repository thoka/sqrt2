import { beforeEach, expect, test, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	AUTO,
	locale,
	localePreference,
	pickLocale,
	setLocalePreference,
	SUPPORTED_LOCALES,
} from './i18n.js';

// jsdom liefert in dieser Vitest-Konfiguration kein globales `localStorage`
// (siehe i18n.js: `typeof localStorage !== 'undefined'`-Guards genau dafür).
// Für die persistence-Tests hier daher ein minimaler In-Memory-Ersatz.
function fakeLocalStorage() {
	const map = new Map();
	return {
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(k, String(v)),
		removeItem: (k) => map.delete(k),
		clear: () => map.clear(),
	};
}

beforeEach(() => {
	vi.stubGlobal('localStorage', fakeLocalStorage());
});

test('pickLocale: URL-Parameter (lang) hat Vorrang vor localStorage', () => {
	expect(pickLocale('de', 'en')).toBe('de');
});

test('pickLocale: localStorage greift, wenn kein (gültiger) URL-Parameter da ist', () => {
	expect(pickLocale(null, 'de')).toBe('de');
	expect(pickLocale('fr', 'de')).toBe('de');
});

test('pickLocale: Browsersprache greift, wenn weder URL noch localStorage einen unterstützten Wert liefern', () => {
	expect(pickLocale(null, null, 'de')).toBe('de');
	expect(pickLocale(null, null, 'de-AT')).toBe('de');
	expect(pickLocale('fr', 'fr', 'de-DE')).toBe('de');
});

test('pickLocale: Default (en), wenn URL, localStorage und Browsersprache keinen unterstützten Wert liefern', () => {
	expect(pickLocale(null, null)).toBe('en');
	expect(pickLocale(null, null, null)).toBe('en');
	expect(pickLocale(null, null, 'fr-FR')).toBe('en');
	expect(pickLocale('fr', 'fr', 'fr')).toBe('en');
});

test('pickLocale: localStorage hat Vorrang vor Browsersprache', () => {
	expect(pickLocale(null, 'en', 'de')).toBe('en');
});

test('pickLocale: liefert nur unterstützte Locales', () => {
	for (const loc of SUPPORTED_LOCALES) {
		expect(pickLocale(loc, null)).toBe(loc);
	}
});

test('setLocalePreference: explizite Wahl wird persistiert und im Umschalter angezeigt', () => {
	setLocalePreference('de');
	expect(get(locale)).toBe('de');
	expect(get(localePreference)).toBe('de');
	expect(localStorage.getItem('sqrt2.locale')).toBe('de');
});

test('setLocalePreference(AUTO): löscht die gespeicherte Wahl und folgt wieder der Browsersprache', () => {
	setLocalePreference('de');
	vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');

	setLocalePreference(AUTO);

	expect(get(localePreference)).toBe(AUTO);
	expect(localStorage.getItem('sqrt2.locale')).toBeNull();
	expect(get(locale)).toBe('en');
});
