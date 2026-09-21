# Architecture

## Shape of the system

```
                         CUSTOMERS
                ┌────────────┴────────────┐
             Web / PWA                 Mobile
                └────────────┬────────────┘
                             │
                     Expo app (one codebase)
                             │
              ┌──────────────┴──────────────┐
              │                             │
        Supabase Auth              PostgREST + RPC
              │                             │
              └──────────────┬──────────────┘
                             │
                        PostgreSQL
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
  Availability          Appointments           Payments
   (computed)         (exclusion constraint)  (pluggable)
```

## Layers

| Layer      | Directory        | Rule                                                      |
| ---------- | ---------------- | --------------------------------------------------------- |
| Routes     | `src/app`        | Expo Router file routes. Screens only: no business rules. |
| Components | `src/components` | Presentational, reusable, no data fetching.               |
| Features   | `src/features`   | Pure domain logic. No network, no React, no React Native. |
| Services   | `src/services`   | The only place that talks to Supabase.                    |
| Lib        | `src/lib`        | Configuration, the Supabase client, formatting.           |
| Types      | `src/types`      | The TypeScript view of the database enums.                |

The separation earns its keep in one specific way: `src/features` has no
imports from `react-native` or `@supabase/supabase-js`, so the availability
engine and the booking error mapping run under plain Node in tests, in
milliseconds, with no mocking.

## The availability engine

This is the centre of the product, and it lives in
[`src/features/availability`](../src/features/availability).

Availability is **never stored as a list of free slots**. It is computed, every
time, from:

```
weekly rules
  + one-off exceptions
  + blocked time
  + existing appointments
  + service duration
  + buffers before and after
  + minimum booking notice
  + booking horizon
  + business timezone
  ─────────────────────────
  = bookable start times
```

Storing slots would mean every change to a rule, a service duration or a
booking has to fan out and rewrite a table. Computing them means there is
exactly one definition of "free", and it cannot go stale.

The engine is deterministic: `now` is an input, never `Date.now()` inside a
function. That is what makes 24 scenario tests possible without freezing time.

### Where it runs, and why

The engine runs **on the client**, over a context fetched in one round trip
from `public.get_availability_context`. That function returns the raw
ingredients -- rules, exceptions, and anonymous busy ranges -- rather than a
list of slots.

Two consequences, both deliberate:

1. Moving between days in the date picker costs no network calls.
2. There is one implementation of the slot arithmetic, in TypeScript, shared
   by web, iOS and Android.

The busy ranges carry no customer, no service and no appointment id. A
stranger learns exactly what they would learn anyway by looking at which times
are offered.

### What the client decides, and what it cannot

The engine decides what to **offer**. The database decides what to **accept**.
`public.book_appointment` re-validates working hours, exceptions, blocks,
minimum notice and booking horizon server-side, then inserts inside a
transaction guarded by an exclusion constraint.

A crafted request that skips the UI entirely gets rejected by the same rules.

### The availability API

`public.get_available_slots(professional, service, date)` is the authoritative
answer to "what can be booked". It reads the same helpers `book_appointment`
uses to decide what may be accepted -- `working_windows` for the shifts, the
same closures, busy ranges, buffers, interval, notice and horizon -- so the
two cannot drift apart.

The professional-side preview screen renders its result directly and computes
nothing of its own. That is the point of the screen: a disagreement between
the engine and the database would be visible instead of hidden.

`get_availability_context` still exists and still returns the raw ingredients
for a whole date range, which is what makes moving between days in a picker
free. The two are complementary: the context is a fast local model, the slot
API is the authority.

## Preventing double booking

See [DATABASE.md](DATABASE.md#no-double-booking). In short: a GiST exclusion
constraint on `(professional_id, blocked_range)` restricted to the statuses
that occupy the calendar. Two concurrent bookings for the same time cannot
both commit -- PostgreSQL refuses the second one, and the API turns that into
a `SLOT_TAKEN` the customer can act on.

## Timezones

Every appointment is stored as `timestamptz`, an absolute instant. Every
business carries an IANA timezone (`America/Santo_Domingo`,
`America/New_York`, `Europe/Madrid`). Wall-clock text is never stored for
anything that matters.

Working hours are the exception that proves the rule: they are stored as local
`time` values, because "I open at nine" means nine o'clock wherever the
business is, including across a daylight saving change. They are resolved to
instants at the moment of computation, against the business timezone.

## Payments

`PaymentProvider` in [`src/services/payments/types.ts`](../src/services/payments/types.ts)
is the seam. `MockPaymentProvider` is the only implementation today. Azul,
CardNET or Stripe adapters slot in behind the same interface, and no screen
changes.

The payment lifecycle is an explicit state machine, so an adapter cannot
invent its own transitions.

## Multi-tenant from day one

`businesses` is the tenant boundary. `business_members` says who may act on
behalf of one. A business may have many professionals, and a professional
profile may exist without a user account at all -- a chair, a room, a piece of
equipment.

Nothing in the schema assumes one user equals one business.
