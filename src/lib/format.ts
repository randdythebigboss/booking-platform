/** Presentation helpers. Everything here is timezone-explicit on purpose. */

export function formatMoney(amount: number, currency: string, locale = 'es-DO'): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    // An unknown currency code should not crash a booking page.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Always renders in the business timezone, never the device one. */
export function formatTimeIn(instant: Date, timezone: string, locale = 'es-DO'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}

export function formatDateIn(instant: Date, timezone: string, locale = 'es-DO'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(instant);
}
