# 0022 - The appointment is the hold

**Date:** 2026-09-22
**Status:** Accepted

## Context

A service that has to be paid for introduces a gap between choosing a time and
owning it. Somebody needs a few minutes for a card form, a bank app, a
one-time code. In those minutes, the obvious failure is the expensive one:

```
customer picks 10:00 -> starts paying -> somebody else books 10:00
-> the first customer's money arrives for a slot that is gone
```

Refunding afterwards is not a fix. It is an apology, and it costs the shop the
appointment either way.

The other direction is worse: reserving nothing until the money lands means a
customer can pay and find the time taken. And neither can be solved by
"wrapping it in a transaction", because one half of the work happens inside
PostgreSQL and the other half happens at a bank. There is no transaction that
spans those, and pretending otherwise is how systems end up with money that
matches nothing.

## Decision

**The appointment is the hold.** A booking that owes money is created
immediately, occupying the slot through the same GiST exclusion constraint
that has prevented double booking since the first schema, and carries
`hold_expires_at`, fifteen minutes out.

- Pay, and the expiry is cleared and the booking becomes what the business's
  own setting says a booking is: confirmed, or waiting to be accepted.
- Walk away, and it lapses and the slot is somebody else's again.
- A card is declined, and the hold _stands_ until it lapses -- somebody
  mistyping a number should not lose their slot while they reach for another
  card. The retry is a new payment row, so the history counts the attempts.

Expiry happens without a scheduler, which is the part that makes this work
without anything to deploy:

- **Reads** never show a lapsed hold as busy. Availability treats
  `hold_expires_at < now()` as free, so the slot comes back the instant the
  hold runs out, whether or not anything has cleaned it up.
- **Writes** cannot collide with one. `expire_payment_holds` runs inside the
  advisory lock every booking already takes, so a lapsed hold is cancelled
  before the new booking is checked against it.
- **Nothing rots.** The availability read that every public booking page makes
  releases what it finds, so the cleanup happens wherever customers are
  looking.

Fifteen minutes is a constant in a function, not a column. Nobody has asked to
configure it, and a setting nobody changes is a setting to maintain.

## What was rejected

**A separate `holds` table.** It would need its own overlap rules, its own
race, and its own way of being reconciled with appointments: three chances to
disagree with a constraint that is already correct.

**Booking only after payment.** The slot is unprotected for exactly as long as
the payment takes, which is the failure above with extra steps.

**Faking atomicity.** No two-phase commit against a payment network, no "mark
it paid and fix it later". The database is authoritative about the calendar,
the provider is authoritative about the money, and one function --
`apply_payment_outcome` -- is where the two meet.

## Consequences

- A slot can be occupied by somebody who never pays, for up to fifteen
  minutes. That is the cost, and it is bounded.
- A payment arriving after its hold lapsed is **refused**, not taken:
  `PAYMENT_HOLD_EXPIRED`. Taking it would be the exact failure this design
  exists to prevent.
- Nothing rate-limits how often one person may start a checkout. A determined
  visitor could hold successive slots fifteen minutes at a time. Worth
  revisiting before a public beta; not worth building against nobody.
- Free bookings are untouched. No hold, no payment row, and the behaviour is
  exactly what it was.
