import { expect, test } from 'vitest';
import { pickLocale, SUPPORTED_LOCALES } from './i18n.js';

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
