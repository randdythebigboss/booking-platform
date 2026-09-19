import { parseAvailabilityContext, type AvailabilityContext } from '@/features/availability';
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
