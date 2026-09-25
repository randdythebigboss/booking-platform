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

/**
 * Money, in one place.
 *
 * The database is the authority on every amount, and it keeps them as exact
 * `numeric`. They arrive here as the decimal string PostgreSQL wrote -- never
 * summed, compared or rounded on the way -- and this is the only function that
 * turns one into something a person reads.
 *
 * Two consequences worth stating out loud:
 *
 *   * **No arithmetic happens in TypeScript.** What a deposit leaves owing is
 *     computed in SQL, where it is exact. A float can hold 0.1 + 0.2 and this
 *     product will never ask it to.
 *   * **Nothing here knows how many decimals a currency has.** Intl does, per
 *     currency: DOP and USD get two, JPY gets none, KWD gets three. Hardcoding
 *     two would be right until the first business that is not in this region.
 */
export function formatMoney(amount: string | number, currency: string, locale: string): string {
  // Parsed once, for display only. Any amount this product will see is far
  // inside the range a double represents exactly, and nothing downstream does
  // arithmetic with it.
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return `${amount} ${currency}`;

  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    // An unknown currency code should not crash a booking page.
    return `${value.toFixed(2)} ${currency}`;
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

/**
 * Always renders in the business timezone, never the device one.
 *
 * Two deliberate departures from what Intl hands back for `es-DO`:
 *
 *   * The hour is not zero-padded. `02:45 p. m.` is a timestamp; `2:45 p.m.`
 *     is a time somebody says out loud.
 *   * The spaces inside the day period go. CLDR puts a full space in `p. m.`,
 *     which made the string wide enough to wrap onto two lines in the fixed
 *     time column of an appointment row -- the column that exists so a list
 *     lines up down its left edge.
 *
 * Nothing else is touched: the order of the parts, the separator and whether
 * there is a day period at all remain the locale's business, so a 24-hour
 * language still gets `14:45`.
 */
export function formatTimeIn(instant: Date, timezone: string, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(instant);

  return parts
    .map((part) => (part.type === 'dayPeriod' ? part.value.replace(/\s+/gu, '') : part.value))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
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
 * A day and its month, short: `26 sept`.
 *
 * For a list row where the date is secondary to the time and has to fit in a
 * narrow column beside it without wrapping.
 */
export function formatDayAndMonthIn(instant: Date, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
  }).format(instant);
}

/**
 * The weekday on its own, short: `sáb`. For a calendar strip.
 */
export function formatWeekdayIn(instant: Date, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: 'short' }).format(instant);
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

/**
 * The mark a currency is written with, for a form label.
 *
 * `Precio en DOP` is a code from a standards document; `Precio en RD$` is what
 * is written on the price list on the wall. Intl already knows the pairing for
 * every currency it supports, so this asks it rather than keeping a table that
 * would be wrong for the first business outside this region.
 *
 * Falls back to the code itself, which is always better than nothing.
 */
export function currencySymbol(currency: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/**
 * A clock reading with no am/pm: `9:00`, `12:15`, `5:30`.
 *
 * For a grid of times that already sits under a heading saying *Morning* or
 * *Afternoon*. Repeating "a. m." on every one of forty chips costs half the
 * width of each and tells the reader nothing the heading has not already said.
 * The spoken label beside them keeps the full time, because a screen reader
 * user reaches a chip without the heading in the same breath.
 *
 * Built from parts rather than by cutting up a formatted string: the separator
 * between hour and minute is a locale's business, and some are not a colon.
 */
export function formatClockIn(instant: Date, timezone: string, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(instant);

  return (
    parts
      .filter((part) => part.type === 'hour' || part.type === 'minute' || part.type === 'literal')
      .map((part) => part.value)
      .join('')
      .trim()
      // A trailing separator is what is left where the day period used to be.
      .replace(/[\s,:.]+$/u, '')
  );
}
