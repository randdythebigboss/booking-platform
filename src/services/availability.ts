import {
  addDays,
  parseAvailabilityContext,
  parseWeekAvailabilityRows,
  parseDaySlotRows,
  parseSlotRows,
  type AvailabilityContext,
  type DayAvailability,
  type DayAvailabilitySummary,
  type DaySlot,
  type Slot,
} from '@/features/availability';
import { getSupabase } from '@/lib/supabase';
import type { IsoDate } from '@/types/domain';

/**
 * One round trip covers a whole date range; slots for each individual day are
 * then computed locally by the engine, so moving between days in the calendar
 * costs nothing.
 */
export async function fetchAvailabilityContext(params: {
  professionalId: string;
  serviceId: string;
  from: IsoDate;
  to: IsoDate;
}): Promise<AvailabilityContext> {
  const { data, error } = await getSupabase().rpc('get_availability_context', {
    p_professional_id: params.professionalId,
    p_service_id: params.serviceId,
    p_from: params.from,
    p_to: params.to,
  });

  if (error) throw error;
  return parseAvailabilityContext(data);
}

/**
 * The authoritative list of bookable start times for one professional, one
 * service and one business-local date.
 *
 * This is the same answer the booking page will get in Phase 3, computed by
 * the database from the same rules book_appointment enforces. A hidden or
 * mismatched resource comes back as an empty list rather than an error, so
 * nothing is revealed about why.
 */
export async function fetchAvailableSlots(params: {
  professionalId: string;
  serviceId: string;
  date: IsoDate;
}): Promise<Slot[]> {
  const { data, error } = await getSupabase().rpc('get_available_slots', {
    p_professional_id: params.professionalId,
    p_service_id: params.serviceId,
    p_date: params.date,
  });

  if (error) throw error;
  return parseSlotRows(data ?? []);
}

/**
 * Every slot in a day, each with why it can or cannot be booked.
 *
 * `fetchAvailableSlots` answers "what may I book?"; this answers "what does
 * this day look like?". A customer shown four times out of an eight-hour day
 * cannot tell whether the shop is busy or barely open, and the difference
 * changes what they do next.
 *
 * The database returns a state and nothing else about a busy slot -- no name,
 * no service, no id, not even a count. That is deliberate and is the only
 * privacy-safe way to show a full calendar to the public.
 */
export async function fetchDaySchedule(params: {
  professionalId: string;
  serviceId: string;
  date: IsoDate;
}): Promise<DaySlot[]> {
  const { data, error } = await getSupabase().rpc('get_day_schedule', {
    p_professional_id: params.professionalId,
    p_service_id: params.serviceId,
    p_date: params.date,
  });

  if (error) throw error;
  return parseDaySlotRows(data);
}

/**
 * How each day of a week looks, before the customer taps any of them.
 *
 * ---------------------------------------------------------------------------
 * Why there is a fallback
 * ---------------------------------------------------------------------------
 *
 * `get_week_availability` is one round trip and the right answer. A deployment
 * whose database has not had the migration applied yet does not have it, and
 * the honest choice there is the slow answer rather than no answer: the same
 * engine, one call per day, in parallel. The strip looks identical either way.
 *
 * `PGRST202` is PostgREST for "no function of that name and signature". Any
 * other failure is a real failure and is thrown. The answer is remembered for
 * the session, so a deployment without the migration pays for the discovery
 * once rather than logging a 404 on every week the customer looks at.
 */
let weekFunctionMissing = false;

export async function fetchWeekAvailability(params: {
  professionalId: string;
  serviceId: string;
  from: IsoDate;
  days: number;
}): Promise<DayAvailabilitySummary[]> {
  if (weekFunctionMissing) return fetchWeekAvailabilityOneDayAtATime(params);

  const { data, error } = await getSupabase().rpc('get_week_availability', {
    p_professional_id: params.professionalId,
    p_service_id: params.serviceId,
    p_from: params.from,
    p_days: params.days,
  });

  if (!error) return parseWeekAvailabilityRows(data);
  if (error.code !== 'PGRST202') throw error;

  weekFunctionMissing = true;
  return fetchWeekAvailabilityOneDayAtATime(params);
}

/** The same answer, the slow way, for a database without the function yet. */
async function fetchWeekAvailabilityOneDayAtATime(params: {
  professionalId: string;
  serviceId: string;
  from: IsoDate;
  days: number;
}): Promise<DayAvailabilitySummary[]> {
  const dates = Array.from({ length: params.days }, (_, index) => addDays(params.from, index));

  return Promise.all(
    dates.map(async (date): Promise<DayAvailabilitySummary> => {
      const slots = await fetchDaySchedule({
        professionalId: params.professionalId,
        serviceId: params.serviceId,
        date,
      });

      // `get_day_schedule` returns nothing at all for a day outside the
      // horizon or before today, which is the same shape as a closed day. The
      // caller can tell those apart from the dates themselves, and does.
      const freeCount = slots.filter((slot) => slot.state === 'available').length;
      const state: DayAvailability =
        slots.length === 0 ? 'closed' : freeCount === 0 ? 'full' : 'open';

      return { date, state, freeCount };
    }),
  );
}
