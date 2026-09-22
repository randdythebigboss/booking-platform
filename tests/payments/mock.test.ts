import { beforeEach, describe, expect, it } from 'vitest';

import {
  MockPaymentProvider,
  PAYMENT_TRANSITIONS,
  PaymentProviderError,
  canTransition,
  isPayable,
  isSettled,
  type Money,
} from '@/features/payments';
import { PAYMENT_STATUSES } from '@/types/domain';

/**
 * The mock is how every payment path is exercised before a real provider
 * exists, so it has to behave like one: honour an idempotency key, tell a
 * decline apart from an outage, and refuse a transition that makes no sense.
 */

const AMOUNT: Money = { amount: '1000.00', currency: 'DOP' };

let provider: MockPaymentProvider;

beforeEach(() => {
  provider = new MockPaymentProvider();
});

async function open(key = 'key-1') {
  return provider.createPayment({
    appointmentId: 'apt-1',
    amount: AMOUNT,
    idempotencyKey: key,
  });
}

describe('taking a payment', () => {
  it('opens a payment that is waiting to be paid', async () => {
    const intent = await open();

    expect(intent.status).toBe('pending');
    expect(intent.amount).toEqual(AMOUNT);
    expect(intent.providerReference).not.toBeNull();
  });

  it('refuses an amount that is not an amount', async () => {
    await expect(
      provider.createPayment({
        appointmentId: 'apt-1',
        amount: { amount: '0', currency: 'DOP' },
        idempotencyKey: 'zero',
      }),
    ).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it('answers a repeated create with the same payment', async () => {
    const first = await open('same-key');
    const second = await open('same-key');

    expect(second.id).toBe(first.id);
  });
});

describe('the scenarios a gateway puts people through', () => {
  it('takes the money', async () => {
    const intent = await open();
    const settled = await provider.confirmPayment({ paymentId: intent.id, idempotencyKey: 'c1' });

    expect(settled.status).toBe('paid');
    expect(isSettled(settled.status)).toBe(true);
  });

  it('declines, and says why, and does not invite a retry of the same payment', async () => {
    const intent = await open();
    provider.scheduleScenario(intent.id, 'decline');

    const settled = await provider.confirmPayment({ paymentId: intent.id, idempotencyKey: 'c1' });

    expect(settled.status).toBe('failed');
    expect(settled.failureCode).toBe('CARD_DECLINED');
    expect(PAYMENT_TRANSITIONS.failed).toEqual([]);
  });

  it('accepts now and answers later', async () => {
    const intent = await open();
    provider.scheduleScenario(intent.id, 'pending');

    const waiting = await provider.confirmPayment({ paymentId: intent.id, idempotencyKey: 'c1' });
    expect(waiting.status).toBe('requires_action');
    expect(isPayable(waiting.status)).toBe(true);

    // The bank app comes back.
    provider.scheduleScenario(intent.id, 'success');
    const settled = await provider.confirmPayment({ paymentId: intent.id, idempotencyKey: 'c2' });
    expect(settled.status).toBe('paid');
  });

  it('separates "the provider was down" from "the card was refused"', async () => {
    const intent = await open();
    provider.scheduleScenario(intent.id, 'failure');

    await expect(
      provider.confirmPayment({ paymentId: intent.id, idempotencyKey: 'c1' }),
    ).rejects.toMatchObject({ retryable: true, code: 'PROVIDER_UNAVAILABLE' });

    // Nothing was decided, so the payment is still open.
    const current = await provider.getPaymentStatus(intent.id);
    expect(current.status).toBe('pending');
  });
});

describe('a callback that arrives twice', () => {
  it('does not charge twice', async () => {
    const intent = await open();

    const first = await provider.confirmPayment({ paymentId: intent.id, idempotencyKey: 'once' });
    const second = await provider.confirmPayment({ paymentId: intent.id, idempotencyKey: 'once' });

    expect(second).toEqual(first);
  });

  it('and a refund delivered twice refunds once', async () => {
    const intent = await open();
    await provider.confirmPayment({ paymentId: intent.id, idempotencyKey: 'c1' });

    const first = await provider.refundPayment({ paymentId: intent.id, idempotencyKey: 'r1' });
    const second = await provider.refundPayment({ paymentId: intent.id, idempotencyKey: 'r1' });

    expect(first.status).toBe('refunded');
    expect(second).toEqual(first);
  });
});

describe('refunds', () => {
  it('gives back a payment that was taken', async () => {
    const intent = await open();
    await provider.confirmPayment({ paymentId: intent.id, idempotencyKey: 'c1' });

    const refunded = await provider.refundPayment({ paymentId: intent.id, idempotencyKey: 'r1' });

    expect(refunded.status).toBe('refunded');
  });

  it('cannot give back what was never taken', async () => {
    const intent = await open();

    await expect(
      provider.refundPayment({ paymentId: intent.id, idempotencyKey: 'r1' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('reports a refund the provider could not send, as retryable', async () => {
    const intent = await open();
    await provider.confirmPayment({ paymentId: intent.id, idempotencyKey: 'c1' });
    provider.scheduleScenario(intent.id, 'failure');

    await expect(
      provider.refundPayment({ paymentId: intent.id, idempotencyKey: 'r1' }),
    ).rejects.toMatchObject({ retryable: true, code: 'REFUND_UNAVAILABLE' });
  });
});

describe('the state machine', () => {
  it('knows every status the database knows', () => {
    expect(Object.keys(PAYMENT_TRANSITIONS).sort()).toEqual([...PAYMENT_STATUSES].sort());
  });

  it('lets a payment finish, and not come back', () => {
    expect(canTransition('pending', 'paid')).toBe(true);
    expect(canTransition('pending', 'requires_action')).toBe(true);
    expect(canTransition('requires_action', 'paid')).toBe(true);
    expect(canTransition('paid', 'refunded')).toBe(true);

    expect(canTransition('paid', 'pending')).toBe(false);
    expect(canTransition('failed', 'paid')).toBe(false);
    expect(canTransition('refunded', 'paid')).toBe(false);
    expect(canTransition('cancelled', 'paid')).toBe(false);
  });

  it('agrees with the database about which states are terminal', () => {
    for (const status of ['failed', 'refunded', 'cancelled'] as const) {
      expect(PAYMENT_TRANSITIONS[status]).toEqual([]);
    }
  });
});
