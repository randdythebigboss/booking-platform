import type { Translations } from '@/locales';

/**
 * Makes `t()` key-checked at compile time.
 *
 * With this, `t('appointments.ttitle')` is a type error rather than a string
 * that renders as its own key. It is what turns "no hardcoded strings" from a
 * convention into something the typechecker enforces.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: Translations;
    };
  }
}
