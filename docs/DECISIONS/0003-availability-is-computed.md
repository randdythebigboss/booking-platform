# 0003 - Availability is computed, never stored

**Date:** 2026-09-19
**Status:** Accepted

## Context

The obvious design is a `slots` table with one row per bookable time, marked
free or taken.

## Decision

There is no slots table. Availability is derived on demand from weekly rules,
exceptions, blocks, existing appointments, service duration, buffers, minimum
notice, booking horizon and the business timezone.

## Consequences

Changing a working hour, a service duration or a buffer takes effect
immediately, everywhere, with no backfill.

There is exactly one definition of "free", so the professional's calendar and
the customer's booking page cannot disagree.

Different services produce different slots for the same day, which a stored
table would have had to duplicate per service.

The cost is that every availability query does real work. It is small work --
interval arithmetic over a handful of ranges -- and one fetch covers a whole
date range.
