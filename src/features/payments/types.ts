import type { PaymentStatus } from '@/types/domain';

/**
 * An amount of money, as the database wrote it.
 *
 * `amount` is an exact decimal string -- `"1000.00"` -- and stays one. It is
 * never parsed into a number to be added to anything, because the only place
 * this product does arithmetic with money is SQL, on `numeric`, where it is
 * exact. Display goes through `formatMoney`, which is the one function allowed
 * to turn it into something a person reads.
 */
export interface Money {
  amount: string;
  currency: string;
}

/**
 * What a service asks for before it is booked.
 *
 * Mirrors the `payment_requirement` enum. These are identities, not words for
 * a reader: the sentence a customer sees is produced from one of these by the
 * translation dictionary, in their language.
 */
export const PAYMENT_REQUIREMENTS = ['none', 'deposit', 'full'] as const;
export type PaymentRequirement = (typeof PAYMENT_REQUIREMENTS)[number];

/** The scenarios a provider can put a customer through, and the mock can too. */
export const PAYMENT_SCENARIOS = ['success', 'decline', 'pending', 'failure'] as const;
export type PaymentScenario = (typeof PAYMENT_SCENARIOS)[number];

export interface PaymentIntent {
  id: string;
  appointmentId: string;
  provider: string;
  providerReference: string | null;
  amount: Money;
  status: PaymentStatus;
  failureCode?: string;
}

export interface CreatePaymentInput {
  appointmentId: string;
  amount: Money;
  /** Where the provider should send the customer back to, when it redirects. */
  returnUrl?: string;
  /**
   * Stable across retries of the same request, so a provider that honours it
   * cannot turn our second attempt into the customer's second charge.
   */
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface ConfirmPaymentInput {
  paymentId: string;
  idempotencyKey: string;
  /** Opaque provider payload: a token, a 3-D Secure result, a webhook body. */
  providerPayload?: Record<string, unknown>;
}

export interface RefundPaymentInput {
  paymentId: string;
  /** Omit to refund the whole amount. Partial refunds are not supported yet. */
  amount?: Money;
  reason?: string;
  idempotencyKey: string;
}

/**
 * The seam every payment provider plugs into.
 *
 * Four verbs, chosen because every gateway worth integrating has all four
 * under some name: take a payment, finish it, ask about it, give it back.
 * Nothing here is borrowed from one provider's vocabulary -- there is no
 * "payment intent confirmation method", no "source", no "charge" -- because a
 * name from one gateway is a sentence the next one does not speak.
 *
 * Provider-specific payloads stay behind this boundary. No screen imports a
 * provider, and no screen knows whether it is talking to Azul, CardNET,
 * Stripe or the mock.
 */
export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<PaymentIntent>;
  confirmPayment(input: ConfirmPaymentInput): Promise<PaymentIntent>;
  getPaymentStatus(paymentId: string): Promise<PaymentIntent>;
  refundPayment(input: RefundPaymentInput): Promise<PaymentIntent>;
}

/**
 * A provider that did not do what was asked.
 *
 * `retryable` separates "the network was having a moment" from "that card is
 * not going to work". The first deserves another go; the second is an answer.
 */
export class PaymentProviderError extends Error {
  readonly provider: string;
  readonly retryable: boolean;
  readonly code?: string;

  constructor(
    provider: string,
    message: string,
    options: { retryable?: boolean; code?: string } = {},
  ) {
    super(message);
    this.name = 'PaymentProviderError';
    this.provider = provider;
    this.retryable = options.retryable ?? false;
    this.code = options.code;
  }
}

/**
 * Legal transitions of a payment.
 *
 * The database enforces this too, in `payment_transition_is_allowed`, and the
 * two must agree: this copy is what stops a provider adapter inventing its own
 * lifecycle before the database gets a chance to refuse it. A test asserts
 * they say the same thing.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['requires_action', 'authorized', 'paid', 'failed', 'cancelled'],
  requires_action: ['authorized', 'paid', 'failed', 'cancelled'],
  authorized: ['paid', 'failed', 'cancelled'],
  paid: ['refunded'],
  failed: [],
  refunded: [],
  cancelled: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** Statuses a customer can still do something about. */
export function isPayable(status: PaymentStatus): boolean {
  return status === 'pending' || status === 'requires_action';
}

/** Statuses that mean the money arrived and stayed. */
export function isSettled(status: PaymentStatus): boolean {
  return status === 'paid';
}
