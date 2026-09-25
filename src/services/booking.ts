import { parseGuestAppointment, toBookingError, type GuestAppointment } from '@/features/booking';
import { getSupabase } from '@/lib/supabase';
import type { AppointmentStatus } from '@/types/domain';

export interface BookAppointmentInput {
  professionalId: string;
  serviceId: string;
  /** Absolute instant; the UI builds it from the business timezone. */
  startsAt: Date;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  notes?: string;
  /**
   * The language this booking is being made in.
   *
   * Recorded on the appointment and copied onto every message queued for it,
   * so a confirmation that is written later is still written in the language
   * the customer chose here. Omitted, the database records Spanish.
   */
  locale?: string;
}

export interface BookingConfirmation {
  appointmentId: string;
  accessToken: string;
  status: AppointmentStatus;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  businessName: string;
  professionalName: string;
  serviceName: string;
  price: number;
  currency: string;
}

function toConfirmation(raw: unknown): BookingConfirmation {
  const data = raw as Record<string, unknown>;
  return {
    appointmentId: String(data.appointmentId),
    accessToken: String(data.accessToken),
    status: data.status as AppointmentStatus,
    startsAt: new Date(String(data.startsAt)),
    endsAt: new Date(String(data.endsAt)),
    timezone: String(data.timezone),
    businessName: String(data.businessName),
    professionalName: String(data.professionalName),
    serviceName: String(data.serviceName),
    price: Number(data.price),
    currency: String(data.currency),
  };
}

/**
 * Creates an appointment.
 *
 * The whole operation happens inside one database transaction guarded by a
 * GiST exclusion constraint, so two customers racing for the same time can
 * never both succeed -- the loser gets `SLOT_TAKEN`.
 */
export async function bookAppointment(input: BookAppointmentInput): Promise<BookingConfirmation> {
  const { data, error } = await getSupabase().rpc('book_appointment', {
    p_professional_id: input.professionalId,
    p_service_id: input.serviceId,
    p_starts_at: input.startsAt.toISOString(),
    p_customer_name: input.customerName,
    p_customer_phone: input.customerPhone,
    p_customer_email: input.customerEmail ?? null,
    p_notes: input.notes ?? null,
    p_locale: input.locale ?? null,
  });

  if (error) throw toBookingError(error);
  return toConfirmation(data);
}

export async function fetchAppointmentByToken(
  appointmentId: string,
  accessToken: string,
): Promise<GuestAppointment> {
  const { data, error } = await getSupabase().rpc('get_appointment_by_token', {
    p_appointment_id: appointmentId,
    p_access_token: accessToken,
  });

  if (error) throw toBookingError(error);
  return parseGuestAppointment(data);
}

export async function cancelAppointmentByToken(
  appointmentId: string,
  accessToken: string,
  reason?: string,
): Promise<void> {
  const { error } = await getSupabase().rpc('cancel_appointment_by_token', {
    p_appointment_id: appointmentId,
    p_access_token: accessToken,
    p_reason: reason ?? null,
  });

  if (error) throw toBookingError(error);
}

/**
 * A guest moving their own appointment, holding only the booking link.
 *
 * The rules are exactly the public ones -- the grid, the notice period, the
 * horizon -- because the guest is choosing from what the public page offered
 * them. The move is one UPDATE: if the new time is taken, `SLOT_TAKEN` comes
 * back and the appointment is still at the time it had.
 */
export async function rescheduleAppointmentByToken(
  appointmentId: string,
  accessToken: string,
  startsAt: Date,
): Promise<void> {
  const { error } = await getSupabase().rpc('reschedule_appointment_by_token', {
    p_appointment_id: appointmentId,
    p_access_token: accessToken,
    p_starts_at: startsAt.toISOString(),
  });

  if (error) throw toBookingError(error);
}
