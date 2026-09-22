# Operations

What somebody needs to be able to do while a small private beta is running,
written down before it is running. Nothing here is infrastructure: there is no
production environment yet, and this document does not create one.

## Environments

| Environment  | What it is                               | Where its configuration lives |
| ------------ | ---------------------------------------- | ----------------------------- |
| Local        | PostgreSQL + PostgREST on your machine    | `.env.local`, git-ignored     |
| Development  | The free Supabase project `booking-platform-dev` | `.env.local`, git-ignored |
| Beta         | Not created yet                          | —                             |
| Production   | Not created yet                          | —                             |

One rule, and it is the one that keeps the others honest: **nothing
environment-specific is committed.** The repository holds `.env.example` and no
values. A URL, a publishable key and a site URL come from the environment; a
service-role key, a database password or a personal access token are never
handled by the application at all.

## Applying migrations

The Git repository is the source of truth, in every environment, always.

```bash
# Local, from nothing: bootstrap, every migration in order, seed, all suites.
PGBIN=/path/to/pgsql/bin ./tools/local-postgres/run-validation.sh

# With Docker and the Supabase CLI, which is what CI runs:
npm run db:reset
```

Against the cloud development project, apply the same files in the same order,
from the commit you are deploying. Never hand-edit a deployed schema: a change
that is not a migration is a change the next environment will not have.

Two things learned deploying this schema for the first time, both worth
knowing before doing it again:

* **Never `drop schema public cascade` on a Supabase project.** It takes
  Supabase's default privileges with it, and every table then exists, with
  correct policies, answering `42501 permission denied`. Migration
  `20260925100000` makes this repository grant its own tables so a fresh
  project does not depend on those defaults -- but the drop is still not
  something to do.
* **Recreating a function resets its grants.** Supabase grants `EXECUTE` on new
  functions to `anon` and `authenticated`. Any migration that replaces a
  function restates its classification immediately afterwards, and
  `supabase/tests/function_grants.sql` fails the build if one is forgotten.
* **PostgREST caches the schema.** After a migration that adds or replaces a
  function or a column, run

  ```sql
  notify pgrst, 'reload schema';
  ```

  Without it the database is correct and the API is not: calls fail, or an
  overload resolves to the signature that used to exist. `supabase db reset`
  and the local stack restart PostgREST for you; a migration applied to a
  running cloud project does not.
* **Reproduce a function from the live definition, never from a migration.**
  A function is rewritten by several migrations over its life, and the one
  that is easiest to find is rarely the newest. Copying an old body silently
  removes everything added since -- which happened once here, dropping three
  fields the guest confirmation page needs, with every SQL suite still green.

## Development data

`supabase/seed.sql` is the safe demo data: one business, Spanish content,
invented customers with `@example.test` addresses. It contains no real person,
and nothing that arrives in it should.

To reset a development database, recreate it from migrations and seed rather
than deleting rows -- `run-validation.sh` does exactly that and then proves the
result.

**The SQL suites are single-shot.** Each says "run against a freshly reset
stack" in its header and means it: they leave their fixtures behind, and a
second run against the same database fails for the wrong reason. Against a
long-lived development project, clean up afterwards -- fixture businesses by
slug, `%@bookingplatform.test` users, the English fixture customer names -- or
the Spanish demo data becomes unrecognisable.

## Sending notifications

Nothing sends by itself. A dispatcher drains the outbox:

```bash
DISPATCH_DB_URL=postgresql://... npm run notifications:dispatch
DISPATCH_DB_URL=postgresql://... npm run notifications:dispatch -- --watch --limit 50

# Windows, or any machine where psql is not on PATH:
PSQL=C:/path/to/psql.exe DISPATCH_DB_URL=... npm run notifications:dispatch
```

It ships with the mock provider: it delivers nowhere and records everything,
which is what is wanted before a paid channel exists. Every flow can be
exercised end to end without an account, a card or a contract.

It requires a connection that may call `claim_due_notifications`, which no
browser role can. That is the boundary described in
[ADR 0020](DECISIONS/0020-notifications-leave-through-an-outbox.md), and it is
why this is a command and not a screen.

