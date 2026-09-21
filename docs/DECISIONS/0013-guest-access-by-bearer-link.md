# 0013 - A guest's appointment is reached by a bearer link

**Date:** 2026-09-21
**Status:** Accepted

## Context

The MVP promise is that a customer books without an account. That leaves a
question with no comfortable answer: after booking, how does that person come
back to see or cancel their appointment?

The options were an account (which the whole phase exists to avoid), a
one-time code sent by SMS or email (which needs a paid channel, and email is
optional), or a capability in the link itself.

## Decision

Each appointment carries an unguessable `access_token` (a v4 UUID, 122 bits of
entropy). It is returned once, at booking time, and the confirmation URL
carries it:

```
/booking/<appointment id>/confirmation?token=<access token>
```

`get_appointment_by_token` and `cancel_appointment_by_token` require both the
id and a matching token, and return `PT404` otherwise. `anon` has no read
access to `appointments`, `appointment_items` or `customers` at all.

## Consequences

Guessing an appointment id gets nothing. Holding one guest's token and another
guest's id gets nothing either -- both are asserted in
`supabase/tests/public_booking.sql`.

The honest cost: **the link is the credential.** Anyone who has it can view
and cancel that booking. It lands in browser history, and it will be pasted
into chats. The confirmation page says so in plain words rather than pretending
otherwise, because a customer forwarding their own appointment link to a
partner is a normal thing to do and the consequence should not be a surprise.

What the token gets you is deliberately narrow: one appointment, the business
it is with, and how to reach them. Never another booking, never a customer
record, never a calendar.

Two things would sharpen this later, and neither belongs in the MVP: putting
the token in the URL fragment so it is not sent to the server or written to
access logs, and expiring it once the appointment is over. Phase 6 is the place
for both.
