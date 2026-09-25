# Booking Platform

A booking platform for anyone who works by appointment: barbers, stylists,
tutors, trainers, photographers, therapists, consultants, technicians.
One professional or a whole team.

The professional sets up their services and working hours and shares one link.
The customer opens that link, sees the times that are genuinely free, and
books. No account required.

```
https://randdythebigboss.github.io/booking-platform/p/demo-studio
```

## Status

**Beta `0.1.0-beta.1`, live at https://randdythebigboss.github.io/booking-platform/**

The product is end to end and speaks two languages. A professional sets up
their business and hours, a customer books as a guest in under a minute with
no account, and either side can move or cancel that appointment before it
starts, and the two of them can talk about it inside the application.
Everything that happens to an appointment is recorded in an append-only log
that nobody can edit. Notifications are composed and queued; payments are
modelled, held and settled. A customer may keep an account, and never needs
one. It installs from a browser as an application.

**Nothing external is connected, and that is deliberate.** No payment provider,
no email or SMS provider, no store. Where a real one would go there
is an abstraction and a mock, so connecting one later is a change of
implementation rather than a change of design. What that means in practice --
no money moves, no message is ever sent -- is written down in
[docs/LIMITATIONS.md](docs/LIMITATIONS.md), in one page, so that nothing in a
demo is mistaken for something that works.

**Spanish is the product language.** English is the second. An unsupported
language falls back to Spanish, never to English. Dates, times, currency and
plurals follow the reader's language; the business timezone decides which
moment is being shown, and the two never influence each other. Business
content -- names, services, notes -- is shown exactly as it was entered and is
never translated.

| Phase | Scope                                                                                                 | State                        |
| ----- | ----------------------------------------------------------------------------------------------------- | ---------------------------- |
| 0     | Repo, Expo scaffold, CI, database schema, RLS, availability engine                                    | Done                         |
| 1     | Auth, business onboarding, services, weekly availability                                              | Done                         |
| 2     | Scheduling engine wired to the UI, exceptions, blocks                                                 | Done                         |
| 3     | Public booking page, guest booking, confirmation                                                      | Done                         |
| 4     | Professional dashboard, calendar, status changes                                                      | Done                         |
| 5     | Appointment history, rescheduling, manual booking                                                     | Done                         |
| 6     | Spanish + English, locale-aware formatting, product hardening                                         | Done                         |
| 7     | Real Supabase project, security audit, concurrency                                                    | Done                         |
| 8     | Notification outbox, reminders, dispatcher, mock provider                                             | Done                         |
| 9     | Payment domain, slot holds, refunds, mock provider                                                    | Done                         |
| 10    | PWA packaging, offline behaviour, accessibility, beta readiness                                       | Done                         |
| 11    | Release candidate: end-to-end suite, deployment package, release docs                                 | Done                         |
| 12    | Deployed to GitHub Pages as a free beta                                                               | Done                         |
| 13    | Product pass: date control, language toggle, setup guide, optional customer accounts, in-app messages | Done                         |
| —     | Real payment provider, real messaging, public deployment, stores                                      | **Not started, by decision** |

## Stack

React Native + Expo + Expo Router + TypeScript, one codebase for iOS, Android
and web. Supabase (PostgreSQL, Auth, Row Level Security) as the backend.

Everything runs on free tiers. No paid service is used, and none will be added
without the product owner's approval.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase project values
npm run start
```

To run the database locally you need Docker and the Supabase CLI:

```bash
npm run db:start
npm run db:reset             # applies migrations and loads the demo data
```

The demo booking page is then at `/p/demo-studio`, and the professional
sign-in for the local stack is `demo@bookingplatform.test` with the fixture
password in `supabase/seed.sql`.

That fixture password authenticates **a disposable local database and nothing
else**. The seed must never be loaded into a shared project; see
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Checks

```bash
npm run verify               # lint + typecheck + tests
```

## Documentation

| Document                                         | What it covers                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| [docs/PRODUCT.md](docs/PRODUCT.md)               | What the product is, who it serves, what is in and out of the MVP       |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)     | How the pieces fit, and where the availability engine lives             |
| [docs/DATABASE.md](docs/DATABASE.md)             | The data model, and how double booking is made impossible               |
| [docs/SECURITY.md](docs/SECURITY.md)             | Row Level Security, secrets, and the public API surface                 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)       | Working on this repo day to day                                         |
| [docs/OPERATIONS.md](docs/OPERATIONS.md)         | Running it: migrations, demo data, the dispatcher, supporting somebody  |
| [docs/BETA.md](docs/BETA.md)                     | What can be tested and installed for nothing, and what would cost money |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md)       | What this beta deliberately does **not** do                             |
| [docs/BETA-READINESS.md](docs/BETA-READINESS.md) | What still blocks using real professional or customer data              |
| [docs/RELEASE.md](docs/RELEASE.md)               | The release-candidate checklist, and what was last verified             |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)         | What a host has to provide, and the GitHub Pages evaluation             |
| [docs/BETA-TESTING.md](docs/BETA-TESTING.md)     | What a tester reads, in Spanish and English                             |
| [docs/PRIVACY.md](docs/PRIVACY.md)               | What personal information exists, where, and which decisions are open   |
| [docs/DECISIONS/](docs/DECISIONS/)               | Why things are the way they are                                         |
