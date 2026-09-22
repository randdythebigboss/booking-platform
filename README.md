# Booking Platform

A booking platform for anyone who works by appointment: barbers, stylists,
tutors, trainers, photographers, therapists, consultants, technicians.
One professional or a whole team.

The professional sets up their services and working hours and shares one link.
The customer opens that link, sees the times that are genuinely free, and
books. No account required.

```
app.example.com/p/demo-studio
```

## Status

**Phase 5 - Appointment lifecycle.** The product is end to end: a professional
sets up their business and hours, a customer books as a guest in under a
minute with no account, and either side can move or cancel that appointment
before it starts. Everything that happens to an appointment is recorded in an
append-only log that nobody can edit.

| Phase | Scope                                                                                   | State                               |
| ----- | --------------------------------------------------------------------------------------- | ----------------------------------- |
| 0     | Repo, Expo scaffold, CI, database schema, RLS, availability engine, payment abstraction | Done                                |
| 1     | Auth, business onboarding, services, weekly availability                                | Done                                |
| 2     | Scheduling engine wired to the UI, exceptions, blocks                                   | Done                                |
| 3     | Public booking page, guest booking, confirmation                                        | Done                                |
| 4     | Professional dashboard, calendar, status changes                                        | Done                                |
| 5     | Appointment history, rescheduling, manual booking                                       | Done                                |
| 6     | Payment provider integration                                                            | Abstraction done, providers pending |
| 7     | Security audit, concurrency testing, accessibility, performance                         | Pending                             |
| 8     | Store distribution                                                                      | Pending                             |

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

The demo login is `demo@bookingplatform.test` / `demo-password-123`, and the
demo booking page is at `/p/demo-studio`.

## Checks

```bash
npm run verify               # lint + typecheck + tests
```

## Documentation

| Document                                     | What it covers                                                    |
| -------------------------------------------- | ----------------------------------------------------------------- |
| [docs/PRODUCT.md](docs/PRODUCT.md)           | What the product is, who it serves, what is in and out of the MVP |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit, and where the availability engine lives       |
| [docs/DATABASE.md](docs/DATABASE.md)         | The data model, and how double booking is made impossible         |
| [docs/SECURITY.md](docs/SECURITY.md)         | Row Level Security, secrets, and the public API surface           |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)   | Working on this repo day to day                                   |
| [docs/DECISIONS/](docs/DECISIONS/)           | Why things are the way they are                                   |