Each pass first calls `requeue_stalled_notifications`, which puts back anything
a previous dispatcher claimed and never finished. It does not give back the
attempt that claim burned: it may have sent before it died.

## Looking at what is happening

**The notifications screen** (`/app/notifications`) is the first place to look:
what is pending, what was sent, what failed and why, per business, read through
Row Level Security. A professional sees their own and nobody else's.

**An appointment's detail screen** shows the messages queued for that one
appointment, next to the history of the appointment itself.

**The history log** (`appointment_events`) answers "what happened to this
appointment, when, and who did it" -- including changes made directly in SQL,
which are recorded as `system`.

When those are not enough, query the database. Useful starting points:

```sql
-- The backlog, oldest first.
select kind, channel, status, scheduled_for, attempt_count, last_error
from public.notifications
where status in ('pending', 'processing')
order by scheduled_for;

-- Everything that gave up, and what it said.
select kind, locale, attempt_count, last_error, failed_at
from public.notifications
where status = 'failed'
order by failed_at desc;

-- One appointment, end to end.
select e.occurred_at, e.event_type, e.actor_type, e.reason
from public.appointment_events e
where e.appointment_id = '...'
order by e.occurred_at;
```

## What may be written down

Logs are read by more people than a message is, and they are copied into chat
windows and issue trackers.

* Never a booking access token. It is a bearer credential
  ([ADR 0019](DECISIONS/0019-the-guest-token-rides-in-the-fragment.md)); a log
  line containing one is a disclosure.
* Never a password, a service-role key, a database URL with credentials in it,
  or a session token.
* Not a customer's full address. The dispatcher redacts: `l***@example.test`,
  `***0144`. `last_error` holds a short reason, truncated, never a provider's
  response body -- those echo the request, and the request is the message.
* Not a message body or subject. What was sent is reconstructable from the
  template key and the payload by anyone entitled to see them.

## Supporting somebody

1. Find the appointment: the professional's own screens, by customer name or
   date. Their identity on it is what they booked with, frozen
   ([ADR 0021](DECISIONS/0021-an-appointment-remembers-who-booked-it.md)).
2. Read its history. Every status change and move is there, with who did it.
3. Read its notifications. Pending means not due yet or waiting for a
   dispatcher; failed carries a reason.
4. If a message should go again, the fix is a new row rather than an edited
   one -- the outbox is append-only to every client, including the owner.
5. If a guest lost their link, it cannot be recovered from a log, by design.
   The professional can cancel or move the appointment for them.

## Payments, in development

No money moves. The provider is the mock, and the database refuses a simulated
outcome unless `platform_settings.payment_simulation_enabled` is true -- which
`supabase/seed.sql` sets and which **a production deployment must leave
false**. The simulate controls on the confirmation page are drawn from the same
switch, so there is one thing to get right rather than two.

```sql
-- What is owed, what was paid, and what happened to it.
select p.status, p.amount, p.currency, p.requirement, p.failure_code, p.paid_at
from public.payments p
where p.appointment_id = '...'
order by p.created_at desc;

-- The provider's side of the story.
select e.occurred_at, e.event_type, e.previous_status, e.new_status, e.failure_code
from public.payment_events e
where e.payment_id = '...'
order by e.occurred_at;

-- Slots being held right now.
select a.id, a.starts_at, a.hold_expires_at
from public.appointments a
where a.hold_expires_at > now();
```

Refunding is a professional's action in the interface, never automatic, and
never implied by a cancellation
([ADR 0023](DECISIONS/0023-cancelling-is-not-refunding.md)).

**Retention is an open decision.** Nothing deletes a payment, a payment event,
a notification or a recipient address, ever. Accounting and dispute windows
argue for keeping payment records considerably longer than message records,
and no period has been chosen for either. This is a pre-production privacy and
accounting gate, not an oversight.

## What does not exist yet, deliberately

No paid messaging provider, no real payment provider, no production
environment, no store
listing, no uptime monitoring, no alerting, no log aggregation. Each is a
decision to take when there is something to protect, not before.
