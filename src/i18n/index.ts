import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, resources } from '@/locales';

/**
 * One i18next instance for the whole app.
 *
 * It is initialised **synchronously and always in Spanish**. That is not a
 * detail: Expo Router static-renders every web route at build time, where
 * there is no visitor and no browser locale. If this resolved a language at
 * module load, the server would render one language and the client would
 * hydrate with another, and React would report a mismatch on the very first
 * paint. So the first render is deterministic -- Spanish, the product default,
 * everywhere -- and the resolved language is applied after mount by
 * `LocaleProvider`. On native there is no hydration, and that switch happens
 * before anything is visible.
 *
 * `fallbackLng` is Spanish for the same reason the product default is: an
 * unsupported language must land on the canonical one.
 */
const i18n = createInstance();

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...SUPPORTED_LOCALES],
  // A key with no translation should be loud in development and harmless in
  // production; it must never render as an empty string.
  returnEmptyString: false,
  interpolation: {
    // React escapes for us. Double-escaping turns an apostrophe into &#39;.
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

export default i18n;
