# Database

PostgreSQL, through Supabase. Every change is a migration in
[`supabase/migrations`](../supabase/migrations); nothing is ever changed by
hand in a dashboard.

## Tables

| Table                     | Purpose                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `profiles`                | Extended identity for an authenticated user. Created by a trigger on `auth.users`. |
| `businesses`              | The tenant. Owns the slug, the timezone and the booking policy.                    |
| `business_members`        | Who may act for a business, and in what role.                                      |
| `professional_profiles`   | A bookable calendar inside a business.                                             |
| `services`                | What is offered: duration, buffers, price.                                         |
| `professional_services`   | Which professional offers which service.                                           |
| `availability_rules`      | Recurring weekly working hours.                                                    |
| `availability_exceptions` | One-off changes to a specific date.                                                |
| `blocked_times`           | Ad-hoc blocks the professional creates by hand.                                    |
| `customers`               | A customer within one business. May be a guest.                                    |
| `appointments`            | The booking itself.                                                                |
| `appointment_items`       | What was booked, snapshotted.                                                      |
| `payments`                | Provider-agnostic payment records.                                                 |
| `appointment_events`      | Append-only history of an appointment. Written by a trigger, editable by nobody.   |
| `notifications`           | The outbox: what has to be said to a customer, and what happened when it was.      |

`profiles.preferred_locale` holds a user's interface language. It needed no
new policy: `profiles` was already scoped to `id = auth.uid()` for both select
and update. The check constrains it to the *shape* of a language tag rather
than to a list of the languages that exist today, so adding one is a
client-only change.

`customers.phone_normalized` is generated: the phone with punctuation
removed, and a leading `+` kept. It exists so a returning customer who types
their number differently lands on their own row. It never infers a country
code, and it is never compared across businesses. See
[ADR 0018](DECISIONS/0018-customer-matching-is-deliberately-timid.md).

## No double booking

`appointments` carries `blocked_range`: `starts_at` and `ends_at` widened by
the buffers that were in force when the booking was made.

```sql
alter table public.appointments
  add constraint appointments_no_double_booking
  exclude using gist (
    professional_id with =,
    blocked_range  with &&
  ) where (status in ('pending', 'confirmed'));
```

Read it as: _no two rows may share a professional and have overlapping
ranges, among the statuses that occupy the calendar._

This is the whole guarantee. It holds against concurrent transactions,
retries, a buggy client, a direct SQL insert, or someone hitting the API with
curl. Cancelled, completed and no-show appointments fall outside the predicate
and release their time.

`btree_gist` is required for the `professional_id with =` half of that
constraint; the first migration enables it.

### Why a trigger and not a generated column

`blocked_range` would be a natural `GENERATED ALWAYS` column, except that
`timestamptz - interval` is `STABLE`, not `IMMUTABLE`, so PostgreSQL refuses
it in a generated expression. A `BEFORE INSERT OR UPDATE` trigger maintains it
instead, which keeps the invariant just as tight.

`blocked_times.blocked_range` _is_ a generated column: it needs no interval
arithmetic.

### What the constraint does not cover

An exclusion constraint cannot span two tables, so it does not stop an
appointment landing on a `blocked_times` row. `book_appointment` checks that
explicitly, after taking `pg_advisory_xact_lock` on the professional, which
serialises concurrent attempts on the same calendar.

The lock is an optimisation, not the guarantee: it turns a lost race into a
short wait instead of a rollback. The constraint is still what makes double
booking impossible.

## The appointment lifecycle

```
pending   -> confirmed | cancelled
confirmed -> completed | no_show | cancelled
completed, cancelled, no_show are terminal
```

Completing or marking a no-show requires the appointment to have started.
Cancelling is terminal because it frees the time, and un-cancelling would
make the appointment lose a race it never entered. A trigger enforces both,
so a direct UPDATE cannot route around `set_appointment_status`.

Rescheduling is **orthogonal to status**, not a transition in this graph: a
pending appointment that moves is still pending. Moving something is the same
commitment at a different time. Terminal appointments cannot be moved at all.

## History

`appointment_events` records everything that happens to an appointment:
`created`, `status_changed` and `rescheduled`, each with an actor
(`professional`, `guest` or `system`) and a reason.

It is written by an `AFTER INSERT OR UPDATE` trigger rather than by the RPCs,
so a direct UPDATE that RLS permits still leaves a trace. There is a SELECT
policy for members of the business and **no write policy at all** -- the only
writer is a `SECURITY DEFINER` trigger, so the log is append-only to every
client, including the owner of the business. Guests cannot read it.

