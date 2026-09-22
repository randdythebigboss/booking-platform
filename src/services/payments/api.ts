import { toBookingError } from '@/features/booking';
import { toWorkspaceError } from '@/features/workspace';
import { getSupabase } from '@/lib/supabase';
import type { PaymentStatus } from '@/types/domain';

import type { PaymentRequirement, PaymentScenario } from '@/features/payments';

/**
 * Talking to the database about money.
 *
 * Every amount here is read, never sent: nothing in this file gives the server
 * a price, a currency or a status. The only things a caller supplies are which
 * appointment, which token, and -- in development -- which outcome to simulate.
 */

export interface GuestPaymentSummary {
  required: boolean;
  paymentId?: string;
  status?: PaymentStatus;
  requirement?: PaymentRequirement;
  /** Exact decimals, as the database wrote them. */
  amount?: string;
  currency?: string;
  servicePrice?: string;
  remaining?: string;
  failureCode?: string | null;
  holdExpiresAt?: Date | null;
  /**
   * Whether this deployment accepts simulated payments.
   *
   * The same switch decides whether the buttons are drawn and whether the
   * server would accept what they do, so a production build cannot end up
   * showing a control that works.
   */
  simulationEnabled?: boolean;
}

function toSummary(raw: unknown): GuestPaymentSummary {
  const data = (raw ?? {}) as Record<string, unknown>;
  if (data.required !== true) return { required: false };

  return {
    required: true,
    paymentId: String(data.paymentId),
    status: data.status as PaymentStatus,
    requirement: data.requirement as PaymentRequirement,
    amount: String(data.amount),
    currency: String(data.currency),
    servicePrice: data.servicePrice == null ? undefined : String(data.servicePrice),
    remaining: data.remaining == null ? undefined : String(data.remaining),
    failureCode: (data.failureCode as string | null) ?? null,
    holdExpiresAt: data.holdExpiresAt ? new Date(String(data.holdExpiresAt)) : null,
    simulationEnabled: data.simulationEnabled === true,
  };
}

export interface PaymentCapabilities {
  /** Whether anything at all can take a payment here. */
  available: boolean;
  /** Whether what would take it is the demonstration provider. */
  demo: boolean;
}

/**
 * What this deployment can do about money.
 *
 * Asked of the server rather than read from a build flag, for the same reason
 * the simulator is server-side: a flag baked into a bundle is a flag somebody
 * forgets to change, and the thing it would be wrong about is whether a
 * customer is told their money is real.
 */
export async function fetchPaymentCapabilities(): Promise<PaymentCapabilities> {
  const { data, error } = await getSupabase().rpc('payment_capabilities');

  // A deployment we cannot ask is a deployment that cannot take money: the
  // safe answer is "no payments", never "assume it works".
  if (error) return { available: false, demo: false };

  const result = (data ?? {}) as Record<string, unknown>;
  return { available: result.available === true, demo: result.demo === true };
}

export async function fetchPaymentByToken(
  appointmentId: string,
  accessToken: string,
): Promise<GuestPaymentSummary> {
  const { data, error } = await getSupabase().rpc('get_payment_by_token', {
    p_appointment_id: appointmentId,
    p_access_token: accessToken,
  });

  if (error) throw toBookingError(error);
  return toSummary(data);
}

/**
 * Puts a simulated outcome through the provider that is not there.
 *
 * The scenario is what a gateway would have decided; the server refuses the
 * whole call unless this deployment has simulation switched on.
 */
export async function simulatePayment(
  appointmentId: string,
  accessToken: string,
  scenario: PaymentScenario,
  idempotencyKey: string,
): Promise<{ paymentId: string; status: PaymentStatus; failureCode: string | null }> {
  const { data, error } = await getSupabase().rpc('simulate_payment_by_token', {
    p_appointment_id: appointmentId,
    p_access_token: accessToken,
    p_scenario: scenario,
    p_idempotency_key: idempotencyKey,
  });

  if (error) throw toBookingError(error);

  const result = (data ?? {}) as Record<string, unknown>;
  return {
    paymentId: String(result.paymentId),
    status: result.status as PaymentStatus,
    failureCode: (result.failureCode as string | null) ?? null,
  };
}

/** Another attempt after a decline. A new payment, with the same amount. */
export async function retryPayment(
  appointmentId: string,
  accessToken: string,
): Promise<{ paymentId: string; status: PaymentStatus }> {
  const { data, error } = await getSupabase().rpc('retry_payment_by_token', {
    p_appointment_id: appointmentId,
    p_access_token: accessToken,
  });

  if (error) throw toBookingError(error);

  const result = (data ?? {}) as Record<string, unknown>;
  return { paymentId: String(result.paymentId), status: result.status as PaymentStatus };
}

export interface ProfessionalPayment {
  id: string;
  status: PaymentStatus;
  requirement: PaymentRequirement;
  amount: string;
  currency: string;
  provider: string;
  failureCode: string | null;
  paidAt: Date | null;
  refundedAt: Date | null;
  refundedAmount: string | null;
}

function toProfessionalPayment(row: Record<string, any>): ProfessionalPayment {
  return {
    id: String(row.id),
    status: row.status as PaymentStatus,
    requirement: row.requirement as PaymentRequirement,
    amount: String(row.amount),
    currency: String(row.currency),
    provider: String(row.provider),
    failureCode: row.failure_code ?? null,
    paidAt: row.paid_at ? new Date(String(row.paid_at)) : null,
    refundedAt: row.refunded_at ? new Date(String(row.refunded_at)) : null,
    refundedAmount: row.refunded_amount == null ? null : String(row.refunded_amount),
  };
}

/** Every attempt on an appointment, newest first. Read through RLS. */
export async function fetchAppointmentPayments(
  appointmentId: string,
): Promise<ProfessionalPayment[]> {
  const { data, error } = await getSupabase()
    .from('payments')
    .select(
      'id, status, requirement, amount, currency, provider, failure_code, paid_at, refunded_at, refunded_amount',
    )
    .eq('appointment_id', appointmentId)
    .order('created_at', { ascending: false });

  if (error) throw toWorkspaceError(error);
  return (data ?? []).map(toProfessionalPayment);
}

/**
 * Giving the money back, which is a decision and never a side effect.
 *
 * Cancelling an appointment does not call this, and this does not cancel an
 * appointment. See ADR 0023.
 */
export async function refundPayment(paymentId: string, reason?: string): Promise<PaymentStatus> {
  const { data, error } = await getSupabase().rpc('refund_payment', {
    p_payment_id: paymentId,
    p_reason: reason ?? null,
  });

  if (error) throw toWorkspaceError(error);
  return ((data ?? {}) as Record<string, unknown>).status as PaymentStatus;
}
