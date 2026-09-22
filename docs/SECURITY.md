# Security

## The rule that matters most

**Security lives in the database, not in the UI.**

Row Level Security is enabled on every table, and every table is
deny-by-default: a table with RLS on and no matching policy returns nothing.
Hiding a button is a courtesy to the user, never a control.

## Three audiences

| Role            | Who                             | May read                                                                                 |
| --------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `anon`          | The public booking page         | Published businesses, their bookable professionals, their active services. Nothing else. |
| `authenticated` | A professional                  | Exactly the businesses they are an active member of.                                     |
| `service_role`  | Server-side infrastructure only | Everything. Bypasses RLS.                                                                |

### What the public cannot read

`availability_rules`, `availability_exceptions`, `blocked_times`, `customers`,
`appointments`, `appointment_items`, `appointment_events` and `payments` have
**no `anon` policy at all**. A stranger cannot query a professional's calendar, and cannot learn who
their customers are.

The booking page gets availability through `get_availability_context`, which
returns anonymous busy ranges: a start and an end, and nothing else. No name,
no service, no appointment id.

## The availability boundary

`get_available_slots` is designed for an anonymous caller holding identifiers
from a URL. Every visibility failure returns zero rows rather than an error:
an unpublished business, a professional not accepting bookings, an inactive
service, a service from another business, or one this professional does not
offer are all indistinguishable from "nothing is free that day".

Distinct errors would be an enumeration oracle. See
[DECISIONS/0012](DECISIONS/0012-availability-api-returns-empty.md).

The rows carry a start and an end. No block reasons, no customer, no
appointment, no schedule configuration. Blocked time, exceptions and weekly
rules remain unreadable by `anon`, which the suites assert directly.

## Guest booking

A guest has no account, so they cannot be given INSERT rights on
`appointments` -- that would let anyone insert anything.

Instead, `book_appointment` is `SECURITY DEFINER`. It validates everything
itself and then writes as the definer. The only way in is through its
parameters.

Each appointment carries an `access_token` (a UUID). It is returned once, at
booking time, and it is what lets a guest open and cancel their own booking
through `get_appointment_by_token` and `cancel_appointment_by_token` without
being able to see anyone else's.

That token belongs in the confirmation link. Treat it as a bearer credential.

It rides in the URL **fragment**, never the query string:

```
/booking/<appointment id>/confirmation#token=<access token>
```

A fragment is never sent to a server, so the token cannot reach an access log,
a proxy or an analytics record of page URLs. See
[ADR 0019](DECISIONS/0019-the-guest-token-rides-in-the-fragment.md). Links
shared before that change carry `?token=`; they still open, and on web they are
rewritten to the fragment form before the application mounts.

Because the whole URL is the credential, the web build also sets
`<meta name="referrer" content="same-origin">`. Browsers put the full URL in
the `Referer` header of any outbound navigation, so a single link to a map, a
calendar service or an image on another domain would hand a legacy link to
them. Nothing links off-site today; the policy is there so that the day
something does, it is not a disclosure.

What remains accepted, and is inherent to a link anybody can use without an
account: the token is in browser history, and in any copy of the link the
customer shares. It is scoped to one appointment, it cannot enumerate,
and it stops working when the appointment closes.

The same token is what lets a guest move their own appointment through
`reschedule_appointment_by_token`. It is held to the public rules exactly --
the published grid, the minimum notice, the booking horizon -- because a guest
choosing a new time is choosing from what the public page offered them. It
refuses a terminal appointment, one that has already started, and any
appointment the token does not belong to; all three answer the same way an
absent appointment does, so an id cannot be probed.

A guest cannot read `appointment_events`. They can see their own
appointment; who inside the shop touched it is not theirs to read.

## History cannot be rewritten

`appointment_events` has a SELECT policy for members of the business and
**no INSERT, UPDATE or DELETE policy at all**. Its only writer is a
`SECURITY DEFINER` trigger on `appointments`, which writes past RLS. The
owner of a business cannot forge a row, amend one, or erase one.

Attribution is not the caller's to choose either: the actor is declared
through a transaction-local setting, and the function that sets it is
`INTERNAL ONLY`. A professional cannot sign their own action as the guest.
Asserted in `supabase/tests/appointment_lifecycle.sql`.

