import { beforeEach, describe, expect, it } from 'vitest';

import {
  MockPaymentProvider,
  PaymentProviderError,
  canTransition,
  getPaymentProvider,
  setPaymentProvider,
} from '@/services/payments';

const provider = new MockPaymentProvider();

const AMOUNT = { amountInCents: 120_000, currency: 'DOP' };

beforeEach(() => {
  provider.reset();
});

describe('payment state machine', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('pending', 'paid')).toBe(true);
    expect(canTransition('pending', 'authorized')).toBe(true);
    expect(canTransition('authorized', 'paid')).toBe(true);
    expect(canTransition('paid', 'refunded')).toBe(true);
  });

  it('treats terminal states as terminal', () => {
    expect(canTransition('refunded', 'paid')).toBe(false);
    expect(canTransition('failed', 'paid')).toBe(false);
    expect(canTransition('cancelled', 'paid')).toBe(false);
    expect(canTransition('paid', 'failed')).toBe(false);
  });
});

describe('MockPaymentProvider', () => {
  it('creates a pending payment with a provider reference', async () => {
    const intent = await provider.createPayment({ appointmentId: 'apt-1', amount: AMOUNT });

    expect(intent.status).toBe('pending');
    expect(intent.provider).toBe('mock');
    expect(intent.providerReference).toBeTruthy();
    expect(intent.amount).toEqual(AMOUNT);
  });

  it('confirms a payment', async () => {
    const created = await provider.createPayment({ appointmentId: 'apt-1', amount: AMOUNT });
    const confirmed = await provider.confirmPayment({ paymentId: created.id });

    expect(confirmed.status).toBe('paid');
    expect((await provider.getPaymentStatus(created.id)).status).toBe('paid');
  });

  it('can be told to fail the next confirmation', async () => {
    const created = await provider.createPayment({ appointmentId: 'apt-1', amount: AMOUNT });
    provider.failNextConfirmation = true;

    const failed = await provider.confirmPayment({ paymentId: created.id });
    expect(failed.status).toBe('failed');
    expect(failed.failureReason).toMatch(/Declined/);
  });

  it('refuses an illegal transition instead of corrupting the record', async () => {
    const created = await provider.createPayment({ appointmentId: 'apt-1', amount: AMOUNT });
    await provider.confirmPayment({ paymentId: created.id });

    await expect(provider.confirmPayment({ paymentId: created.id })).rejects.toThrow(
      PaymentProviderError,
    );
  });

  it('refunds a paid payment', async () => {
    const created = await provider.createPayment({ appointmentId: 'apt-1', amount: AMOUNT });
    await provider.confirmPayment({ paymentId: created.id });

    const refunded = await provider.refundPayment({ paymentId: created.id, reason: 'No show' });
    expect(refunded.status).toBe('refunded');
  });

  it('rejects a negative amount', async () => {
    await expect(
      provider.createPayment({
        appointmentId: 'apt-1',
        amount: { amountInCents: -1, currency: 'DOP' },
      }),
    ).rejects.toThrow(PaymentProviderError);
  });

  it('rejects an unknown payment id', async () => {
    await expect(provider.getPaymentStatus('nope')).rejects.toThrow(PaymentProviderError);
  });
});

describe('provider registry', () => {
  it('hands out a mock provider by default and can be swapped', () => {
    expect(getPaymentProvider().name).toBe('mock');

    const replacement = new MockPaymentProvider();
    setPaymentProvider(replacement);
    expect(getPaymentProvider()).toBe(replacement);
  });
});
