import type { AppointmentEvent } from '@/features/appointments';
import { toWorkspaceError } from '@/features/workspace';
import { getSupabase } from '@/lib/supabase';
import type { AppointmentStatus } from '@/types/domain';

export interface AppointmentCustomer {
  fullName: string;
  phone: string;
  email: string | null;
}

export interface AppointmentItem {
  serviceId: string | null;
  name: string;
  durationMinutes: number;
  price: number;
  currency: string;
}

export interface ProfessionalAppointment {
  id: string;
  professionalId: string;
  professionalName: string | null;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  notes: string | null;
  cancellationReason: string | null;
  customer: AppointmentCustomer;
  items: AppointmentItem[];
}

const COLUMNS =
  'id, professional_id, starts_at, ends_at, status, notes, cancellation_reason,' +
  ' customers ( full_name, phone, email ),' +
  ' professional_profiles ( display_name ),' +
  ' appointment_items ( service_id, service_name_snapshot, duration_minutes_snapshot, price_snapshot, currency_snapshot )';

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function toAppointment(row: Record<string, any>): ProfessionalAppointment {
  const customer = first<Record<string, any>>(row.customers);
  const professional = first<Record<string, any>>(row.professional_profiles);

  return {
    id: String(row.id),
    professionalId: String(row.professional_id),
    professionalName: professional ? String(professional.display_name) : null,
    startsAt: new Date(String(row.starts_at)),
    endsAt: new Date(String(row.ends_at)),
    status: row.status as AppointmentStatus,
    notes: row.notes ?? null,
    cancellationReason: row.cancellation_reason ?? null,
    customer: {
      fullName: customer ? String(customer.full_name) : 'Unknown',
      phone: customer ? String(customer.phone) : '',
      email: customer?.email ?? null,
    },
    items: (row.appointment_items ?? []).map((item: Record<string, any>) => ({
      serviceId: item.service_id ? String(item.service_id) : null,
      name: String(item.service_name_snapshot),
      durationMinutes: Number(item.duration_minutes_snapshot),
      price: Number(item.price_snapshot),
      currency: String(item.currency_snapshot),
    })),
  };
}

export interface AppointmentQuery {
  businessId: string;
  /** Inclusive lower bound on start time. */
  from?: Date;
  /** Exclusive upper bound on start time. */
  to?: Date;
  statuses?: AppointmentStatus[];
  /** Newest first is right for history; oldest first for what is coming. */
  ascending?: boolean;
  limit?: number;
}

/**
 * Appointments for one business.
 *
 * Row Level Security scopes this to businesses the caller belongs to; the
 * business_id filter is for the query, not for the authorization.
 */
export async function fetchAppointments(
  query: AppointmentQuery,
): Promise<ProfessionalAppointment[]> {
  let request = getSupabase()
    .from('appointments')
    .select(COLUMNS)
    .eq('business_id', query.businessId);

  if (query.from) request = request.gte('starts_at', query.from.toISOString());
  if (query.to) request = request.lt('starts_at', query.to.toISOString());
  if (query.statuses && query.statuses.length > 0) request = request.in('status', query.statuses);

  request = request
    .order('starts_at', { ascending: query.ascending ?? true })
    .limit(query.limit ?? 200);

  const { data, error } = await request;
  if (error) throw toWorkspaceError(error);

  return (data ?? []).map((row) => toAppointment(row as Record<string, any>));
}

export async function fetchAppointment(id: string): Promise<ProfessionalAppointment | null> {
  const { data, error } = await getSupabase()
    .from('appointments')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw toWorkspaceError(error);
  return data ? toAppointment(data as Record<string, any>) : null;
}

/**
 * Moves an appointment through its lifecycle.
 *
 * Deliberately narrow: the RPC touches status and the cancellation reason and
 * nothing else, so changing a status can never become a way to rewrite a time,
 * a customer or a price.
 */
export async function setAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
  reason?: string,
): Promise<void> {
  const { error } = await getSupabase().rpc('set_appointment_status', {
    p_appointment_id: appointmentId,
    p_status: status,
    p_reason: reason ?? null,
  });

  if (error) throw toWorkspaceError(error);
}

/**
 * Moves an appointment without it ever ceasing to exist.
 *
 * The backend does this as a single UPDATE guarded by the same exclusion
 * constraint that prevents double booking, so either the appointment holds the
 * new time or it still holds the old one. A lost race raises `SLOT_TAKEN` and
 * changes nothing.
 *
 * `allowOutsideHours` is the professional saying they meant it. It relaxes
 * working hours and nothing else: a block, another appointment and another
 * tenant's calendar stay off limits.
 */
export async function rescheduleAppointment(params: {
  appointmentId: string;
  startsAt: Date;
  reason?: string;
  allowOutsideHours?: boolean;
}): Promise<void> {
  const { error } = await getSupabase().rpc('reschedule_appointment', {
    p_appointment_id: params.appointmentId,
    p_starts_at: params.startsAt.toISOString(),
    p_reason: params.reason ?? null,
    p_override_schedule: params.allowOutsideHours ?? false,
  });

  if (error) throw toWorkspaceError(error);
}

export interface ManualAppointmentInput {
  professionalId: string;
  serviceId: string;
  startsAt: Date;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  notes?: string;
  allowOutsideHours?: boolean;
}

/**
 * The professional entering an appointment themselves: a phone call, a
 * walk-in, a regular.
 *
 * Deliberately not the same function the public page calls. It arrives
 * confirmed, it is not held to the published slot grid, and it may fall
 * outside working hours if the professional says so -- none of which are
 * relaxations the guest path would ever be given.
 */
export async function createManualAppointment(input: ManualAppointmentInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_manual_appointment', {
    p_professional_id: input.professionalId,
    p_service_id: input.serviceId,
    p_starts_at: input.startsAt.toISOString(),
    p_customer_name: input.customerName,
    p_customer_phone: input.customerPhone,
    p_customer_email: input.customerEmail ?? null,
    p_notes: input.notes ?? null,
    p_override_schedule: input.allowOutsideHours ?? false,
  });

  if (error) throw toWorkspaceError(error);
  return String((data as Record<string, unknown>).appointmentId);
}

/**
 * The appointment's history.
 *
 * Readable only by members of the business -- there is no policy for anyone
 * else, and no write policy for anybody at all.
 */
export async function fetchAppointmentEvents(appointmentId: string): Promise<AppointmentEvent[]> {
  const { data, error } = await getSupabase()
    .from('appointment_events')
    .select(
      'id, event_type, actor_type, occurred_at, previous_status, new_status,' +
        ' previous_starts_at, new_starts_at, reason',
    )
    .eq('appointment_id', appointmentId)
    .order('occurred_at', { ascending: true });

  if (error) throw toWorkspaceError(error);

  return (data ?? []).map((raw) => {
    const row = raw as Record<string, any>;
    return {
      id: String(row.id),
      type: row.event_type as AppointmentEvent['type'],
      actor: row.actor_type as AppointmentEvent['actor'],
      occurredAt: new Date(String(row.occurred_at)),
      previousStatus: (row.previous_status ?? null) as AppointmentStatus | null,
      newStatus: (row.new_status ?? null) as AppointmentStatus | null,
      previousStartsAt: row.previous_starts_at ? new Date(String(row.previous_starts_at)) : null,
      newStartsAt: row.new_starts_at ? new Date(String(row.new_starts_at)) : null,
      reason: row.reason ?? null,
    };
  });
}
