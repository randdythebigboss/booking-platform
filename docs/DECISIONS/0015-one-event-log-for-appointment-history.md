# 0015 - One event log, not a status history table

**Date:** 2026-09-23
**Status:** Accepted

## Context

Phase 5 was asked for an auditable status history, so that a future
correction workflow can preserve what actually happened rather than quietly
overwrite it. The same phase introduced rescheduling.

A reschedule is exactly as auditable an act as a cancellation. Both are things
a person did to somebody's appointment, both are things support will be asked
about, and both are things a payments or notifications feature will later need
to react to.

## Decision

One table, `appointment_events`, append-only, with an `event_type`
discriminator over `created`, `status_changed` and `rescheduled`.

The alternative -- `appointment_status_history` plus a separate reschedule
log -- means every question about an appointment has to be asked twice and the
answers merged by timestamp. That cost is paid on every read, forever, to save
one nullable column group on write.

Three properties matter more than the shape:

**It is written by a trigger, not by the RPCs.** A direct `UPDATE` that Row
Level Security permits still leaves a trace. History that only exists when
somebody used the front door is not history.

**It is append-only to every client.** There is a `SELECT` policy for members
of the business and no `INSERT`, `UPDATE` or `DELETE` policy at all. The only
writer is a `SECURITY DEFINER` trigger, which writes past RLS. The owner of
the business cannot forge, amend or erase a row, and that is the point.

**Attribution is not the caller's to choose.** The actor is declared through a
transaction-local setting by each RPC, and the function that sets it is
`INTERNAL ONLY`. A professional cannot sign their own action as the guest.
When nothing declared itself, a signed-in caller is recorded as a
professional and anyone else as `system` -- an unattributed change is recorded
as unattributed rather than mislabelled.

`occurred_at` defaults to `clock_timestamp()`, not `now()`. `now()` is the
transaction timestamp, so a status change and a move written by the same
statement would share an instant and the log would lose its order. This was
found by a test asserting that one appointment's history reads
`created -> rescheduled -> cancelled`; it read
`created -> status_changed -> rescheduled`.

## Consequences

Guests cannot read history. A customer holding a booking link sees their own
appointment; who inside the shop touched it is not theirs to read.

A transaction that performs several unrelated appointment writes would carry
the first declared actor across all of them. PostgREST gives every request its
own transaction, so this cannot arise through the API; a future batch job that
writes for more than one actor must re-declare between them.

Undo is still not implemented and terminal states are still terminal. This
table is what makes an explicit correction workflow possible later without
losing what was originally recorded.
