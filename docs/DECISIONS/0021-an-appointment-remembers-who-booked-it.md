# 0021 - An appointment remembers who booked it

**Date:** 2026-09-22
**Status:** Accepted. Extends
[0018](0018-customer-matching-is-deliberately-timid.md).

## Context

`customers` is a reusable record on purpose: one person, one row per business,
found again by phone number so that a returning customer is recognised without
an account. Every booking rewrites that row with the name given most recently.

Every appointment then read through to it. So the reuse that makes "the same
person" work also made the past editable: correcting a spelling, or one person
booking once under a nickname, silently changed who a months-old appointment
says was there.

It was not theoretical. In the development project a guest booked as
"Lucía Fernández", booked again as "Lucia Fernandez", and the first appointment
changed its mind about her name. With notifications arriving, the same record
also decides who a message is addressed to, and at what address.

The service on an appointment had been snapshotted since the first schema, for
exactly this reason -- editing a price does not rewrite what a past appointment
cost. The customer simply had not been given the same treatment.

## Decision

An appointment carries `customer_name_snapshot`, `customer_phone_snapshot` and
`customer_email_snapshot`, frozen at the moment of booking.

`customer_id` still points at the reusable record, and that is still what makes
a returning customer one person rather than five. The three facts a human reads
-- and that a notification is addressed with -- no longer move.

Filled by a `BEFORE INSERT` trigger rather than by the booking functions, so no
path can forget: both booking RPCs write the customer row and then insert the
appointment, so the record already holds exactly what this booking said.

An `UPDATE` that tries to change a snapshot raises
`APPOINTMENT_IDENTITY_IS_IMMUTABLE`. Restoring the old value silently would
hide the bug; the whole point of the column is that a quiet rewrite is the
failure being prevented.

Every read was moved across in the same change: the professional's appointment
list and detail, and `get_appointment_by_token`, which is what a guest's
confirmation page shows. A snapshot nobody reads is not a snapshot.

## Consequences

- A message says the name the customer gave when they booked, at the address
  they gave then. Editing the customer record later does not rewrite history,
  and cannot redirect a queued message.
- `get_appointment_by_token` no longer joins `customers` at all, which is one
  fewer table a `SECURITY DEFINER` function touches for an anonymous caller.
- Correcting a customer's name genuinely does not correct it on past
  appointments. That is the trade, taken deliberately: a record of what
  happened is worth more than a tidy one.
- This is still not a CRM. Nothing here tracks a customer's history, merges
  duplicates or reconciles records. It stops the past from changing, and
  nothing more.
