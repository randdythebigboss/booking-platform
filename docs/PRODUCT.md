# Product

## What it is

A platform where anyone who works by appointment publishes their availability
and receives bookings.

Not a haircut app. The domain is professional services booking, and the
language, the design and the data model all stay neutral: barbers, stylists,
manicurists, trainers, tutors, photographers, consultants, masseurs,
technicians, and businesses with one professional or twenty.

## The promise

**Professional:** set up a profile, add services, set working hours, share a
link, receive bookings.

**Customer:** open the link, pick a service, pick a time that is actually
free, leave a name and a phone number, done.

A booking should take under a minute, and the customer must never be required
to install anything or create an account.

## Roles

**Professional.** Manages their profile and business, creates services with
durations and prices, sets weekly availability, blocks days and periods, sees
their calendar and bookings, confirms, cancels and completes appointments,
and shares their public page.

**Customer.** Books as a guest in the MVP: sees the public profile and
services, checks availability, picks a date and a time, enters their details,
books, gets a confirmation, and can cancel within policy. Later, an optional
account adds history, saved professionals and faster repeat bookings.

**Platform admin.** Not built in the first version, but the model allows for
it: businesses, subscriptions, reports, global configuration, support,
moderation.

## MVP

The professional can:

1. Create an account
2. Create a business and public profile
3. Create services with duration and price
4. Set a weekly schedule
5. Block specific dates and periods
6. See their calendar and appointments
7. Change appointment status
8. Share a public link

The customer can:

1. Open the link
2. See the professional and their services
3. Pick a service and a date
4. See only genuinely available times
5. Enter name, phone, optional email
6. Confirm, and see a confirmation

## Definition of done

The MVP is complete when all fifteen of these hold:

- [x] A professional can create a business
- [x] ...and a service
- [x] ...and a schedule
- [ ] ...and block a time _(the database and the engine handle blocks; the
      screen arrives with the calendar in Phase 4)_
- [x] ...and get a public link
- [ ] A customer can open that link in a browser
- [ ] ...select a service
- [ ] ...see real availability
- [ ] ...and book
- [ ] The appointment appears immediately in the professional's calendar
- [ ] That time stops being offered
- [x] Two customers cannot book the same slot _(enforced by the database; the
      exclusion constraint and `book_appointment` are in place)_
- [ ] The professional can cancel or complete the appointment
- [ ] It works on web, Android and iOS
- [x] Security rules prevent access to another business's data _(proved by
      `supabase/tests/tenant_isolation.sql` in CI)_

## Not in the MVP

Marketplace, reviews, chat, loyalty, coupons, memberships, payroll,
commissions, complex invoicing, AI, advanced multi-location, POS, paid SMS,
paid WhatsApp API, accounting, Apple/Google Calendar sync, customer
subscriptions, app store deployment.

The architecture allows for them. None of them may distract from the MVP.

## Roadmap

**Phase 0 - Foundation.** Repository, Expo scaffold, TypeScript, Expo Router,
Supabase structure, environment handling, CI, architecture documentation.
_Done._

**Phase 1 - Professional setup.** Authentication, business onboarding,
professional profile, services, weekly availability. _Done._

**Phase 2 - Scheduling engine.** Slot calculation, exceptions, blocked times,
appointment validation, double-booking protection, timezone handling.
_Engine and database side done in Phase 0; the UI lands here._

**Phase 3 - Customer booking.** Public page, service selection, calendar,
slots, guest details, booking, confirmation. _Next._

**Phase 4 - Professional calendar.** Dashboard, calendar, appointment detail,
status updates, manual blocks, cancellation.

**Phase 5 - Payment foundation.** Payment domain model, mock payment, state
machine, provider abstraction. _Abstraction done in Phase 0._

**Phase 6 - Production hardening.** Security audit, RLS validation,
concurrency testing, accessibility, performance, error handling, analytics,
backups, privacy documentation.

**Phase 7 - Distribution.** Google Play, App Store, production Supabase,
production domain, a real payment provider, notifications.

## Cost

The MVP target is **US$0 of infrastructure**: GitHub Free, Supabase Free,
Expo Free.

No paid service, no credit card, no subscription, and no API with unavoidable
cost may be introduced without the product owner's approval.
