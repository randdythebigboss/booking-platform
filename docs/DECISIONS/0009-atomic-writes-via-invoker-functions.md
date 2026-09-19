# 0009 - Multi-step writes go through SECURITY INVOKER functions

**Date:** 2026-09-19
**Status:** Accepted

## Context

Three Phase 1 operations touch more than one table and must not half-happen:

- Onboarding writes a business, a membership and a professional profile.
- Saving a service writes the service and its assignment to professionals.
- Editing weekly hours deletes the old week and inserts the new one.

PostgREST gives one transaction per request, so doing these client-side means
a failure between calls leaves a business with no owner, a service nobody
offers, or a professional with no working hours.

## Decision

Each is a plpgsql function -- `create_business`, `save_service`,
`set_weekly_schedule` -- declared `SECURITY INVOKER`.

## Consequences

Each operation is one transaction, so it either happens or it does not.

`SECURITY INVOKER` is the point: Row Level Security still evaluates every
statement as the calling user, so these functions buy atomicity without
handing out privilege. That is the opposite trade-off from
`book_appointment`, which has to be `SECURITY DEFINER` because a guest has no
rights at all (see 0006).

They still check permission explicitly where a silent partial result was
possible: `set_weekly_schedule` refuses up front, because otherwise the
DELETE would quietly match no rows before the INSERT was rejected.

The cost is that some logic lives in SQL. It is bounded to writes that span
tables; ordinary single-table updates stay as plain PostgREST calls.
