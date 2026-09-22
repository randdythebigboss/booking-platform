import {
  PaymentProviderError,
  canTransition,
  type ConfirmPaymentInput,
  type CreatePaymentInput,
  type PaymentIntent,
  type PaymentProvider,
  type PaymentScenario,
  type RefundPaymentInput,
} from './types';

let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${String(counter).padStart(6, '0')}`;
}

/**
 * The provider the product develops against.
 *
 * It moves no money and needs no account, which is the point: every path a
 * real gateway can put a customer through can be exercised, in tests and in a
 * browser, before anybody signs anything.
 *
 * The scenarios are the ones that actually happen:
 *
 *   success   the money moved
 *   decline   the bank said no. Not retryable: the answer will not change
 *   pending   accepted, outcome later -- a challenge, a bank app, a redirect
 *   failure   the provider itself was unreachable. Retryable: nothing was
 *             decided, and the customer may try again
 *
 * `scenario` is chosen per payment by whatever is driving the test, never by
 * a customer: in the product it is the database switch
 * `platform_settings.payment_simulation_enabled` that decides whether a
 * simulated outcome is accepted at all.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  private readonly payments = new Map<string, PaymentIntent>();
  private readonly scenarios = new Map<string, PaymentScenario>();
  private readonly seen = new Map<string, PaymentIntent>();

  /** What an unscripted confirmation does. */
  defaultScenario: PaymentScenario = 'success';

  /** Makes one payment behave a particular way when it is confirmed. */
  scheduleScenario(paymentId: string, scenario: PaymentScenario): void {
    this.scenarios.set(paymentId, scenario);
  }

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    const previous = this.seen.get(input.idempotencyKey);
    if (previous) return previous;

    if (Number(input.amount.amount) <= 0) {
      throw new PaymentProviderError(this.name, 'Amount must be more than nothing.', {
        code: 'INVALID_AMOUNT',
      });
    }

    const intent: PaymentIntent = {
      id: nextId('mockpay'),
      appointmentId: input.appointmentId,
      provider: this.name,
      providerReference: nextId('mockref'),
      amount: input.amount,
      status: 'pending',
    };

    this.payments.set(intent.id, intent);
    this.seen.set(input.idempotencyKey, intent);
    return intent;
  }

  async confirmPayment(input: ConfirmPaymentInput): Promise<PaymentIntent> {
    // A provider that honours an idempotency key answers the second delivery
    // with the first result rather than charging again.
    const previous = this.seen.get(input.idempotencyKey);
    if (previous) return previous;

    const intent = this.require(input.paymentId);
    const scenario = this.scenarios.get(intent.id) ?? this.defaultScenario;

    if (scenario === 'failure') {
      // Nothing was decided, so nothing is recorded and nothing is idempotent
      // about it. The customer may try again.
      throw new PaymentProviderError(this.name, 'The provider did not answer.', {
        retryable: true,
        code: 'PROVIDER_UNAVAILABLE',
      });
    }

    const settled =
      scenario === 'decline'
        ? this.transition(intent, 'failed', 'CARD_DECLINED')
        : scenario === 'pending'
          ? this.transition(intent, 'requires_action')
          : this.transition(intent, 'paid');

    this.seen.set(input.idempotencyKey, settled);
    return settled;
  }

  async getPaymentStatus(paymentId: string): Promise<PaymentIntent> {
    return this.require(paymentId);
  }

  async refundPayment(input: RefundPaymentInput): Promise<PaymentIntent> {
    const previous = this.seen.get(input.idempotencyKey);
    if (previous) return previous;

    const intent = this.require(input.paymentId);
    const scenario = this.scenarios.get(intent.id);

    if (scenario === 'failure') {
      throw new PaymentProviderError(this.name, 'The refund could not be sent.', {
        retryable: true,
        code: 'REFUND_UNAVAILABLE',
      });
    }

    const refunded = this.transition(intent, 'refunded');
    this.seen.set(input.idempotencyKey, refunded);
    return refunded;
  }

  /** Test helper: forget everything this provider has seen. */
  reset(): void {
    this.payments.clear();
    this.scenarios.clear();
    this.seen.clear();
    this.defaultScenario = 'success';
  }

  private require(paymentId: string): PaymentIntent {
    const intent = this.payments.get(paymentId);
    if (!intent) {
      throw new PaymentProviderError(this.name, `Unknown payment: ${paymentId}.`, {
        code: 'NOT_FOUND',
      });
    }
    return intent;
  }

  private transition(
    intent: PaymentIntent,
    status: PaymentIntent['status'],
    failureCode?: string,
  ): PaymentIntent {
    if (!canTransition(intent.status, status)) {
      throw new PaymentProviderError(
        this.name,
        `Cannot move a payment from "${intent.status}" to "${status}".`,
        { code: 'INVALID_TRANSITION' },
      );
    }

    const updated: PaymentIntent = {
      ...intent,
      status,
      ...(failureCode ? { failureCode } : {}),
    };
    this.payments.set(updated.id, updated);
    return updated;
  }
}
