/**
 * Drains the notification outbox against a real database.
 *
 *   DISPATCH_DB_URL=postgresql://... npm run notifications:dispatch
 *   DISPATCH_DB_URL=... npm run notifications:dispatch -- --watch --limit 50
 *
 * This is the development and operations mechanism, deliberately: it needs a
 * connection that may call `claim_due_notifications`, which no browser role
 * can, and it therefore belongs on somebody's machine or on an operator's
 * host rather than in the application. Nothing in CI depends on it -- the
 * dispatcher's behaviour is tested against an in-memory store, and what the
 * database promises is tested in SQL.
 *
 * It speaks to PostgreSQL through `psql`, which every environment that can run
 * the migrations already has, rather than adding a driver to an application
 * that has no business holding one.
 *
 * The provider is the mock: it delivers nowhere and records everything, which
 * is exactly what is wanted before a paid channel exists. Swapping in a real
 * one is a `NotificationProvider` implementation and one line here.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import {
  MockNotificationProvider,
  dispatchDueNotifications,
  type NotificationJob,
  type NotificationStore,
} from '../../src/features/notifications';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function connectionString(): string {
  const url = process.env.DISPATCH_DB_URL;
  if (!url) {
    console.error('Set DISPATCH_DB_URL to the database to drain.');
    process.exit(2);
  }
  return url;
}

/**
 * Where psql is.
 *
 * `PSQL` wins and may be a full path to the executable, because Node resolves
 * argument zero literally: on Windows a bare `psql` is not found without its
 * extension, and a shell-style path is not a path at all.  `PGBIN` is the
 * convention the rest of the tooling already uses.
 */
function psqlBinary(): string {
  if (process.env.PSQL) return process.env.PSQL;
  if (process.env.PGBIN) return join(process.env.PGBIN, 'psql');
  return 'psql';
}

/** Runs one statement. What it printed is the caller's business. */
function run(sql: string): string {
  return execFileSync(psqlBinary(), [connectionString(), '-v', 'ON_ERROR_STOP=1', '-tAc', sql], {
    encoding: 'utf8',
  }).trim();
}

/**
 * Runs a statement that selects JSON, and parses it.
 *
 * Deliberately separate from `run`: psql prints a boolean as `t`, which is not
 * JSON, and parsing everything blindly turns a successful send into a crash.
 * Callers that want a value ask for `to_json(...)`.
 */
function queryJson<T>(sql: string): T | null {
  const out = run(sql);
  return out ? (JSON.parse(out) as T) : null;
}

/** A uuid, or nothing. Interpolating anything else into SQL is not on. */
function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error('not a uuid');
  return `'${value}'`;
}

/** Postgres dollar quoting, so a provider's message cannot end the string. */
function literal(value: string): string {
  return `$dispatch$${value.replace(/\$dispatch\$/g, '')}$dispatch$`;
}

interface ClaimedRow {
  id: string;
  business_id: string;
  appointment_id: string | null;
  kind: NotificationJob['kind'];
  channel: NotificationJob['channel'];
  recipient: string;
  template_key: NotificationJob['templateKey'];
  locale: string;
  payload: NotificationJob['payload'];
  attempt_count: number;
  max_attempts: number;
  scheduled_for: string;
}

const store: NotificationStore = {
  async claimDue(limit) {
    const rows =
      queryJson<ClaimedRow[]>(
        `select coalesce(json_agg(n), '[]'::json) from public.claim_due_notifications(${Number(limit)}) n`,
      ) ?? [];

    return rows.map((row): NotificationJob => ({
      id: row.id,
      businessId: row.business_id,
      appointmentId: row.appointment_id,
      kind: row.kind,
      channel: row.channel,
      recipient: row.recipient,
      templateKey: row.template_key,
      locale: row.locale,
      payload: row.payload,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      scheduledFor: new Date(row.scheduled_for),
    }));
  },

  async markSent(id, provider, providerMessageId) {
    run(
      `select public.mark_notification_sent(${uuid(id)}, ${literal(provider)}, ` +
        `${providerMessageId ? literal(providerMessageId) : 'null'})`,
    );
  },

  async markFailed(id, reason, options = {}) {
    const retry = options.retryAfterSeconds
      ? `make_interval(secs => ${Number(options.retryAfterSeconds)})`
      : 'null';
    run(
      `select public.mark_notification_failed(${uuid(id)}, ${literal(reason)}, ${retry}, ` +
        `${options.permanent ? 'true' : 'false'})`,
    );
  },
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const watch = args.includes('--watch');
  const limitAt = args.indexOf('--limit');
  const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : 20;

  const provider = new MockNotificationProvider();

  do {
    // Anything a previous dispatcher claimed and never finished -- because it
    // was killed, or the machine went away -- goes back in the queue first.
    // Without this a crash quietly parks those messages forever.
    const requeued =
      queryJson<number>(
        `select to_json(public.requeue_stalled_notifications(interval '15 minutes'))`,
      ) ?? 0;
    if (requeued > 0) console.log(`requeued ${requeued} stalled`);

    const summary = await dispatchDueNotifications(store, provider, {
      limit,
      log: (line) => console.log(line),
    });

    if (summary.claimed > 0 || !watch) {
      console.log(`claimed ${summary.claimed}, sent ${summary.sent}, failed ${summary.failed}`);
    }

    if (watch) await new Promise((resolve) => setTimeout(resolve, 5000));
  } while (watch);
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
