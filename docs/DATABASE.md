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

## Snapshots

`appointment_items` stores the service name, duration and price as they were
at booking time, and `appointments` stores the buffers the same way.

Raising a price or shortening a service must not rewrite history, and must not
silently change how much room a booking already made occupies on the calendar.

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

| Function                      | Audience            | Purpose                                            |
| ----------------------------- | ------------------- | -------------------------------------------------- |
| `get_availability_context`    | anon, authenticated | The ingredients the engine needs, for a date range |
| `book_appointment`            | anon, authenticated | The only way a guest creates an appointment        |
| `get_appointment_by_token`    | anon, authenticated | A guest reads their own booking                    |
| `cancel_appointment_by_token` | anon, authenticated | A guest cancels their own booking                  |
| `is_slot_within_availability` | internal            | Server-side working-hours check                    |

`is_slot_within_availability` is deliberately not granted to `anon`: exposing
it would let a stranger probe a private calendar one timestamp at a time.

### Error codes

`book_appointment` raises bare sentinels rather than prose, so the client can
map them exactly. See [`src/features/booking/errors.ts`](../src/features/booking/errors.ts).

```
SLOT_TAKEN              lost the race for that time
SLOT_BLOCKED            overlaps a manual block
OUTSIDE_AVAILABILITY    not within working hours
TOO_SOON                inside the minimum notice window
BEYOND_HORIZON          further ahead than the business accepts
SERVICE_NOT_AVAILABLE   that professional does not offer it
```

## Local development

```bash
npm run db:start    # requires Docker
npm run db:reset    # migrations + supabase/seed.sql
npm run db:types    # regenerate TypeScript types from the live schema
```

The seed creates Demo Studio, Alex Rivera, three services, a Monday-to-Saturday
schedule, a block, an exception and one existing appointment.
