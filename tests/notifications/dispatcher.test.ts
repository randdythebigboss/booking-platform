import { beforeEach, describe, expect, it } from 'vitest';

import {
  DeliveryError,
  InMemoryNotificationStore,
  MockNotificationProvider,
  dispatchDueNotifications,
  type NotificationJob,
} from '@/features/notifications';

/**
 * The dispatcher's job is to be unexciting: take what is due, send it once,
 * write down what happened, and never let one bad address stop the rest.
 *
 * These exercise the same statements the SQL suite makes about the database
 * implementation -- claiming counts an attempt, a failure backs off, a
 * permanent failure does not retry, two workers never take the same row.
 */

const NOW = new Date('2026-10-01T12:00:00Z');

function job(overrides: Partial<NotificationJob> = {}): NotificationJob {
  return {
    id: overrides.id ?? 'n1',
    businessId: 'b1',
    appointmentId: 'a1',
    kind: 'booking_confirmed',
    channel: 'email',
    recipient: 'lucia@example.test',
    templateKey: 'booking.confirmed',
    locale: 'es',
    payload: {
      appointmentId: 'a1',
      businessName: 'Salón Aurora',
      professionalName: 'Alex Rivera',
      serviceName: 'Corte de cabello',
      customerName: 'Lucía Fernández',
      startsAt: '2026-10-19T18:00:00Z',
      endsAt: '2026-10-19T18:30:00Z',
      timezone: 'America/Santo_Domingo',
    },
    attemptCount: 0,
    maxAttempts: 3,
    scheduledFor: new Date('2026-10-01T11:00:00Z'),
    ...overrides,
  };
}

let store: InMemoryNotificationStore;

beforeEach(() => {
  store = new InMemoryNotificationStore({ now: () => NOW });
});

describe('a normal run', () => {
  it('sends what is due and records it', async () => {
    store.add(job());
    const provider = new MockNotificationProvider();

    const summary = await dispatchDueNotifications(store, provider);

    expect(summary).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(provider.delivered).toHaveLength(1);
    expect(store.get('n1')?.status).toBe('sent');
    expect(store.get('n1')?.providerMessageId).toBe('mock-1');
  });

  it('sends the message in the language frozen on the job', async () => {
    store.add(job({ id: 'es', locale: 'es' }));
    store.add(job({ id: 'en', locale: 'en' }));
    const provider = new MockNotificationProvider();

    await dispatchDueNotifications(store, provider);

    const subjects = provider.delivered.map((request) => request.message.subject);
    expect(subjects.some((subject) => subject.includes('confirmada'))).toBe(true);
    expect(subjects.some((subject) => subject.includes('confirmed'))).toBe(true);
  });

  it('leaves alone what is not due yet', async () => {
    store.add(job({ id: 'later', scheduledFor: new Date('2026-10-02T12:00:00Z') }));
    const provider = new MockNotificationProvider();

    const summary = await dispatchDueNotifications(store, provider);

    expect(summary.claimed).toBe(0);
    expect(store.get('later')?.status).toBe('pending');
  });

  it('never sends the same notification twice', async () => {
    store.add(job());
    const provider = new MockNotificationProvider();

    await dispatchDueNotifications(store, provider);
    await dispatchDueNotifications(store, provider);

    expect(provider.delivered).toHaveLength(1);
  });

  it('takes the oldest due first', async () => {
    store.add(job({ id: 'second', scheduledFor: new Date('2026-10-01T11:30:00Z') }));
    store.add(job({ id: 'first', scheduledFor: new Date('2026-10-01T10:00:00Z') }));
    const provider = new MockNotificationProvider();

    await dispatchDueNotifications(store, provider);

    expect(provider.delivered.map((request) => request.idempotencyKey)).toEqual([
      'first',
      'second',
    ]);
  });

  it('gives the provider a key that is stable across retries', async () => {
    store.add(job());
    let attempts = 0;
    const provider = new MockNotificationProvider({
      failWith: () => (attempts++ === 0 ? new DeliveryError('timeout') : null),
    });

    await dispatchDueNotifications(store, provider);
    // Move past the backoff the store applied.
    const row = store.get('n1');
    store.add({ ...row!, scheduledFor: new Date('2026-10-01T11:00:00Z') }, 'pending');
    await dispatchDueNotifications(store, provider);

    expect(provider.delivered).toHaveLength(1);
    expect(provider.delivered[0]?.idempotencyKey).toBe('n1');
  });
});

