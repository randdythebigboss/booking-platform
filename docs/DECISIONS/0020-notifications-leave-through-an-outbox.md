# 0020 - Notifications leave through an outbox

**Date:** 2026-09-22
**Status:** Accepted

## Context

The product has to tell customers things: that a booking is confirmed, that it
moved, that it was cancelled, that it is tomorrow. Every way of sending those
involves somebody else's service, and somebody else's service is down
sometimes.

The tempting shape is to send from the booking function. It is one fewer moving
part, and the message goes out immediately. It also means an email provider
having a bad afternoon can fail a booking that was otherwise perfect, or -- if
the send is inside the transaction and the transaction later rolls back -- send
a confirmation for an appointment that does not exist.

There is a second problem, quieter than the first. A retry is the natural
response to a failed send, and a retry without an identity for the message is
how a customer receives the same email four times.

## Decision

Nothing in a booking transaction talks to a provider. Appointment writes
produce events, events queue rows in `public.notifications`, and a dispatcher
drains that table:

```
appointment write
  -> appointment_events        (the log that already existed, Phase 5)
    -> notifications           (this table)
      -> dispatcher
        -> provider adapter
          -> delivery result, recorded back
```

Four decisions hang off that shape.

**Queued from the event log, not from the RPCs.** The log is written by a
trigger and cannot be bypassed, so neither can the notification. A direct
`UPDATE` that Row Level Security permits produces an event and therefore
produces the message it should -- which is how a support fix made in SQL still
tells the customer.

**Idempotency is a unique column.** `dedupe_key` is derived from the event for
anything caused by one, and from the appointment plus the instant it is for in
the case of a reminder. A retried worker, a replayed event, a double-submitted
form and a re-run of the trigger all collide on the same key, and the second
one does nothing.

**The message is frozen when it is queued.** Language, recipient, customer
name, service, time: all copied onto the row. A message already waiting does
not change language because a professional switched the interface, and does not
change name because the reusable customer record was edited (ADR 0021).

**The trigger is deferred to commit.** `book_appointment` inserts the
appointment and then its items; an immediate trigger would build a payload that
could not name the service. Deferring also means the message describes the
state the transaction actually committed.

## Consequences

* A provider outage delays messages. It cannot fail a booking, and it cannot
  produce a message for a booking that did not happen.
* Everything is inspectable. `notifications` is readable by members of the
  business through RLS, which is what the operational screen runs on -- no
  service key, no SQL client.
* The dispatcher needs a connection no browser has: `claim_due_notifications`
  and its siblings are revoked from `anon` and `authenticated`. In development
  that is `npm run notifications:dispatch`; in production it will be whatever
  runs on an operator's host. That is a deliberate boundary, not a gap.
* Sending is bounded: five attempts, doubling backoff capped at an hour, and a
  failure the provider says is permanent is not retried at all. A claim that a
  dispatcher never finished is put back by `requeue_stalled_notifications`
  **without** giving back the attempt it burned -- it may have sent before it
  died, and a crash loop must not become a hundred copies.
* Today one channel is queued: email, and only when the booking left an
  address. The enum carries `sms`, `whatsapp`, `push` and `in_app` so that
  adding one is an adapter plus a line in `notification_recipient_for`, not a
  schema change. A booking with no email is still a booking; there is simply
  nothing to queue, and that is not an error.
