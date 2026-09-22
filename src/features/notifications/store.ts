import type { NotificationJob } from './types';

/**
 * The only three things a dispatcher does to the outbox.
 *
 * A port, not a client: the database implementation runs these as SQL
 * functions no browser role may execute, and the in-memory one exists so the
 * dispatcher's own behaviour -- ordering, retries, exhaustion, two workers at
 * once -- can be tested without a database in the loop.
 *
 * Both implementations must agree on the semantics, and the SQL suite and the
 * unit tests assert the same statements about each.
 */
export interface NotificationStore {
  /**
   * Takes at most `limit` notifications that are due, marks them in flight,
   * and counts an attempt against each. Two callers at the same instant get
   * disjoint sets; neither waits for the other.
   */
  claimDue(limit: number): Promise<NotificationJob[]>;

  markSent(id: string, provider: string, providerMessageId?: string): Promise<void>;

  /**
   * Records a failure. The store decides whether it becomes another attempt or
   * the end of the road: after `maxAttempts`, or immediately when the caller
   * says the failure is permanent.
   */
  markFailed(
    id: string,
    reason: string,
    options?: { permanent?: boolean; retryAfterSeconds?: number },
  ): Promise<void>;
}

interface StoredNotification extends NotificationJob {
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  sentAt: Date | null;
  failedAt: Date | null;
  lastError: string | null;
  provider: string | null;
  providerMessageId: string | null;
}

/**
 * The outbox, in memory, behaving as the SQL does.
 *
 * Written to be boring and exact rather than convenient: the same ordering
 * (earliest due first), the same attempt counting (on the claim, so a worker
 * that dies still burned one), and the same backoff (doubling, capped at an
 * hour). A test that passes here is making a statement about the real thing.
 */
export class InMemoryNotificationStore implements NotificationStore {
  private readonly rows = new Map<string, StoredNotification>();
  private readonly clock: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.clock = options.now ?? (() => new Date());
  }

  /** Seeds a row as the database trigger would have queued it. */
  add(job: NotificationJob, status: StoredNotification['status'] = 'pending'): void {
    this.rows.set(job.id, {
      ...job,
      status,
      sentAt: null,
      failedAt: null,
      lastError: null,
      provider: null,
      providerMessageId: null,
    });
  }

  get(id: string): StoredNotification | undefined {
    const row = this.rows.get(id);
    return row ? { ...row } : undefined;
  }

  all(): StoredNotification[] {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }

  async claimDue(limit: number): Promise<NotificationJob[]> {
    const now = this.clock();
    const due = [...this.rows.values()]
      .filter((row) => row.status === 'pending' && row.scheduledFor.getTime() <= now.getTime())
      .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
      .slice(0, Math.max(limit, 0));

    return due.map((row) => {
      row.status = 'processing';
      row.attemptCount += 1;
      return { ...row };
    });
  }

  async markSent(id: string, provider: string, providerMessageId?: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'processing') return;

    row.status = 'sent';
    row.sentAt = this.clock();
    row.failedAt = null;
    row.lastError = null;
    row.provider = provider;
    row.providerMessageId = providerMessageId ?? null;
  }

  async markFailed(
    id: string,
    reason: string,
    options: { permanent?: boolean; retryAfterSeconds?: number } = {},
  ): Promise<void> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'processing') return;

    const exhausted = options.permanent === true || row.attemptCount >= row.maxAttempts;
    row.lastError = reason;

    if (exhausted) {
      row.status = 'failed';
      row.failedAt = this.clock();
      return;
    }

    const backoffSeconds =
      options.retryAfterSeconds ?? Math.min(3600, 60 * 2 ** Math.max(row.attemptCount - 1, 0));
    row.status = 'pending';
    row.failedAt = null;
    row.scheduledFor = new Date(this.clock().getTime() + backoffSeconds * 1000);
  }
}
