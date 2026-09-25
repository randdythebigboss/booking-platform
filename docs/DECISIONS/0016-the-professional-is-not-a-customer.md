# 0016 - The published grid is a promise to customers, not a constraint on the owner

**Date:** 2026-09-23
**Status:** Accepted

## Context

Phase 5 added two ways for a professional to write to their own calendar:
entering an appointment manually, and moving one.

The public booking rules exist to make a promise to a stranger: these are the
times I offer, this is how much notice I need, this is how far ahead I take
bookings. Applying that same rule set to the owner of the calendar produces
absurd outcomes -- a professional cannot enter the walk-in standing in front
of them because it is inside their own minimum notice period, and cannot say
"come at ten past ten" because ten past ten is not on the fifteen-minute grid
they publish.

Applying no rules at all is equally wrong: an appointment that overlaps
another one, or lands on a period the professional deliberately blocked, is a
mistake however it was created.

## Decision

Two rule sets, named and separated.

| Rule                             | Guest  | Professional                 |
| -------------------------------- | ------ | ---------------------------- |
| Tenant authorization             | n/a    | **always**                   |
| Business active                  | always | **always**                   |
| Business published               | always | not required                 |
| Overlap with another appointment | always | **always**                   |
| Blocked time                     | always | **always**                   |
| Service duration and buffers     | always | **always**                   |
| Working hours and exceptions     | always | unless explicitly overridden |
| Slot interval alignment          | always | never                        |
| Minimum notice                   | always | never                        |
| Booking horizon                  | always | never                        |

The guest path is unchanged and unweakened: `book_appointment` and
`reschedule_appointment_by_token` enforce every row of the first column, using
the same helpers, so the two cannot drift.

Overlap and blocked time are never relaxed, and the overlap guarantee is not a
check at all -- it is the same GiST exclusion constraint that has prevented
double booking since Phase 0.

Working hours sit behind an explicit `p_override_schedule` flag rather than
being dropped, so the ordinary case ("book my regular into a normal slot")
still catches a typo, and the deliberate case ("I am staying late for this
one") is a thing the professional said rather than a thing that happened.

## Consequences

**An off-grid appointment cannot leak off-grid availability.** The engine
generates candidate starts from the grid and then subtracts busy time, so a
13:07 squeeze-in removes the grid slots it overlaps and adds nothing. A
professional working until 21:00 for one customer does not start advertising
21:00 to everyone. Both are asserted in
`supabase/tests/appointment_lifecycle.sql`.

**Rescheduling is orthogonal to status.** Moving an appointment is the same
commitment at a different time, not a lifecycle transition: a pending
appointment that moves is still pending. The state machine in ADR 0014 is
unchanged, and terminal appointments cannot be moved at all.

**A move is one `UPDATE`.** The exclusion constraint is checked as part of
that statement, so either the appointment holds the new time or the
transaction rolls back and it still holds the old one. There is no window in
which the original slot has been released and the new one not yet acquired --
which is what makes rescheduling safe to offer to a guest who may lose a race
to somebody refreshing the public page.

**A professional may move an appointment that has already begun; a guest may
not.** The guest is refused because moving something already under way is a
conversation with the shop, not a self-service action. The shop, having had
that conversation, has to be able to act on it -- and moving the appointment
keeps the customer, the snapshot and the history that cancel-and-rebook would
throw away. The asymmetry is asserted in the suite so that it is not later
mistaken for an oversight.

**Customer identity stays as it was.** `customers` is unique on
`(business_id, phone)`, and manual booking upserts on it exactly as
`book_appointment` does. Phone is the identity of a guest customer within one
business; names are never matched on, because two people called Maria are two
people. This is deliberately not a CRM, and merging on anything looser would
be a privacy decision rather than an engineering one.
