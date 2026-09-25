# 0023 - Cancelling is not refunding

**Date:** 2026-09-22
**Status:** Accepted

## Context

Once a booking can be paid for, "cancel" stops being one word. A customer
cancelling an appointment they paid a deposit for, a shop cancelling because
the professional is ill, and a no-show that the deposit was taken to cover are
three different situations, and the right answer about the money is different
in each.

Nobody has decided what this product's answer is. There is no cancellation
policy, no notice window, no rule about who keeps a deposit, because those are
decisions for a business and its customers, not for a schema.

The tempting shortcut is to refund on cancellation and be done with it. It is
also how a shop that cancels a no-show at 9am gives away the deposit that
existed to cover exactly that.

## Decision

**They are two operations, and one never implies the other.**

- Cancelling an appointment does not touch its payment. An appointment can be
  `cancelled` while its payment is `paid`, indefinitely, and that is a valid
  state -- it means "this is not happening, and the question of the money is
  still open".
- Refunding is an explicit action a member of the business takes, through
  `refund_payment`, with its own button, its own reason field and its own
  event in the payment history. It does not cancel anything.
- The only automatic movement of money is in the other direction and is not a
  refund at all: a hold that lapses cancels the _pending_ payment that was
  waiting for it, because nothing was ever taken.

The interface says this out loud rather than leaving it to be discovered:
the refund control sits in the payment section, nowhere near Cancel, under a
sentence that says cancelling does not return the money.

## Consequences

- A business can keep a deposit, refund it, or decide later. The product has
  an opinion about none of these.
- Support can always answer "what happened to the money" separately from "what
  happened to the appointment", because the two histories are separate:
  `appointment_events` and `payment_events`.
- Partial refunds do not exist. A refund is for the amount that was paid.
  Anything else needs a decision about what a partial refund means for a
  deposit, and that decision has not been made.
- When a cancellation policy is eventually chosen, it can be built on top of
  this without unpicking anything: it becomes a rule about _when to call_
  `refund_payment`, not a change to what cancelling means.
- A refund still needs the provider to agree. With the mock it is immediate;
  with a real gateway, `refund_payment` will record the request and the
  provider's callback will move the status, which is why the request is its
  own event.
