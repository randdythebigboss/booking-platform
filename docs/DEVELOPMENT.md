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

### Driving the authenticated side locally

`tools/local-postgres/supabase-shim.js` puts a Supabase-shaped front door on
a local PostgreSQL + PostgREST pair: `/rest/v1/*` is forwarded, and the few
`/auth/v1/*` endpoints supabase-js calls are implemented against
`auth.users` with pgcrypto.

The access token is a real HS256 JWT carrying `sub` and
`role=authenticated`, signed with the secret PostgREST verifies, so Row
Level Security sees a genuine `auth.uid()`. The authorization being
exercised is the real thing; only the identity provider is local.

It is a development tool, not a security boundary, and must never listen
beyond localhost.

**It is not GoTrue, and the difference matters when reading a green run.**
What it implements is the password grant and the session endpoints
supabase-js calls on start-up. What it does not implement:

- sign-up, and therefore the `handle_new_user` trigger path
- email confirmation, password reset and recovery
- token expiry and refresh -- its tokens simply do not expire
- rate limiting, lockout, and every other abuse control

So a professional flow that works here is evidence that Row Level Security
and the RPCs behave, and is not evidence that authentication does. The CI
job runs the real Supabase stack against the same migrations, which is where
that evidence comes from. On the client side, what the app believes when a
token is refreshed or revoked is covered by
`tests/services/auth-session.test.ts` against a fake SDK.

## Sending notifications in development

Nothing sends by itself, on purpose: a booking never waits on a provider
(ADR 0020). To move what is queued, run the dispatcher against a database:

```bash
DISPATCH_DB_URL=postgresql://postgres@127.0.0.1:55432/booking   npm run notifications:dispatch

# psql not on PATH (Windows, or the portable build above):
PSQL=/path/to/psql.exe DISPATCH_DB_URL=... npm run notifications:dispatch
```

It uses the mock provider, which delivers nowhere and records everything, and
its log is redacted. `/app/notifications` shows the same queue from inside the
product. [OPERATIONS.md](OPERATIONS.md) has the rest.

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
  tests/         SQL suites: what the database itself promises.
tools/
  local-postgres/  Run the SQL anywhere PostgreSQL runs, without Docker.
  notifications/   The outbox dispatcher.
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


## End-to-end tests

Playwright, in a real browser, against a **built** application and a **real**
database. It does not replace the unit tests or the SQL suites -- those prove
the domain logic and the authorization, and they prove it better. What only a
browser can show is that the bundle, the router, PostgREST and the screens
agree with each other.

Three things have to be running: a database with the fixtures, an API in front
of it, and the built application. `tools/e2e/run.sh` does the last two and the
reset; bringing up the database is yours, because there are two reasonable
ways and neither should be second-class.

**With Docker**, the Supabase CLI is the faithful environment and the one CI
uses:

```bash
supabase start
supabase db reset
E2E_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" E2E_SUPABASE_URL="http://127.0.0.1:54321" E2E_SUPABASE_ANON_KEY="<from: supabase status>"   ./tools/e2e/run.sh
```

**Without Docker**, the PostgreSQL + PostgREST + shim stack described above
serves the same purpose, with the caveat that the shim is not GoTrue:

```bash
E2E_DB_URL="postgresql://postgres@127.0.0.1:55432/booking_e2e" E2E_SUPABASE_URL="http://127.0.0.1:4301" E2E_SUPABASE_ANON_KEY="<the anon JWT you signed>" PSQL=/path/to/psql   ./tools/e2e/run.sh
```

To iterate on one spec against a build that is already serving:

```bash
E2E_BASE_URL=http://127.0.0.1:4321 npx playwright test e2e/payments.spec.ts
```

### What to know before writing one

* **Every test starts from the fixtures.** `e2e/support/test.ts` resets the
  database before each one, automatically. It is not caution: the seeded
  professional works 09:00 to 18:00, and a suite that books a dozen
  appointments into the same day eventually meets "no hay horas disponibles"
  and starts failing in whatever order it happened to run in.
* **Address the page the way a person does** -- by role and accessible name,
  never by CSS structure. A `div > div:nth-child(3)` selector passes happily
  while the label is missing, and `e2e/accessibility.spec.ts` exists to notice
  missing labels.
* **Reach for the database only for what a browser cannot do**: flipping the
  server-side payment-simulation switch, and reading back a fact no screen
  shows. `e2e/support/db.ts` is the whole seam.
* **SQL goes through a file, not an argument.** The demo data is Spanish, and
  on Windows an accented character in `psql -c` is mangled into an invalid
  byte sequence before psql ever sees it.
* Tag a test `@mobile` to also run it at 375px.
* Never print a guest token.

## Commits

Small and descriptive. Conventional-commit prefixes: `feat`, `fix`, `docs`,
`chore`, `test`, `refactor`.

Never commit `.env`, `.env.local`, a service-role key, or any credential. See
[SECURITY.md](SECURITY.md).

## CI

Three jobs, and none of them needs a credential:

* **Lint, types, tests, Expo export** -- plus the packaging checks that the
  built output really carries a manifest, a service worker and its icons.
* **Migrations, seed and database guarantees** -- every migration applied to a
  real Postgres from nothing via the Supabase CLI, then every SQL suite in
  `supabase/tests`. This is what proves the SQL is valid.
* **End-to-end in a browser** -- a local Supabase stack, the deterministic
  fixtures, a build pointed at them, and Playwright. On a failure it uploads
  the traces and screenshots as an artifact.

Nothing in CI talks to the shared cloud project, so a fork can run all of it.

Nothing deploys automatically.

## Adding a language

Spanish is the source. `src/locales/es/index.ts` is the canonical dictionary
and everything else follows it.

1. Copy `src/locales/en/index.ts` to `src/locales/<code>/index.ts` and declare
   it `const <code>: Translations`. The typecheck will then list every key you
   have not translated, and refuse any you invent.
2. Add the code to `SUPPORTED_LOCALES` in `src/locales/index.ts`, and give it
   a regional tag in `INTL_LOCALES` and a name in `LOCALE_NAMES`. Write the
   name in the language itself -- "Português", not "Portuguese".
3. Run `npm run test:i18n`. It checks what a type cannot: empty strings,
   placeholders that differ between languages, every plural category, and
   every key the app builds at runtime from a status, an actor or an error
   code.

No migration is needed. `profiles.preferred_locale` is constrained to the
shape of a language tag, not to a list of the languages that exist today.

**What is not translated, on purpose:** anything a business typed. Business
names, service names and descriptions, notes, cancellation reasons. Also
machine identifiers -- enum values, sentinel codes such as `SLOT_TAKEN`, and
IANA timezone names.

**Plurals** go through i18next's `_one` / `_other` suffixes, never through
string concatenation. `t('appointments.count', { count })`, not
`count + ' citas'`.
