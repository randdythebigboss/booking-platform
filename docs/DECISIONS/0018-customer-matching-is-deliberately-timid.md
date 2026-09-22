# 0018 - Customer matching is deliberately timid

**Date:** 2026-09-24
**Status:** Accepted

## Context

A customer belongs to a business and is identified by phone within it:
`customers` has been unique on `(business_id, phone)` since Phase 0, and both
booking paths upserted on it.

The comparison was on the raw string. "+1 809 555 0199" and "+1(809)555-0199"
are the same number and were two rows, each collecting half of somebody's
history.

## Decision

A generated column, `phone_normalized`: every non-digit removed, a leading
`+` kept if there was one. Lookups go through `find_customer_by_phone`, which
tries the exact string first and then the normalised one.

**It does not infer a country code.** `8095551234` and `+18095551234` stay two
people here. They may well be one, and deciding so means guessing a country
from a phone number.

The two errors are not symmetric:

- **Under-merging** leaves a duplicate row. Untidy; recoverable.
- **Over-merging** shows one person another person's appointments, name and
  phone number. A privacy incident; not recoverable.

Only one of those is worth risking to save a row.

**Nothing is rewritten and no constraint is replaced.** The unique on
`(business_id, phone)` stays exactly as it was and the new index is not
unique. A migration that tightened the constraint would have to merge whatever
duplicates already exist -- deciding which name survives and repointing
appointments -- and would simply fail to apply against data where two rows
normalise the same. This migration cannot fail that way, because it adds a way
to *find* a customer rather than a new rule about which may exist.

**The business boundary is not crossed to answer the question.** A person who
books at two shops is two customer rows, on purpose. Merging them would let
one shop read another's book, which is the tenant boundary the whole schema is
built around.

`find_customer_by_phone` is `INTERNAL ONLY`: it answers "which customer is
this phone number", which is precisely what a stranger would like to ask a
business about its book.

## Consequences

A returning customer who types their number differently now lands on their own
row, keeps their history, and keeps an email they gave once and omitted later.
The name from the most recent booking wins, as it did before.

This is not a CRM and does not become one. There is no merge tool, no
deduplication job, and no matching on name or email -- two people called María
are two people.

If a business later needs genuine deduplication across country-code variants,
that is a product decision with a privacy dimension, and it needs a person to
confirm each merge rather than a regular expression to assume it.
