/**
 * Where a guest's booking credential lives in a URL.
 *
 * The token is a bearer credential: whoever holds it can read, move and cancel
 * that one appointment. It used to travel as `?token=...`, which puts it in
 * places a credential should not go -- the `Referer` header on any outbound
 * navigation, server access logs, analytics that record page URLs, and the
 * address bar itself.
 *
 * A URL fragment is never sent to a server. `#token=...` is visible to the
 * page and to nobody else, which is the same property the token needs.
 *
 * Nothing about the token itself changes: same `gen_random_uuid()` from the
 * database, same entropy, same one-appointment scope. Only where it rides.
 */
const TOKEN_KEY = 'token';

/** Reads `#token=...`, tolerating a leading `#` and extra fragment keys. */
export function tokenFromFragment(fragment: string | null | undefined): string | null {
  if (!fragment) return null;
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  const value = params.get(TOKEN_KEY);
  return value && value.length > 0 ? value : null;
}

/**
 * Pulls the token out of a whole URL, fragment first and query second.
 *
 * Query still works, because links shared before this change are in people's
 * inboxes and messages and have to keep opening. On web those are upgraded to
 * the fragment form as soon as they are read; see `upgradeLegacyTokenUrl`.
 */
export function tokenFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  const hashAt = url.indexOf('#');
  if (hashAt >= 0) {
    const fromFragment = tokenFromFragment(url.slice(hashAt));
    if (fromFragment) return fromFragment;
  }

  const queryAt = url.indexOf('?');
  if (queryAt >= 0) {
    const query = url.slice(queryAt + 1, hashAt >= 0 ? hashAt : undefined);
    const value = new URLSearchParams(query).get(TOKEN_KEY);
    if (value && value.length > 0) return value;
  }

  return null;
}

/** The confirmation link handed to a guest. The token rides in the fragment. */
export function confirmationPath(appointmentId: string, accessToken: string): string {
  return `/booking/${appointmentId}/confirmation#${TOKEN_KEY}=${encodeURIComponent(accessToken)}`;
}

/**
 * Rewrites a legacy `?token=` URL so the credential rides in the fragment.
 *
 * Returns null when there is nothing to move. The caller replaces the history
 * entry rather than pushing, so the query form does not stay one Back press
 * away -- and so the address bar stops showing a credential.
 *
 * A URL that somehow carries the token in *both* places still counts as
 * something to move: the fragment copy is kept and the query copy is removed,
 * because a token left in the query is the whole problem. Other query
 * parameters and other fragment keys are preserved.
 */
export function upgradeLegacyTokenUrl(href: string): string | null {
  const hashAt = href.indexOf('#');
  const queryAt = href.indexOf('?');

  // No query, or the `?` sits inside the fragment and so is not a query at all.
  if (queryAt < 0 || (hashAt >= 0 && hashAt < queryAt)) return null;

  const query = new URLSearchParams(href.slice(queryAt + 1, hashAt >= 0 ? hashAt : undefined));
  const token = query.get(TOKEN_KEY);
  if (!token) return null;

  query.delete(TOKEN_KEY);
  const rest = query.toString();

  const fragment = new URLSearchParams(hashAt >= 0 ? href.slice(hashAt).replace(/^#/, '') : '');
  if (!fragment.get(TOKEN_KEY)) fragment.set(TOKEN_KEY, token);

  const base = href.slice(0, queryAt);
  return `${base}${rest ? `?${rest}` : ''}#${fragment.toString()}`;
}
