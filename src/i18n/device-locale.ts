import { getLocales } from 'expo-localization';

import { resolvePreferredLocale, type Locale } from '@/locales';

/**
 * What this device asks for, narrowed to something the product speaks.
 *
 * `getLocales()` returns the user's ordered preference list on native and
 * reads `navigator.languages` on web, so a browser asking for `ja, fr, en`
 * lands on English -- it genuinely prefers English to nothing -- while one
 * asking for `ja, fr` lands on Spanish.
 *
 * Never called during the first render. See `src/i18n/index.ts`.
 */
export function detectDeviceLocale(): Locale {
  try {
    const tags = getLocales().map((entry) => entry.languageTag ?? entry.languageCode);
    return resolvePreferredLocale(tags);
  } catch {
    // expo-localization can throw in an environment without the native module
    // (a test runner, an unusual web view). Spanish is the honest answer.
    return resolvePreferredLocale([]);
  }
}
