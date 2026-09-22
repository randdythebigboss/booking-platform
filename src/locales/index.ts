import { en } from './en';
import { es, type Translations } from './es';

/**
 * Spanish is first in this list and first in the product. Everything that
 * resolves a locale falls back to it, and nothing falls back to English
 * merely because English is common in software.
 */
export const SUPPORTED_LOCALES = ['es', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es';

export const resources: Record<Locale, { translation: Translations }> = {
  es: { translation: es },
  en: { translation: en },
};

/** What each language calls itself. Never a flag: a flag is a country. */
export const LOCALE_NAMES: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
};

/**
 * The BCP 47 tag handed to Intl for dates, times and currency.
 *
 * Deliberately regional. `es` alone leaves the region to the platform, and
 * the same appointment then reads differently on two devices. The product's
 * home market is the Dominican Republic, so Spanish formats as it does there.
 */
export const INTL_LOCALES: Record<Locale, string> = {
  es: 'es-DO',
  en: 'en-US',
};

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Narrows any device or browser tag to something supported.
 *
 * `es-MX`, `es_419` and `es` all become `es`. Japanese becomes Spanish,
 * because an unsupported language falls back to the product default rather
 * than to whatever happens to be second.
 */
export function resolveLocale(tag: string | null | undefined): Locale {
  if (!tag) return DEFAULT_LOCALE;
  const base = tag.toLowerCase().replace('_', '-').split('-')[0];
  return isSupportedLocale(base) ? base : DEFAULT_LOCALE;
}

/**
 * The first supported language among the caller's preferences, in order.
 *
 * A browser that asks for `ja, fr, en` gets English -- it genuinely prefers
 * English over nothing. A browser that asks for `ja, fr` gets Spanish.
 */
export function resolvePreferredLocale(tags: readonly (string | null | undefined)[]): Locale {
  for (const tag of tags) {
    if (!tag) continue;
    const base = tag.toLowerCase().replace('_', '-').split('-')[0];
    if (isSupportedLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export { en, es };
export type { Translations };
