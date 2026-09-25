import {
  parseAvailabilityContext,
  parseDaySlotRows,
  parseSlotRows,
  type AvailabilityContext,
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
