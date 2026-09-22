/**
 * Presentation helpers.
 *
 * Two rules, and they are independent of each other:
 *
 *   * **Timezone is the business's**, always, and is passed explicitly. It is
 *     never the device's and it never comes from the locale. Switching the
 *     interface to English must not move an appointment.
 *
 *   * **Locale is the reader's**, and is also passed explicitly. Nothing here
 *     reaches for a default, because a default is how `es-DO` ended up baked
 *     into every call site in the first place.
 *
 * Screens do not call these directly; `useFormat()` binds the current locale
 * so a screen cannot forget to pass one.
 */

export function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    // An unknown currency code should not crash a booking page.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/**
 * Durations read as numbers plus a unit, which is close enough to universal
 * to leave to Intl's unit formatting rather than to a translation key.
 */
export function formatDuration(minutes: number, locale: string): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  const unit = (value: number, which: 'hour' | 'minute') => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: which,
        unitDisplay: 'short',
      }).format(value);
    } catch {
      return `${value} ${which === 'hour' ? 'h' : 'min'}`;
    }
  };

  if (minutes < 60) return unit(minutes, 'minute');
  if (rest === 0) return unit(hours, 'hour');
  return `${unit(hours, 'hour')} ${unit(rest, 'minute')}`;
}

/** Always renders in the business timezone, never the device one. */
export function formatTimeIn(instant: Date, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}

export function formatDateIn(instant: Date, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(instant);
}

/**
 * Short date and time together, for history lines where a move may cross a
 * day and "10:00 to 14:00" would be a lie.
 */
export function formatDateTimeIn(instant: Date, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}
