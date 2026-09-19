import type { PaymentStatus } from '@/types/domain';

/** Money is kept in minor units to stay clear of floating point. */
export interface Money {
  amountInCents: number;
  currency: string;
}

export interface PaymentIntent {
  id: string;
  appointmentId: string;
  provider: string;
  providerReference: string | null;
  amount: Money;
  status: PaymentStatus;
  failureReason?: string;
}

export interface CreatePaymentInput {
  appointmentId: string;
  amount: Money;
  /** Where the provider should send the customer back to, when it redirects. */
  returnUrl?: string;
  metadata?: Record<string, string>;
}

export interface ConfirmPaymentInput {
  paymentId: string;
  /** Opaque provider payload: a token, a 3-D Secure result, a webhook body. */
  providerPayload?: Record<string, unknown>;
}

export interface RefundPaymentInput {
  paymentId: string;
  /** Omit to refund the full amount. */
  amount?: Money;
  reason?: string;
}

/**
 * The seam every payment provider plugs into.
 *
 * No screen may import a provider directly: they take a `PaymentProvider` and
 * stay unaware of whether it is Azul, CardNET, Stripe or the mock. Adding a
 * provider must never mean touching the booking flow.
 */
export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<PaymentIntent>;
  confirmPayment(input: ConfirmPaymentInput): Promise<PaymentIntent>;
  refundPayment(input: RefundPaymentInput): Promise<PaymentIntent>;
  getPaymentStatus(paymentId: string): Promise<PaymentIntent>;
}

export class PaymentProviderError extends Error {
  readonly provider: string;

  constructor(provider: string, message: string) {
    super(message);
    this.name = 'PaymentProviderError';
    this.provider = provider;
  }
}

/**
 * Legal transitions of a payment. Everything else is a bug, and the mock
 * provider refuses it loudly so that a real provider adapter cannot quietly
 * invent its own lifecycle.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['authorized', 'paid', 'failed', 'cancelled'],
  authorized: ['paid', 'failed', 'cancelled'],
  paid: ['refunded'],
  failed: [],
  refunded: [],
  cancelled: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}
