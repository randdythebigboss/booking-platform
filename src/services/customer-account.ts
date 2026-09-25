import { getSupabase } from '@/lib/supabase';
import type { AppointmentStatus } from '@/types/domain';

export interface CustomerAppointment {
  appointmentId: string;
  businessSlug: string;
  businessName: string;
  businessTimezone: string;
  professionalName: string;
  serviceName: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  /**
   * Their own booking credential, so the confirmation screen -- and moving
   * and cancelling with it -- keeps working unchanged from the list.
   */
  accessToken: string;
}

/**
 * Every appointment belonging to the signed-in customer, across every
 * business they have ever booked with.
 *
 * An account is optional and always will be: booking as a guest needs a name
 * and a phone number and nothing else. This exists for the customer who wants
 * to find their appointments again without hunting for a link in their
 * messages.
 */
export async function fetchMyAppointments(): Promise<CustomerAppointment[]> {
  const { data, error } = await getSupabase().rpc('my_appointments');
  if (error) throw error;
  if (!Array.isArray(data)) return [];

  return data.map((entry) => {
    const row = entry as Record<string, unknown>;
    return {
      appointmentId: String(row.appointment_id),
      businessSlug: String(row.business_slug),
      businessName: String(row.business_name),
      businessTimezone: String(row.business_timezone),
      professionalName: String(row.professional_name ?? ''),
      serviceName: String(row.service_name ?? ''),
      startsAt: new Date(String(row.starts_at)),
      endsAt: new Date(String(row.ends_at)),
      status: row.status as AppointmentStatus,
      accessToken: String(row.access_token),
    };
  });
}

/**
 * Attaches one appointment to the signed-in account.
 *
 * Proven by the booking credential, because whoever holds that link can
 * already read, move and cancel the appointment -- so holding it is proof
 * enough to say "this one is mine". The same call serves two moments that
 * look different and are the same thing: a signed-in customer finishing a
 * booking, and somebody who booked as a guest last week signing up today and
 * opening their old link.
 *
 * Returns false when the credential does not match, and also when the
 * customer record already belongs to a different account -- reassigning it
 * would hand one person another person's history.
 */
export async function claimAppointment(params: {
  appointmentId: string;
  accessToken: string;
}): Promise<boolean> {
  const { data, error } = await getSupabase().rpc('claim_appointment', {
    p_appointment_id: params.appointmentId,
    p_access_token: params.accessToken,
  });

  if (error) throw error;
  return data === true;
}
