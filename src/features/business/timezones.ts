/**
 * A short list of IANA timezones for the picker.
 *
 * The column accepts any zone PostgreSQL recognises -- a trigger rejects the
 * rest -- so this is a convenience, not a constraint. Latin America and the
 * Caribbean first, because that is where the first businesses are.
 */
export const COMMON_TIMEZONES = [
  'America/Santo_Domingo',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Puerto_Rico',
  'America/Panama',
  'America/Bogota',
  'America/Caracas',
  'America/Mexico_City',
  'America/Lima',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/Sao_Paulo',
  'Europe/Madrid',
  'Europe/London',
  'UTC',
] as const;

/** The device's own zone, when it is one PostgreSQL will accept. */
export function detectTimezone(fallback = 'America/Santo_Domingo'): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved && resolved.includes('/') ? resolved : fallback;
  } catch {
    return fallback;
  }
}

/** Renders `America/Santo_Domingo` as `America - Santo Domingo`. */
export function formatTimezoneLabel(timezone: string): string {
  return timezone.split('/').join(' - ').replace(/_/g, ' ');
}
