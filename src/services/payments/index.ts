import { MockPaymentProvider } from './mock';
import type { PaymentProvider } from './types';

let provider: PaymentProvider = new MockPaymentProvider();

/** The provider the app should use. Swapped at composition time, never inline. */
export function getPaymentProvider(): PaymentProvider {
  return provider;
}

/** Wiring seam for tests and, later, for a real provider chosen by config. */
export function setPaymentProvider(next: PaymentProvider): void {
  provider = next;
}

export { MockPaymentProvider } from './mock';
export * from './types';