## The professional write path

`reschedule_appointment` and `create_manual_appointment` are
`SECURITY DEFINER` -- they have to be, because they call the internal
scheduling helpers that `authenticated` is deliberately not granted. That
means RLS is not doing the authorization, so both check
`can_manage_professional` themselves, first, and answer `PT404` when it
fails: invisible and absent look the same.

They relax the published slot grid, the minimum notice and the booking
horizon, because those are promises to customers rather than constraints on
the owner. They never relax overlap, blocked time, or the tenant boundary.
Working hours sit behind an explicit flag. See
[ADR 0016](DECISIONS/0016-the-professional-is-not-a-customer.md).

## SECURITY DEFINER hygiene

Every `SECURITY DEFINER` function pins its resolution path:

```sql
set search_path = public, pg_temp
```

Without it, a caller who can create objects in a schema earlier on the path
could shadow a table or a function and have it run with the definer's rights.

Functions are also revoked from `PUBLIC` and granted deliberately, because
PostgreSQL grants `EXECUTE` to `PUBLIC` by default.

The membership helpers (`is_business_member`, `is_business_manager`,
`can_manage_professional`) are `SECURITY DEFINER` for a narrower reason: a
policy on `business_members` that queried `business_members` would recurse.

## Revoking on Supabase takes more than REVOKE FROM PUBLIC

On stock PostgreSQL, `revoke all on function f() from public` makes a
function private. On Supabase it does not. The platform sets default
privileges that GRANT execute on every new function directly to `anon`,
`authenticated` and `service_role`; revoking from `PUBLIC` leaves those
explicit role grants in place.

This was a real leak, found in the Phase 2 security review and fixed in
`20260921110000_lock_down_internal_helpers.sql`: `working_windows` let a
stranger read the exact shifts of any professional, including inside an
unpublished business, and `is_slot_within_availability` was a yes/no oracle
for mapping a private calendar one timestamp at a time.

So: **any function that is not meant to be public must be revoked from
`anon` and `authenticated` by name**, and `availability_api.sql` asserts it.

The membership helpers are the deliberate exception. RLS policies call them,
and a policy expression is evaluated with the querying role’s privileges, so
revoking would break the isolation they enforce. They only ever answer
questions about the caller.

## What the public may see

An anonymous visitor may read exactly this, all through RLS, never through
a service-role client:

| Visible                                                                                   | Not visible                                                           |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Published, active businesses: name, slug, description, timezone, phone, address, currency | Business email, publication state of others, any unpublished business |
| Bookable professionals of those businesses: display name, bio, avatar                     | Professionals of unpublished businesses                               |
| Active services: name, description, duration, price, currency                             | Inactive services, services of other businesses                       |
| Bookable start and end times, via `get_available_slots`                                   | Weekly rules, exceptions, blocked time, block reasons                 |
| Their own appointment, via its token                                                      | Any other appointment, any customer record, any appointment item      |

A guest creates an appointment only through `book_appointment`. `anon` has
no INSERT anywhere, and the three professional write RPCs are revoked from
it as well.

## Every function is classified

Supabase grants EXECUTE on new functions to `anon`, `authenticated` and
`service_role` by default, so a function added without thought is public by
accident. That has caused a real leak twice, so every function in `public`
now belongs to exactly one group:

| Group                      | Means                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| PUBLIC / ANON-SAFE         | A stranger may call it: the booking and availability surface, plus the two helpers the public catalogue policies evaluate |
| AUTHENTICATED PROFESSIONAL | A signed-in member may call it: the write RPCs, the professional booking and reschedule operations, and the membership helpers |
| INTERNAL ONLY              | Only other functions and triggers call it                                                                                 |

`supabase/tests/function_grants.sql` asserts the classification and fails
when a new function appears in `public` without being placed in a group.
The friction is deliberate.

## Secrets

The anon key is **not** a secret. It is designed to ship in the client bundle,
and RLS is what constrains it.

The service-role key **is** a secret, and it bypasses RLS entirely.

Rules:

- Never prefix a secret with `EXPO_PUBLIC_`. Anything with that prefix is
  inlined into the bundle and shipped to every device.
- Never read a secret from `src/`. ESLint blocks importing a service-role
  client from application code.