The actor is declared through a transaction-local setting by each RPC. The
function that sets it is internal, so a professional cannot sign their own
action as the guest. `occurred_at` uses `clock_timestamp()`, not `now()`:
two events written by one statement must not share an instant, or the log
loses its order.

See [ADR 0015](DECISIONS/0015-one-event-log-for-appointment-history.md).

## Two rule sets

The published slot grid is a promise to customers, not a constraint on the
owner of the calendar. A professional may enter a walk-in at 13:07 and may
work late if they say so explicitly; they may never book over a block, another
appointment, or another tenant's calendar.

| Rule | Guest | Professional |
| --- | --- | --- |
| Overlap, blocked time, tenant boundaries | always | **always** |
| Working hours and exceptions | always | unless `p_override_schedule` |
| Slot interval, minimum notice, horizon | always | never |

An off-grid appointment cannot leak off-grid availability: the engine
generates candidates from the grid and subtracts busy time, so a 13:07
appointment removes the slots it overlaps and adds nothing.

See [ADR 0016](DECISIONS/0016-the-professional-is-not-a-customer.md).

## Three ways a day can differ

These are separate tables on purpose. Collapsing them would make a calendar
unable to explain why a time is missing.

| Concept         | Table                     | Means                                                                                            |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| Weekly schedule | `availability_rules`      | "I work Mondays 09:00-18:00." The norm.                                                          |
| Date exception  | `availability_exceptions` | "This Tuesday I open 12:00-20:00", or "not at all". Changes what the schedule SAYS for one date. |
| Blocked time    | `blocked_times`           | "I am out 12:00-14:30 that day." Carves a hole in whatever the schedule already said.            |

An untimed `unavailable` exception closes the day. A timed one carves a hole
without moving the slot grid. An `available` exception replaces that date’s
hours entirely.

A block may not be created over a live appointment: a trigger refuses it, so
a customer’s booking is never silently invalidated. Nothing is auto-cancelled.

## Snapshots

`appointment_items` stores the service name, duration and price as they were
at booking time, and `appointments` stores the buffers the same way.

Raising a price or shortening a service must not rewrite history, and must not
silently change how much room a booking already made occupies on the calendar.

The customer is snapshotted for the same reason and was not, until Phase 8:
`customer_name_snapshot`, `customer_phone_snapshot` and
`customer_email_snapshot` are frozen at booking time by a `BEFORE INSERT`
trigger, and an `UPDATE` that tries to change one raises
`APPOINTMENT_IDENTITY_IS_IMMUTABLE`. `customer_id` still points at the reusable
record, which is what makes a returning customer one person; what a human
reads no longer moves when that record is edited. See
[ADR 0021](DECISIONS/0021-an-appointment-remembers-who-booked-it.md).

`appointments.customer_locale` is a snapshot too. It is the language the
booking was made in, and every message queued for it is written in that
language whatever anybody switches to later.

## The outbox

`notifications` is a durable queue, filled by a deferred trigger on
`appointment_events` and drained by a dispatcher. Nothing in a booking
transaction talks to a messaging provider; see
[ADR 0020](DECISIONS/0020-notifications-leave-through-an-outbox.md).

* `dedupe_key` is unique and deterministic, so nothing is ever queued twice.
  For an event it is derived from the event; for a reminder, from the
  appointment and the instant it is for -- which is what lets a move cancel the
  old reminder and queue a correct new one.
* `status` walks `pending -> processing -> sent | failed`, or is `cancelled`
  when the appointment it was for went away. `claimed_at` records when a
  dispatcher took it, so `requeue_stalled_notifications` can put back what a
  dispatcher that died never finished.
* The payload is minimal and frozen: business, professional, service, customer
  name, the instant, the timezone. No notes, no price, no token.
* Reminders are one per appointment per instant, `reminder_lead_minutes`
  before it -- 24 hours by default, `0` to send none. An appointment booked
  closer than the lead time gets no reminder, because one that fires as you
  book is noise.
* Only email is queued today, and only when the booking left an address. The
  channel enum carries `sms`, `whatsapp`, `push` and `in_app` so the next one
  is an adapter rather than a migration.

## Timezones

`timestamptz` for anything absolute. `time` for working hours, which are local
by nature. `date` for calendar dates in the business timezone.

Never store `'10:00 AM'` as text for an appointment.

## Booking policy

Lives on `businesses`, and is read by both the client engine and the
server-side validator:

| Column                   | Meaning                                           |
| ------------------------ | ------------------------------------------------- |
| `slot_interval_minutes`  | Granularity of offered start times                |
| `minimum_notice_minutes` | How far ahead of now a booking must be            |
| `booking_horizon_days`   | How far into the future bookings are accepted     |
| `auto_confirm_bookings`  | Whether a new booking is `confirmed` or `pending` |

