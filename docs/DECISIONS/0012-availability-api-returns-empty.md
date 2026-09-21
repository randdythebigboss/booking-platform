# 0012 - The availability API answers with silence, not with errors

**Date:** 2026-09-21
**Status:** Accepted

## Context

`get_available_slots` will be called by the public booking page with
identifiers taken straight from a URL. A caller can put anything in them.

`book_appointment` raises named sentinels -- `SERVICE_NOT_AVAILABLE`,
`BUSINESS_NOT_PUBLIC`, `PROFESSIONAL_NOT_BOOKABLE` -- because someone
attempting a booking has already chosen a time and deserves to know why it
failed. Availability is different: it is read before any commitment, by
anyone, as often as they like.

Distinct errors there are an enumeration oracle. `BUSINESS_NOT_PUBLIC` tells a
stranger that the id belongs to a real but unpublished business; an empty
result tells them nothing at all.

## Decision

Every visibility failure returns zero rows: unpublished business, professional
not accepting bookings, inactive service, a service from another business, a
service this professional does not offer, a date outside the horizon, a date
in the past.

The rows themselves carry a start and an end. No reasons, no customer, no
appointment id, no schedule configuration.

## Consequences

A caller cannot distinguish "closed that day" from "that id does not exist",
which is the point.

The cost is that a legitimate booking page cannot explain _why_ a day is
empty. That is acceptable: "no times available, try another date" is the right
thing to show a customer regardless of which of those is true.

The professional side is unaffected -- the preview screen belongs to someone
who already has access, and it shows them the same silence the public would
see, which is exactly what makes it useful for checking their own setup.

Booking keeps its named errors. The two surfaces answer different questions
for different audiences, and the asymmetry is deliberate.
