/**
 * Telling "the network" apart from "the server said no".
 *
 * A failed `fetch` and a refused booking arrive at the same catch block and
 * mean opposite things: one is worth retrying in a moment, the other will say
 * the same thing forever. The Supabase client surfaces a transport failure as
 * a `TypeError: Failed to fetch` (or its platform equivalent), with no code
 * and no status, which is the only signal there is.
 *
 * Deliberately narrow: anything that carries a database code is not a network
 * failure, whatever it says. Guessing the other way -- treating a real refusal
 * as "you seem to be offline" -- would send somebody to check their wifi about
 * a slot that is genuinely taken.
 */

const TRANSPORT_MESSAGES = [
  'failed to fetch',
  'network request failed',
  'networkerror',
  'load failed',
  'fetch failed',
  'err_internet_disconnected',
  'err_network',
];

export function isNetworkFailure(cause: unknown): boolean {
  if (cause == null) return false;

  const record = cause as { code?: unknown; status?: unknown; message?: unknown };

  // A PostgREST error has a code or an HTTP status. That is an answer, not a
  // missing connection.
  if (typeof record.code === 'string' && record.code.length > 0) return false;
  if (typeof record.status === 'number' && record.status > 0) return false;

  const message = typeof record.message === 'string' ? record.message.toLowerCase() : '';
  if (message.length === 0) return false;

  return TRANSPORT_MESSAGES.some((needle) => message.includes(needle));
}
