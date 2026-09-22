/**
 * What a log line is allowed to say about a person.
 *
 * A dispatcher's log is read while something is wrong, often by somebody who
 * is not the customer and has no reason to learn their address. Enough is kept
 * to recognise a row when comparing it with the outbox; the rest is stars.
 *
 * Nothing here is security by itself -- the addresses are in the database and
 * always were. It exists so that the *copies* of them, in a terminal, a CI
 * log, a pasted snippet in a chat, do not multiply.
 */

/** `ana.torres@example.com` -> `a***@example.com`. */
export function redactEmail(value: string): string {
  const at = value.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

/** `+1 809 555 0144` -> `***0144`: enough to match, not enough to dial. */
export function redactPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '***';
  return `***${digits.slice(-4)}`;
}

/** Picks the right one without being told which it is holding. */
export function redactRecipient(value: string): string {
  if (value.includes('@')) return redactEmail(value);
  return redactPhone(value);
}

/**
 * A failure reason short enough and plain enough to store.
 *
 * `last_error` is readable by everyone who can read the business's
 * notifications, so a provider's whole response body has no business in it:
 * those carry request echoes, and a request echo carries the message.
 */
export function safeErrorReason(error: unknown, limit = 200): string {
  const raw =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error';
  return raw.replace(/\s+/g, ' ').trim().slice(0, limit) || 'unknown error';
}
