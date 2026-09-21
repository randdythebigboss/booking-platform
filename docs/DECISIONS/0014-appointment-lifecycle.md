# 0014 - The appointment lifecycle is a graph, not a column

**Date:** 2026-09-22
**Status:** Accepted

## Context

`appointments.status` could hold any of its five values, and RLS let a member
of the business write any of them. Nothing stopped a cancelled appointment
being re-confirmed, or a booking three weeks out being marked "completed".

A row being technically updatable is not the same as a transition making
sense, and the difference is not cosmetic: the exclusion constraint that
prevents double booking only covers `pending` and `confirmed`.

## Decision

```
pending   -> confirmed | cancelled
confirmed -> completed | no_show | cancelled
completed, cancelled, no_show are terminal
```

Two rules beyond the graph:

- **completed and no_show require the appointment to have started.** You
  cannot have finished something that has not begun, and allowing it would
  release a future slot from the exclusion constraint while the customer still
  believes they are booked.
- **cancelled is terminal because cancelling frees the time.** Un-cancelling
  would make the appointment lose a race it never entered; the slot may
  already belong to someone else.

A trigger enforces it, so a direct UPDATE cannot route around the RPC. The RPC
touches status and the cancellation reason only, so a status change can never
become a way to rewrite a time, a customer or a price.

## Consequences

The professional UI can offer exactly the transitions the database accepts, so
nobody is shown a button that will be refused. Completed and no-show simply do
not appear until the appointment has started, with a line saying why.

Cancelling preserves everything: the row, the customer, the service snapshot,
the timestamp and the reason. Nothing is deleted, and the customer's history
survives.

**The known gap:** a mis-tapped "no-show" cannot be undone. That is a real
need and deliberately unsolved here, because the honest fix is an audit trail
of status changes rather than a back-arrow — a professional quietly flipping a
no-show to completed after the fact is exactly the kind of thing a business
later wants a record of. Phase 6.
