import {
  parseAvailabilityContext,
  parseSlotRows,
  type AvailabilityContext,
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
