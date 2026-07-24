import { expect, test } from 'vitest';
import { pickLocale, SUPPORTED_LOCALES } from './i18n.js';

test('pickLocale: URL-Parameter (lang) hat Vorrang vor localStorage', () => {
	expect(pickLocale('de', 'en')).toBe('de');
});

test('pickLocale: localStorage greift, wenn kein (gültiger) URL-Parameter da ist', () => {
	expect(pickLocale(null, 'de')).toBe('de');
	expect(pickLocale('fr', 'de')).toBe('de');
});

test('pickLocale: Default (en), wenn weder URL noch localStorage einen unterstützten Wert liefern', () => {
	expect(pickLocale(null, null)).toBe('en');
	expect(pickLocale('fr', 'fr')).toBe('en');
});

test('pickLocale: liefert nur unterstützte Locales', () => {
	for (const loc of SUPPORTED_LOCALES) {
		expect(pickLocale(loc, null)).toBe(loc);
	}
});
