import { DeliveryError, type NotificationProvider } from './provider';
import { redactRecipient, safeErrorReason } from './redact';
import type { NotificationStore } from './store';
import { renderNotification } from './templates';
import type { NotificationJob } from './types';

/**
 * Drains the outbox once.
 *
 * Everything difficult about sending messages is deliberately somewhere else:
 * claiming safely is the store's problem, delivering is the provider's, and
 * saying the right words in the right language is the template registry's.
 * What is left here is the decision of what to do with each outcome, which is
 * the part worth reading.
 *
 * It never throws for a message that failed. A dispatcher that gives up on the
 * batch because one address was malformed is a dispatcher that stops sending.
 */

export interface DispatchSummary {
  claimed: number;
  sent: number;
  failed: number;
}

export interface DispatchOptions {
  limit?: number;
  /** Receives one line per notification. Already redacted. */
  log?: (line: string) => void;
}

function describe(job: NotificationJob): string {
  // Never the body, never the subject, never the address in full: a log is
  // read by more people than a message is.
  return `${job.kind} ${job.channel} -> ${redactRecipient(job.recipient)} [${job.id}]`;
}

export async function dispatchDueNotifications(
  store: NotificationStore,
  provider: NotificationProvider,
  options: DispatchOptions = {},
): Promise<DispatchSummary> {
  const limit = options.limit ?? 20;
  const log = options.log ?? (() => {});

  const jobs = await store.claimDue(limit);
  const summary: DispatchSummary = { claimed: jobs.length, sent: 0, failed: 0 };

  for (const job of jobs) {
    if (!provider.supports(job.channel)) {
      // Not a transient condition: this provider will not grow a channel
      // between now and four minutes from now.
      await store.markFailed(job.id, `channel not supported by ${provider.name}`, {
        permanent: true,
      });
      summary.failed += 1;
      log(`unsupported ${describe(job)}`);
      continue;
    }

    try {
      const message = renderNotification(job.templateKey, job.locale, job.payload);
      const result = await provider.send({
        channel: job.channel,
        recipient: job.recipient,
        message,
        // Stable across retries, so a provider that honours it cannot turn
        // our second attempt into the customer's second message.
        idempotencyKey: job.id,
      });

      await store.markSent(job.id, provider.name, result.providerMessageId);
      summary.sent += 1;
      log(`sent ${describe(job)}`);
    } catch (cause) {
      const permanent = cause instanceof DeliveryError && !cause.retryable;
      await store.markFailed(job.id, safeErrorReason(cause), { permanent });
      summary.failed += 1;
      log(`${permanent ? 'failed' : 'retrying'} ${describe(job)}: ${safeErrorReason(cause, 80)}`);
    }
  }

  return summary;
}
