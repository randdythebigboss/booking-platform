# 0011 - The slot grid is anchored to the shift start

**Date:** 2026-09-20
**Status:** Accepted

## Context

`book_appointment` re-validated working hours, exceptions, blocks, minimum
notice, booking horizon, service ownership and overlap -- but not
`slot_interval_minutes`. A request that skipped the UI could book 09:07 on a
calendar that only ever offers 09:00, 09:15, 09:30 and 09:45.

That is a policy bypass rather than a safety one: no double booking, no escape
from working hours. It still lets a caller fragment a professional's day in a
way the professional never agreed to.

There are two plausible grids. Align to midnight, or align to the start of the
working window the appointment falls in.

## Decision

The grid starts where the shift starts, and the database enforces it.

`working_windows` was extracted so that containment and alignment read one
definition of "when is this person open", and `is_slot_aligned` requires the
offset from the containing window's start to be a whole number of intervals.

## Consequences

This matches the engine exactly. `computeAvailableSlots` steps from
`window.start`, so a professional who opens at 09:10 is offered 09:10 and
09:25 -- what they asked for. Aligning to midnight would have offered 09:15
and silently contradicted the schedule they configured.

The offset is measured in real elapsed time from a window start derived from
business-local wall clock, so it stays correct across a daylight saving
transition: the shift moves with the local clock, and the grid moves with it.

The grid belongs to the business, not to the service. Every duration lands on
the same marks, which is what makes a calendar readable.

A misaligned request now fails with `SLOT_NOT_ALIGNED`, distinct from
`OUTSIDE_AVAILABILITY`, so the client can say something useful rather than
claiming the professional is closed.

One consequence to accept knowingly: a manual booking made through the RPC at
an arbitrary time is refused too. When Phase 4 adds professional-side manual
bookings, they will need a path that is explicitly allowed to ignore the grid,
because a professional squeezing someone in at 09:07 is legitimate in a way a
stranger doing it is not.