- `.env`, `.env.local` and `.env.*.local` are git-ignored. `.env.example`
  carries names and shapes, never values.
- If a service-role key is ever committed or pasted anywhere shared, rotate it
  in the Supabase dashboard. Removing the commit is not enough.

## The outbox

`notifications` holds, for every message the product owes a customer, their
address and their name. It is treated accordingly.

**No client may write to it, and writing is refused rather than ignored.**
There is a SELECT policy for members of the business and no other policy, and
`INSERT`, `UPDATE`, `DELETE` are revoked from `anon` and `authenticated` at
the privilege level as well. Without the revoke, an `UPDATE` with no matching
policy simply reports zero rows -- true, silent, and invisible to an audit.

**An anonymous caller has no access at all.** Not "sees no rows": no privilege
on the table. A guest holding a booking link has an appointment to look at,
never a queue.

**Draining it is not a client operation.** `claim_due_notifications`,
`mark_notification_sent`, `mark_notification_failed`,
`requeue_stalled_notifications`, `enqueue_notification`,
`schedule_appointment_reminder` and `cancel_pending_reminders` are revoked from
every client role. A dispatcher runs on an operator's connection; see
[OPERATIONS.md](OPERATIONS.md).

**A queue row carries as little as it can.** Business, professional, service,
customer name, the instant, the timezone. No notes, no price, no phone number
where email is the channel, and above all **no booking access token** -- that
is a bearer credential (ADR 0019), and a queue is read by more systems than an
appointment is. When an email one day needs a link, it gets one built at send
time in the fragment form.

**`last_error` is a short reason, truncated, never a response body.** Provider
responses echo the request, and the request is the message. The dispatcher's
log redacts addresses to `l***@example.test` and `***0144`, and never prints a
subject or a body.

## Money

**A client never names a price.** There is no amount argument on any function
a browser may call: `book_appointment` computes what is owed from the service.
Passing one is not refused, it is *impossible* -- PostgREST answers `PGRST202`,
because no such function exists.

**A client never says something was paid.** `apply_payment_outcome` is the only
door an outcome comes through, and it is revoked from `anon` and
`authenticated` along with `create_payment_for_appointment`,
`expire_payment_holds` and `payment_simulation_enabled`. It is idempotent on
the provider's key, so a callback delivered twice settles once.

**`anon` has no privilege on `payments`, `payment_events` or
`platform_settings` at all.** Not "sees no rows": the question is refused. A
guest sees their own payment through `get_payment_by_token`, which is scoped
by the booking link, and nothing else.

**A professional may read their own business's payments and write none of
them.** `INSERT`, `UPDATE` and `DELETE` are revoked as well as unpolicied, so
an attempt is an error rather than a silent no-op.

**Simulated payments are a deployment switch, not a build flag.**
`platform_settings.payment_simulation_enabled` is false unless something turns
it on, the development seed is the only thing that does, and the same switch
decides whether the simulate controls are drawn at all. Where real money is
possible a customer being able to say "it worked" is a way to book without
paying.

**No card data exists anywhere in this product.** No PAN, no CVV, no token
that could stand in for one. What a provider returns is a reference and a
status, and a provider's own credentials are not in the schema: the extension
point for them is deliberately unbuilt.

## Input handling

`book_appointment` treats its arguments as hostile. It re-derives the end time
from the service's own duration rather than trusting a client-supplied end,
re-checks working hours, exceptions, blocks, minimum notice and horizon, and
trims and validates the customer fields.

The client-side engine is a convenience for the customer, not a control.

## Before production

Phase 6 in [PRODUCT.md](PRODUCT.md) covers the pre-launch security work:

- [ ] Run every RLS policy against a cross-tenant test suite
- [ ] Concurrency test: N clients racing for one slot, exactly one wins
- [ ] Rate limiting on `book_appointment`
- [ ] Review `get_availability_context` for enumeration abuse
- [ ] Decide on retention and deletion for customer personal data, including
      how long a sent notification and its recipient are kept, and how long a
      payment record must be kept for accounting and disputes -- these two
      answers are likely to differ, and neither has been chosen
- [ ] Confirm no `EXPO_PUBLIC_` variable holds anything sensitive
