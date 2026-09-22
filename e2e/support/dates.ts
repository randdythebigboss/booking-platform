import { TENANT_A } from './fixtures';

/**
 * A date the seeded calendar is reliably open on.
 *
 * The fixtures make some days deliberately awkward -- Sunday is closed, there
 * is a block tomorrow at midday, a long lunch in three days and a day off in
 * twelve -- because availability has to be interesting for the availability
 * tests. A booking test does not want any of that; it wants a day with hours
 * on it, every time it runs.
 *
 * A week out clears all of them. Sunday is stepped over rather than worked
 * around, and the calculation happens in the business's timezone, because the
 * runner's own idea of "today" is not the one the calendar uses.
 */
export function openDateISO(daysAhead = 7, timezone: string = TENANT_A.timezone): string {
  const today = new Date(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()) + 'T12:00:00Z',
  );

  const target = new Date(today);
  target.setUTCDate(target.getUTCDate() + daysAhead);

  // 0 is Sunday, and the seeded week has no Sunday hours.
  if (target.getUTCDay() === 0) target.setUTCDate(target.getUTCDate() + 1);

  return target.toISOString().slice(0, 10);
}
