import {
  parseGuestAppointment,
  toBookingError,
  type GuestAppointment,
} from '@/features/booking';
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
