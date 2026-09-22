# Personal information in this product

Engineering documentation: what personal information the product stores, where
it lives, and why it is there. **Not a privacy policy.** A policy states
retention periods, a legal basis and the rights a person has, and none of
those has been decided. Where that shows, it is flagged rather than invented.

## What is stored

| Category | Where | Why it exists | Who can read it |
| --- | --- | --- | --- |
| **Professional identity** — name, email, password hash | `auth.users`, `public.profiles` | Signing in, and addressing the shop in its own language | The person themselves; `auth.users` is never read by the client |
| **Business details** — name, slug, description, phone, email, address, timezone | `public.businesses` | The public booking page, and where notifications to the shop go | Anyone, for a *published* business — this is the shop's shopfront |
| **Professional profile** — display name, bio | `public.professional_profiles` | Who the customer is booking with | Anyone, for a published business |
| **Customer identity** — name, phone, optional email | `public.customers` | Recognising a returning customer within one business (ADR 0018) | Members of that business only |
| **Customer identity, frozen** — name, phone, email as given at booking | `public.appointments.customer_*_snapshot` | So a past appointment does not change its mind about who was there (ADR 0021) | Members of that business; the guest holding the booking link sees their own |
| **Appointment** — time, service, price snapshot, notes, language | `public.appointments`, `public.appointment_items` | The booking itself | Members of that business; the guest holding the link |
| **Appointment history** — every status change and move, with the actor | `public.appointment_events` | Answering "what happened to this booking, when, and who did it" | Members of that business. **Never the guest** |
| **Notification recipient** — an email address, plus name, service and time in the payload | `public.notifications` | Sending the message the booking implies | Members of that business. `anon` has no privilege at all |
| **Payment records (demo)** — amount, currency, status, provider reference | `public.payments`, `public.payment_events` | What was owed and what happened to it | Members of that business. `anon` has no privilege at all |
| **Guest booking credential** — an unguessable token | `public.appointments.access_token` | Letting a guest manage their own booking without an account (ADR 0019) | Only whoever holds the link. Never logged, never in a notification, never in a URL a server sees |

## What is deliberately not stored

* **No card data.** No PAN, no CVV, no token that could stand in for one. No
  real payment provider is connected; what a provider would return is a
  reference and a status.
* **No provider credentials.** Nothing in the schema holds a secret for a
  payment or messaging provider. The extension point is unbuilt on purpose.
* **No device, browser or IP identifiers.** Nothing fingerprints a visitor.
  The hold-abuse control identifies a customer by the phone number they gave,
  within one business, and nothing else.
* **No location beyond the business's own address and timezone.**
* **No analytics, no tracking, no third-party scripts.** The web build loads
  its own bundle and talks to Supabase. Nothing else.

## Where it lives

One Supabase project per environment. Today that is one development project,
in `us-east-1`, on the free tier. There is no production project, no second
copy, no export, and no backup taken outside Supabase's own.

Every table has Row Level Security, and the boundary is the business: one
business cannot read another's customers, appointments, history, messages or
payments. A guest reads exactly one appointment, through a token.

## What a browser keeps

* The Supabase session (an access token and a refresh token), in
  `localStorage`, which is how staying signed in works.
* The chosen language, in `localStorage`.
* The service worker caches **only** the application's own static build
  output. No page, no API response, no appointment, no personal information of
  any kind. See `public/sw.js`.

## Decisions nobody has made yet

These are gates before real users, not oversights:

* **Retention.** Nothing is ever deleted. Not a sent notification and its
  recipient address, not a payment record, not appointment history. Accounting
  and dispute windows argue for keeping payment records considerably longer
  than message records; both periods are open.
* **Deletion on request.** There is no way for a customer to ask for their
  data to be removed, and cascading a deletion through appointments, history
  and payments needs a decision about what history is allowed to lose.
* **Export on request.** Same.
* **Who the controller is.** The platform holds the data; each business
  decides what it collects. That relationship needs stating before real
  customers exist.
* **Legal basis, notice and consent** wording for a real customer.
