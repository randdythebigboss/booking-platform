# 0005 - A GiST exclusion constraint prevents double booking

**Date:** 2026-09-19
**Status:** Accepted

## Context

Two customers can press "book" on the same time in the same instant. Checking
for a conflict and then inserting is a race, no matter how short the window.

Options: optimistic checks in application code, `SERIALIZABLE` transactions,
advisory locks alone, or a database constraint.

## Decision

A GiST exclusion constraint on `appointments`:

```sql
exclude using gist (professional_id with =, blocked_range with &&)
  where (status in ('pending', 'confirmed'))
```

`book_appointment` additionally takes `pg_advisory_xact_lock` on the
professional.

## Consequences

Double booking is impossible, not unlikely. The guarantee holds against
concurrent requests, retries, a buggy client, curl, or a direct SQL insert --
anything that is not a schema change.

The advisory lock is an optimisation only: it serialises attempts on one
calendar so the loser waits briefly instead of rolling back. Removing it would
not weaken the guarantee.

`blocked_range` includes buffers, so a constraint violation means "these two
appointments cannot coexist", buffers and all.

Cancelled, completed and no-show appointments fall outside the predicate and
release their time automatically.

`btree_gist` must be enabled for the `professional_id with =` half.
