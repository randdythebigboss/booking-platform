import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  formatDateIn,
  formatDateTimeIn,
  formatDuration,
  formatMoney,
  formatTimeIn,
} from '@/lib/format';
import { INTL_LOCALES, resolveLocale } from '@/locales';

export interface Formatters {
  /** The BCP 47 tag Intl is using, exposed for anything formatting inline. */
  intlLocale: string;
  time: (instant: Date, timezone: string) => string;
  date: (instant: Date, timezone: string) => string;
  dateTime: (instant: Date, timezone: string) => string;
  money: (amount: number, currency: string) => string;
  duration: (minutes: number) => string;
}

/**
 * Formatters bound to the current language.
 *
 * Every one of them still takes the business timezone explicitly, because the
 * two things are unrelated: the reader's language decides how a time is
 * written, and the business's timezone decides which time it is. Binding only
 * the locale here is what stops a screen quietly falling back to the device's
 * zone while it reaches for a language.
 */
export function useFormat(): Formatters {
  const { i18n } = useTranslation();
  const intlLocale = INTL_LOCALES[resolveLocale(i18n.language)];

  return useMemo(
    () => ({
      intlLocale,
      time: (instant, timezone) => formatTimeIn(instant, timezone, intlLocale),
      date: (instant, timezone) => formatDateIn(instant, timezone, intlLocale),
      dateTime: (instant, timezone) => formatDateTimeIn(instant, timezone, intlLocale),
      money: (amount, currency) => formatMoney(amount, currency, intlLocale),
      duration: (minutes) => formatDuration(minutes, intlLocale),
    }),
    [intlLocale],
  );
}
