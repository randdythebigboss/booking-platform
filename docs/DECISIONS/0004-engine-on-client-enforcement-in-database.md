# 0004 - The engine runs on the client; enforcement lives in the database

**Date:** 2026-09-19
**Status:** Accepted

## Context

Slot computation could live in SQL (one `get_available_slots` function) or in
TypeScript on the client. Whichever is chosen, the server still has to refuse
a booking that skips the UI.

## Decision

The slot engine is TypeScript in `src/features/availability`, fed by a single
`get_availability_context` call that returns rules, exceptions and anonymous
busy ranges for a date range.

The database independently re-validates working hours, exceptions, blocks,
notice and horizon inside `book_appointment`.

## Consequences

Moving between days in the date picker is instant and free -- no round trip
per day.

One implementation of the slot arithmetic serves web, iOS and Android, and it
is unit-testable in milliseconds without a database.

The duplication is real but bounded: the client answers "what should we
offer", the database answers "may this specific booking exist". The second is
a containment check, not a slot enumeration, and it is roughly 60 lines of
plpgsql.

The busy ranges exposed to the public carry no customer, service or
appointment identity -- only a start and an end, which a caller could infer
anyway from which times are offered.
