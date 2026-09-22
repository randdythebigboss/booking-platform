import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  INTL_LOCALES,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  resolveLocale,
  resolvePreferredLocale,
} from '@/locales';

/**
 * Spanish is the product default, and the rule that matters is the one that is
 * easiest to get wrong: an unsupported language falls back to Spanish, not to
 * English. English is merely the other language the product speaks.
 */

describe('resolveLocale', () => {
  it('accepts the two languages the product speaks', () => {
    expect(resolveLocale('es')).toBe('es');
    expect(resolveLocale('en')).toBe('en');
  });

  it('ignores the region, because the language is what is translated', () => {
    expect(resolveLocale('es-MX')).toBe('es');
    expect(resolveLocale('es-419')).toBe('es');
    expect(resolveLocale('en-GB')).toBe('en');
    expect(resolveLocale('EN-au')).toBe('en');
  });

  it('accepts the underscore form some platforms report', () => {
    expect(resolveLocale('es_DO')).toBe('es');
    expect(resolveLocale('en_US')).toBe('en');
  });

  it('falls back to Spanish for a language the product does not speak', () => {
    expect(resolveLocale('ja')).toBe('es');
    expect(resolveLocale('ja-JP')).toBe('es');
    expect(resolveLocale('fr')).toBe('es');
    expect(resolveLocale('pt-BR')).toBe('es');
  });

  it('falls back to Spanish for nothing at all', () => {
    expect(resolveLocale(null)).toBe('es');
    expect(resolveLocale(undefined)).toBe('es');
    expect(resolveLocale('')).toBe('es');
  });

  it('never answers English just because the input was unrecognised', () => {
    for (const tag of ['ja', 'zz', 'de-AT', 'xx-YY', '!!!']) {
      expect(resolveLocale(tag)).toBe('es');
    }
  });
});

describe('resolvePreferredLocale', () => {
  it('takes the first language in the list that the product speaks', () => {
    expect(resolvePreferredLocale(['ja', 'fr', 'en'])).toBe('en');
    expect(resolvePreferredLocale(['fr', 'es-MX', 'en'])).toBe('es');
  });

  it('is Spanish when nothing in the list is supported', () => {
    // A browser asking for Japanese then French genuinely prefers neither of
    // ours, so it gets the product default rather than the runner-up.
    expect(resolvePreferredLocale(['ja', 'fr', 'de'])).toBe('es');
  });

  it('is Spanish for an empty or ragged list', () => {
    expect(resolvePreferredLocale([])).toBe('es');
    expect(resolvePreferredLocale([null, undefined, ''])).toBe('es');
  });
});

describe('the locale registry', () => {
  it('lists Spanish first, and makes it the default', () => {
    expect(SUPPORTED_LOCALES[0]).toBe('es');
    expect(DEFAULT_LOCALE).toBe('es');
  });

  it('gives every language a regional tag for Intl', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(INTL_LOCALES[locale]).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it('recognises exactly its own languages', () => {
    for (const locale of SUPPORTED_LOCALES) expect(isSupportedLocale(locale)).toBe(true);
    for (const other of ['ja', 'ES', 'es-DO', '', null, undefined, 7]) {
      expect(isSupportedLocale(other)).toBe(false);
    }
  });
});