describe('when sending fails', () => {
  it('counts the attempt and schedules another try', async () => {
    store.add(job());
    const provider = new MockNotificationProvider({
      failWith: () => new DeliveryError('provider timed out'),
    });

    const summary = await dispatchDueNotifications(store, provider);

    const row = store.get('n1');
    expect(summary).toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(row?.status).toBe('pending');
    expect(row?.attemptCount).toBe(1);
    expect(row?.lastError).toContain('timed out');
    expect(row!.scheduledFor.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('gives up after the attempts it is allowed, and stays given up', async () => {
    store.add(job({ maxAttempts: 2 }));
    const provider = new MockNotificationProvider({
      failWith: () => new DeliveryError('still down'),
    });

    // Two claims, because the backoff pushes the row into the future.
    await dispatchDueNotifications(store, provider);
    store.add({ ...store.get('n1')!, scheduledFor: new Date('2026-10-01T11:00:00Z') }, 'pending');
    await dispatchDueNotifications(store, provider);

    const row = store.get('n1');
    expect(row?.status).toBe('failed');
    expect(row?.failedAt).not.toBeNull();

    // And a later run does not pick it up again: that is what bounded means.
    const summary = await dispatchDueNotifications(store, provider);
    expect(summary.claimed).toBe(0);
  });

  it('does not retry a failure that will never succeed', async () => {
    store.add(job({ maxAttempts: 5 }));
    const provider = new MockNotificationProvider({
      failWith: () => new DeliveryError('not an address', { retryable: false }),
    });

    await dispatchDueNotifications(store, provider);

    expect(store.get('n1')?.status).toBe('failed');
    expect(store.get('n1')?.attemptCount).toBe(1);
  });

  it('fails a channel the provider cannot carry, without retrying it', async () => {
    store.add(job({ channel: 'sms', recipient: '+1 809 555 0144' }));
    const provider = new MockNotificationProvider({ channels: ['email'] });

    const summary = await dispatchDueNotifications(store, provider);

    expect(summary.failed).toBe(1);
    expect(store.get('n1')?.status).toBe('failed');
    expect(provider.delivered).toHaveLength(0);
  });

  it('keeps going after a bad one', async () => {
    store.add(job({ id: 'bad', recipient: 'nope' }));
    store.add(job({ id: 'good' }));
    const provider = new MockNotificationProvider({
      failWith: (request) =>
        request.recipient === 'nope' ? new DeliveryError('rejected', { retryable: false }) : null,
    });

    const summary = await dispatchDueNotifications(store, provider);

    expect(summary).toEqual({ claimed: 2, sent: 1, failed: 1 });
    expect(store.get('good')?.status).toBe('sent');
  });
});

describe('two dispatchers at once', () => {
  it('never hand the same notification to both', async () => {
    for (let i = 0; i < 6; i += 1) store.add(job({ id: `n${i}` }));

    const one = new MockNotificationProvider();
    const two = new MockNotificationProvider();

    const [first, second] = await Promise.all([
      dispatchDueNotifications(store, one, { limit: 10 }),
      dispatchDueNotifications(store, two, { limit: 10 }),
    ]);

    expect(first.claimed + second.claimed).toBe(6);

    const ids = [...one.delivered, ...two.delivered].map((request) => request.idempotencyKey);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('what the log says', () => {
  it('never prints the address, the subject or the body', async () => {
    store.add(job());
    const lines: string[] = [];

    await dispatchDueNotifications(store, new MockNotificationProvider(), {
      log: (line) => lines.push(line),
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('lucia@example.test');
    expect(lines[0]).not.toContain('Lucía Fernández');
    expect(lines[0]).toContain('l***@example.test');
  });
});
