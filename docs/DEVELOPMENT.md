# Development

## Requirements

| Tool    | Version     | Needed for                          |
| ------- | ----------- | ----------------------------------- |
| Node    | 20 or newer | Everything                          |
| npm     | 10 or newer | Everything                          |
| Docker  | any recent  | Running Supabase locally (optional) |
| Expo Go | latest      | Running on a physical device        |

## Setup

```bash
npm install
cp .env.example .env.local
npm run start
```

Press `w` for web, `a` for Android, `i` for iOS, or scan the QR code with Expo
Go. Web is the fastest loop and is where the public booking page matters most.

Without `.env.local` the app still runs: the landing page says the backend is
not configured, and the public page explains what to fill in. That is
deliberate -- a fresh clone should never crash.

## Database

The Supabase CLI runs the whole stack in Docker.

```bash
npm run db:start     # start Postgres, Auth, PostgREST, Studio
npm run db:reset     # drop, re-apply every migration, load the seed
npm run db:types     # regenerate src/types/database.generated.ts
```

`db:reset` is the one to reach for. It is the only way to know that the
migrations apply cleanly from nothing, which is exactly what CI checks.

Demo credentials after a reset:

```
demo@bookingplatform.test / demo-password-123
/p/demo-studio
```

### Changing the schema

Every change is a new migration file. Never edit a migration that has already
been applied anywhere but your own machine.

```bash
npx supabase migration new add_something
# edit the generated file
npm run db:reset
```

## Validating the SQL without Docker

CI uses the Supabase CLI, which is the faithful environment. When Docker is
not available, the same SQL can be run against any stock PostgreSQL:

```bash
PGBIN=/path/to/pgsql/bin ./tools/local-postgres/run-validation.sh
```

It recreates the database from nothing, applies
`tools/local-postgres/bootstrap.sql` (the roles, grants, `extensions` schema
and minimal `auth` schema that Supabase would otherwise provide), then runs
every migration in order, the seed, and both SQL suites.

The bootstrap deliberately reproduces Supabase's broad table grants. Without
them an RLS test would pass for the wrong reason -- "permission denied"
instead of "no rows".

### The SQL suites

| File                     | Proves                                                                     |
| ------------------------ | -------------------------------------------------------------------------- |
| `booking_guarantees.sql` | No double booking, and every rule `book_appointment` enforces              |
| `tenant_isolation.sql`   | One business cannot read or touch another, including blocks and exceptions |
| `availability_api.sql`   | `get_available_slots` offers the right times and reveals nothing else      |

### Driving the customer flow without Docker

The guest journey is entirely anonymous, so it needs PostgREST but not
GoTrue. Pointing PostgREST at a local PostgreSQL and putting a small proxy
in front of it -- rewriting `/rest/v1/*` to the PostgREST root -- is enough
to drive the whole public booking flow in a real browser, including the
double-booking race, with no cloud project and no Docker.

The professional side needs real authentication and cannot be exercised
that way.

## Checks

```bash
npm run lint
npm run typecheck
npm run test
npm run verify       # all three
```

`npm run test:watch` while working on the engine.

## Layout

```
src/
  app/           Expo Router routes. Screens only.
  components/    Presentational components and the UI kit.
  features/      Pure domain logic. No React, no network.
  services/      The only place that talks to Supabase.
  lib/           Config, Supabase client, formatters.
  theme/         Design tokens.
  types/         The TypeScript view of the database.
supabase/
  migrations/    Every schema change, in order.
  seed.sql       Demo data.
tests/           Domain and unit tests.
docs/            This.
```

The rule worth keeping: **nothing in `src/features` may import `react-native`
or `@supabase/supabase-js`.** That is what keeps the domain tests fast and
mock-free.

## Tests

Vitest, Node environment. The suite covers interval arithmetic, timezone
handling, the slot engine, the availability context parser, booking error
mapping, the payment state machine, and environment handling.

Add a test to `tests/availability/slots.test.ts` for every scheduling rule you
touch. That file is the executable specification of what "available" means.

## Commits

Small and descriptive. Conventional-commit prefixes: `feat`, `fix`, `docs`,
`chore`, `test`, `refactor`.

Never commit `.env`, `.env.local`, a service-role key, or any credential. See
[SECURITY.md](SECURITY.md).

## CI

Every pull request runs install, lint, typecheck, tests and an Expo web
export. A second job applies every migration to a real Postgres via the
Supabase CLI, loads the seed, and runs both SQL suites in `supabase/tests`.
That job is what proves the SQL is valid.

Nothing deploys automatically.
