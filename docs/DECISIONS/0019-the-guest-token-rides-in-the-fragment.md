# 0019 - The guest token rides in the URL fragment

**Date:** 2026-09-22
**Status:** Accepted. Refines [0013](0013-guest-access-by-bearer-link.md).

## Context

[0013](0013-guest-access-by-bearer-link.md) gave each appointment an
unguessable `access_token` and put it in the confirmation link:

```
/booking/<appointment id>/confirmation?token=<access token>
```

The token is the right idea and the entropy is not in question. Where it rides
is. A query string is part of the request: it reaches the server on every
navigation, and it therefore lands in access logs, in a proxy's records, in
anything that reports page URLs, and -- for any outbound link -- in the
`Referer` header. `<meta name="referrer" content="same-origin">` closes the
referrer path, but only that one, and only in a browser that honours it.

A URL fragment is different in kind, not in degree: browsers never send it to a
server. Nobody has to be trusted to discard it, because nobody receives it.

## Decision

The confirmation link the product hands out is

```
/booking/<appointment id>/confirmation#token=<access token>
```

The token itself is unchanged: same `gen_random_uuid()`, same 122 bits, same
scope of exactly one appointment, same database checks. Only its position in
the URL changed.

Links created before this decision keep working. A `?token=` is read as a
fallback, and on web it is rewritten to the fragment form with
`history.replaceState`, so the credential leaves the address bar and does not
stay one Back press away. That rewrite happens in a small inline script in the
document (`src/app/+html.tsx`), before the bundle mounts: from inside a React
effect it raced the router, which owns the URL once it has read the query, and
in a real browser the token ended up in _both_ places. The upgrade helper now
also treats "in both places" as something to clean.

## Consequences

- The token is not in the document request, so it cannot be logged by a server
  that never sees it. Verified in the browser: the confirmation page's own
  `GET` carries no token.
- Native is unaffected in behaviour but not in code: `useLocalSearchParams`
  drops a fragment, so the deep link is read through `Linking.useURL()`.
- Anything that reads the token has to be told where to look, which is why
  there is exactly one place that knows: `src/features/booking/guest-token.ts`.
- A fragment is still visible to the page and to whoever holds the link. This
  is a capability URL and is documented to customers as one ("treat it like a
  ticket"). Nothing here changes that.
