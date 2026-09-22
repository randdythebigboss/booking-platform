import type { NotificationChannel, NotificationMessage } from './types';

/**
 * The boundary between this product and whoever actually carries a message.
 *
 * Deliberately narrow: a provider takes an address and some words and returns
 * a reference, or throws. It does not know what a booking is, it does not read
 * the outbox, and nothing about it is allowed to reach into the appointment
 * model -- that is what makes swapping one for another an adapter rather than
 * a refactor, and what keeps a booking transaction from ever waiting on it.
 */

export interface DeliveryRequest {
  channel: NotificationChannel;
  recipient: string;
  message: NotificationMessage;
  /**
   * Stable across retries of the same notification.
   *
   * Providers that accept an idempotency key use it to collapse a duplicate
   * send that the network caused; the outbox's own `dedupe_key` stops us
   * queueing the same thing twice, and this stops a retry becoming a second
   * message at the far end.
   */
  idempotencyKey: string;
}

export interface DeliveryResult {
  /** The provider's own reference, if it gives one. */
  providerMessageId?: string;
}

/**
 * A send that did not work.
 *
 * `retryable` is the whole point of the class. A timeout is worth another go;
 * "that is not an email address" never will be, and retrying it four more
 * times is a retry storm that teaches nobody anything.
 */
export class DeliveryError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = 'DeliveryError';
    this.retryable = options.retryable ?? true;
  }
}

export interface NotificationProvider {
  readonly name: string;
  supports(channel: NotificationChannel): boolean;
  send(request: DeliveryRequest): Promise<DeliveryResult>;
}

/**
 * The provider the product ships with.
 *
 * It delivers nowhere and records everything, which is exactly what is wanted
 * before a paid channel exists: every flow can be exercised end to end -- queue,
 * claim, render, send, record -- without an account, a card, or a contract. It
 * is also what the tests send through.
 */
export class MockNotificationProvider implements NotificationProvider {
  readonly name = 'mock';

  /** Everything it was asked to deliver, in order. */
  readonly delivered: DeliveryRequest[] = [];

  private readonly channels: ReadonlySet<NotificationChannel>;
  private readonly failure?: (request: DeliveryRequest) => DeliveryError | null;
  private counter = 0;

  constructor(
    options: {
      channels?: readonly NotificationChannel[];
      /** Lets a test make a specific send fail, transiently or for good. */
      failWith?: (request: DeliveryRequest) => DeliveryError | null;
    } = {},
  ) {
    this.channels = new Set(options.channels ?? ['email', 'sms', 'whatsapp', 'push', 'in_app']);
    this.failure = options.failWith;
  }

  supports(channel: NotificationChannel): boolean {
    return this.channels.has(channel);
  }

  async send(request: DeliveryRequest): Promise<DeliveryResult> {
    const failure = this.failure?.(request);
    if (failure) throw failure;

    this.delivered.push(request);
    this.counter += 1;
    return { providerMessageId: `mock-${this.counter}` };
  }
}
