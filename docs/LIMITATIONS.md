# What this beta does not do

One page, so that nothing in the demo is mistaken for something that works.

Everything here is a deliberate decision, not a defect. Most of it follows
from one rule: **no integration that costs money is switched on while the
product is still being built.** Where a real provider would go there is an
abstraction and a mock, so that connecting one later is a change of
implementation rather than a change of design.

## Money

- **No real payment provider is connected.** Not Azul, not CardNET, not
  Stripe, not any other. No merchant account exists.
- **No money moves.** The demo checkout is a `MockPaymentProvider`. It is
  switched off by default and says, in both languages, that no real charge is
  made.
- **No card data is handled anywhere** — not entered, not stored, not
  transmitted. There is no field for one.
- **No payouts, no marketplace, no platform fee.** Each business owns its own
  payment relationship; the platform never holds anybody's money.
- **Azul is a placeholder.** A customer looking at an unpaid booking gets a
  button that, when pressed, says card payment is not available yet and that
  nothing has been charged. A professional in Settings gets a disabled
  *Connect Azul — coming soon* and a line saying they would need their own
  merchant account. There is no gateway behind either, no merchant account and
  no request.
- **No taxes, tips, discounts or coupons.**

## Messages

- **Nothing is ever sent.** No email, no SMS, no WhatsApp, no push.
- There **is** an in-app conversation on each appointment, and it is the only
  channel that works. A professional can tell a customer "I have to move
  Thursday" and the customer will read it -- the next time they open their
  booking link or their account. Nothing notifies them that it is there.
- Notifications are composed, queued in an outbox and delivered by a
  `MockNotificationProvider`. The queue and its state are real and visible in
  the application; the delivery is not.
- **Password reset has never been exercised**, because it needs email. A
  forgotten password in the beta means somebody creating another account.
- Reminders are scheduled, rescheduled and cancelled correctly. None arrives.

## Distribution

- **No App Store, no Google Play.** No developer account exists with either.
- **No native build.** The product runs as a web application, installable from
  a browser. Expo Go can load it on a phone over the local network.
- **The public deployment is GitHub Pages, and it is a demo.** It is served
  as a static site from the repository, it asks search engines not to index
  it, and it talks to the *development* Supabase project. It is not a
  production environment and nothing about it is sized or monitored as one.

## Content and language

- The interface is Spanish and English. **What a business types is not
  translated** — a service called "Corte de cabello" is called that in both.
  That is deliberate: machine-translating somebody's price list is worse than
  leaving it alone.
- Notifications are written in the language the customer booked in, and stay
  in it.

## Data and privacy

- **Use fictional data.** This release candidate is not approved for real
  customers' personal information, because the decisions that would make that
  responsible have not been made.
- **Nothing is ever deleted.** No retention period exists — see
  [PRIVACY.md](PRIVACY.md).
- **No way to ask for deletion or export.**
- **No legal basis, notice or consent wording**, because inventing one would
  be worse than having none.
- No analytics, no tracking, no third-party scripts.

## Scale and operations

- One Supabase project, on the free tier. No production project.
- **The notification dispatcher is not deployed anywhere.** It is a portable
  script somebody runs; nothing drains the outbox on a schedule.
- No backups beyond Supabase's own.
- No uptime monitoring, no alerting, no on-call.
- No rate limiting beyond what Supabase does by default.

## Accounts

- No password reset (above), no email verification, no two-factor
  authentication, no single sign-on.
- One person per business. **No staff accounts, no roles beyond owner.**
- A customer account is **optional** and adds nothing to booking: it exists so
  somebody can find their appointments again without the link. An appointment
  becomes theirs by claiming it with that link, and a claimed one is never
  reassigned to a second account.

## Deliberately out of scope so far

Recurring appointments · waiting lists · packages and memberships · loyalty ·
reviews · a public directory or marketplace · inventory · invoicing and
accounting · reporting beyond the dashboard's counts · calendar sync with
Google or Apple · multi-location businesses · staff scheduling.

None of these is refused. None is built.