## Functions

| Function                      | Audience            | Purpose                                                                               |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| `get_availability_context`    | anon, authenticated | The ingredients the engine needs, for a date range                                    |
| `get_available_slots`         | anon, authenticated | The authoritative list of bookable start times for one professional, service and date |
| `book_appointment`            | anon, authenticated | The only way a guest creates an appointment                                           |
| `get_appointment_by_token`    | anon, authenticated | A guest reads their own booking                                                       |
| `cancel_appointment_by_token` | anon, authenticated | A guest cancels their own booking                                                     |
| `is_slot_within_availability` | internal            | Server-side working-hours check                                                       |
| `is_slot_aligned`             | internal            | Server-side slot-interval check                                                       |
| `working_windows`             | internal            | The shared definition of a professional's open hours on a date                        |
| `create_business`             | authenticated       | Business, membership and professional profile in one transaction                      |
| `save_service`                | authenticated       | Create or update a service, keeping it assigned to the professionals                  |
| `set_weekly_schedule`         | authenticated       | Replace a whole week of working hours atomically                                      |
| `set_appointment_status`       | authenticated       | Drive one appointment through the lifecycle, and nothing else                         |
| `reschedule_appointment`       | authenticated       | Move an appointment, atomically, keeping its identity                                 |
| `create_manual_appointment`    | authenticated       | The professional enters a booking themselves                                          |
| `reschedule_appointment_by_token` | anon, authenticated | A guest moves their own booking                                                    |
| `assert_professional_slot_is_free` | internal        | The shared gate both professional write paths pass through                            |
| `declare_appointment_actor`    | internal            | Names who is acting, for the history trigger                                          |

`is_slot_within_availability` is deliberately not granted to `anon`: exposing
it would let a stranger probe a private calendar one timestamp at a time.

### Error codes

A hidden or missing resource raises SQLSTATE `PT404`. PostgREST reads a
`PTnnn` state as the HTTP status to answer with, so those become 404s
rather than the 500 that `P0002` produced.

`book_appointment` raises bare sentinels rather than prose, so the client can
map them exactly. See [`src/features/booking/errors.ts`](../src/features/booking/errors.ts).

```
SLOT_TAKEN              lost the race for that time
SLOT_BLOCKED            overlaps a manual block
OUTSIDE_AVAILABILITY    not within working hours
SLOT_NOT_ALIGNED        not on the published slot grid
TOO_SOON                inside the minimum notice window
BEYOND_HORIZON          further ahead than the business accepts
SERVICE_NOT_AVAILABLE   that professional does not offer it
APPOINTMENT_NOT_RESCHEDULABLE  closed, so it cannot be moved
```

## Local development

```bash
npm run db:start    # requires Docker
npm run db:reset    # migrations + supabase/seed.sql
npm run db:types    # regenerate TypeScript types from the live schema
```

The seed creates Demo Studio, Alex Rivera, three services, a Monday-to-Saturday
schedule, a block, an exception and one existing appointment.

## Executable guarantees

Nine SQL suites run against a database built from nothing, in CI and via
`tools/local-postgres/run-validation.sh`:

| File                                         | Proves                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `supabase/tests/booking_guarantees.sql`      | No double booking, blocks respected, working hours and policy enforced server-side, cancellation releases the slot |
| `supabase/tests/tenant_isolation.sql`        | A stranger sees a published catalogue and nothing else, and cannot write into someone else's business              |
| `supabase/tests/availability_api.sql`        | `get_available_slots` offers the right times and reveals nothing else                                              |
| `supabase/tests/public_booking.sql`          | The guest path: discovery, booking, the race, token access, tenant isolation                                       |
| `supabase/tests/professional_operations.sql` | The appointment lifecycle, and who may drive it                                                                    |
| `supabase/tests/appointment_lifecycle.sql`   | Rescheduling, manual booking, the reschedule race, history integrity and privacy, DST                             |
| `supabase/tests/customer_identity.sql`       | Who counts as the same customer, and the tenant boundary that is never crossed to decide                          |
| `supabase/tests/notification_outbox.sql`     | What booking queues and what it refuses to queue twice, reminders following their appointment, claiming and retrying, who may read or drain the outbox |
| `supabase/tests/function_grants.sql`         | Every function is classified, RLS covers every table                                                               |

The Phase 1 functions run as `SECURITY INVOKER`, so Row Level Security still
decides who may do what. They exist for atomicity, not for privilege.
