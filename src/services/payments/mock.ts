import {
  PaymentProviderError,
  canTransition,
  type ConfirmPaymentInput,
  type CreatePaymentInput,
  type PaymentIntent,
  type PaymentProvider,
  type RefundPaymentInput,
} from './types';

let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${String(counter).padStart(6, '0')}`;
}

/**
 * In-memory payment provider used until a real one is wired up.
 *
 * It exists so that the booking flow, the payment state machine and the tests
 * can all be finished before anyone signs a contract with a processor.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  private readonly payments = new Map<string, PaymentIntent>();

  /** Set to make the next `confirmPayment` fail, for testing error paths. */
  failNextConfirmation = false;

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    if (input.amount.amountInCents < 0) {
      throw new PaymentProviderError(this.name, 'Amount cannot be negative.');
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
    return intent;
  }

  async confirmPayment(input: ConfirmPaymentInput): Promise<PaymentIntent> {
    const intent = this.require(input.paymentId);
    const target = this.failNextConfirmation ? 'failed' : 'paid';
    this.failNextConfirmation = false;

    return this.transition(
      intent,
      target,
      target === 'failed' ? 'Declined by mock provider.' : undefined,
    );
  }

  async refundPayment(input: RefundPaymentInput): Promise<PaymentIntent> {
    const intent = this.require(input.paymentId);
    return this.transition(intent, 'refunded', input.reason);
  }

  async getPaymentStatus(paymentId: string): Promise<PaymentIntent> {
    return this.require(paymentId);
  }

  /** Test helper: forget everything this provider has seen. */
  reset(): void {
    this.payments.clear();
    this.failNextConfirmation = false;
  }

  private require(paymentId: string): PaymentIntent {
    const intent = this.payments.get(paymentId);
    if (!intent) {
      throw new PaymentProviderError(this.name, `Unknown payment: ${paymentId}.`);
    }
    return intent;
  }

  private transition(
    intent: PaymentIntent,
    status: PaymentIntent['status'],
    failureReason?: string,
  ): PaymentIntent {
    if (!canTransition(intent.status, status)) {
      throw new PaymentProviderError(
        this.name,
        `Cannot move a payment from "${intent.status}" to "${status}".`,
      );
    }

    const updated: PaymentIntent = {
      ...intent,
      status,
      ...(failureReason ? { failureReason } : {}),
    };
    this.payments.set(updated.id, updated);
    return updated;
  }
}
