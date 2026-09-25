import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  currencySymbol,
  formatDateIn,
  formatDateTimeIn,
  formatDayAndMonthIn,
  formatDuration,
  formatMoney,
  formatTimeIn,
  formatWeekdayIn,
} from '@/lib/format';
import { INTL_LOCALES, resolveLocale } from '@/locales';

export interface Formatters {
  /** The BCP 47 tag Intl is using, exposed for anything formatting inline. */
  intlLocale: string;
  time: (instant: Date, timezone: string) => string;
  date: (instant: Date, timezone: string) => string;
  /** `26 sept` — for a narrow column beside a time. */
  dayAndMonth: (instant: Date, timezone: string) => string;
  /** `sáb` — for a calendar strip. */
  weekday: (instant: Date, timezone: string) => string;
  dateTime: (instant: Date, timezone: string) => string;
  /** An exact decimal from the database, or a number. Never arithmetic. */
  money: (amount: string | number, currency: string) => string;
  duration: (minutes: number) => string;
  /** The mark a currency is written with, for a form label. */
  currencyMark: (currency: string) => string;
  /** The word for today, for an accessible label. */
  todayWord: () => string;
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
      dayAndMonth: (instant, timezone) => formatDayAndMonthIn(instant, timezone, intlLocale),
      weekday: (instant, timezone) => formatWeekdayIn(instant, timezone, intlLocale),
      dateTime: (instant, timezone) => formatDateTimeIn(instant, timezone, intlLocale),
      money: (amount, currency) => formatMoney(amount, currency, intlLocale),
      duration: (minutes) => formatDuration(minutes, intlLocale),
      currencyMark: (currency) => currencySymbol(currency, intlLocale),
      todayWord: () => (intlLocale.startsWith('es') ? 'hoy' : 'today'),
    }),
    [intlLocale],
  );
}
