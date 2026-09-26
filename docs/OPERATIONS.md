# Operations

What somebody needs to be able to do while a small private beta is running,
written down before it is running. Nothing here is infrastructure: there is no
production environment yet, and this document does not create one.

## Environments

| Environment | What it is                                       | Where its configuration lives |
| ----------- | ------------------------------------------------ | ----------------------------- |
| Local       | PostgreSQL + PostgREST on your machine           | `.env.local`, git-ignored     |
| Development | The free Supabase project `booking-platform-dev` | `.env.local`, git-ignored     |
| Beta        | Not created yet                                  | —                             |
| Production  | Not created yet                                  | —                             |

One rule, and it is the one that keeps the others honest: **nothing
environment-specific is committed.** The repository holds `.env.example` and no
values. A URL, a publishable key and a site URL come from the environment; a
service-role key, a database password or a personal access token are never
handled by the application at all.

## Applying migrations

The Git repository is the source of truth, in every environment, always.

```bash
# Local, from nothing: bootstrap, every migration in order, seed, all suites.
PGBIN=/path/to/pgsql/bin ./tools/local-postgres/run-validation.sh

# With Docker and the Supabase CLI, which is what CI runs:
npm run db:reset
```

Against the cloud development project, apply the same files in the same order,
from the commit you are deploying. Never hand-edit a deployed schema: a change
that is not a migration is a change the next environment will not have.

Two things learned deploying this schema for the first time, both worth
knowing before doing it again:

- **Never `drop schema public cascade` on a Supabase project.** It takes
  Supabase's default privileges with it, and every table then exists, with
  correct policies, answering `42501 permission denied`. Migration
  `20260925100000` makes this repository grant its own tables so a fresh
  project does not depend on those defaults -- but the drop is still not
  something to do.
- **Recreating a function resets its grants.** Supabase grants `EXECUTE` on new
  functions to `anon` and `authenticated`. Any migration that replaces a
  function restates its classification immediately afterwards, and
  `supabase/tests/function_grants.sql` fails the build if one is forgotten.
- **PostgREST caches the schema.** After a migration that adds or replaces a
  function or a column, run

  ```sql
  notify pgrst, 'reload schema';
  ```

  Without it the database is correct and the API is not: calls fail, or an
  overload resolves to the signature that used to exist. `supabase db reset`
  and the local stack restart PostgREST for you; a migration applied to a
  running cloud project does not.

- **Reproduce a function from the live definition, never from a migration.**
  A function is rewritten by several migrations over its life, and the one
  that is easiest to find is rarely the newest. Copying an old body silently
  removes everything added since -- which happened once here, dropping three
  fields the guest confirmation page needs, with every SQL suite still green.

## Is it ready?

```bash
node tools/release/readiness.mjs
```

It answers five separate questions and never adds them up:

| Category                         | What it means                              |
| -------------------------------- | ------------------------------------------ |
| Source-code readiness            | the code in this repository                |
| CI and test readiness            | what GitHub Actions proved about that code |
| Cloud deployment readiness       | what is actually installed and running     |
| Cloud security configuration     | how the shared project is actually set up  |
| Real-person onboarding readiness | whether a real person may be invited       |

A category is its worst gate. The statuses mean exactly this:

- **PASS** — checked in the target environment, just now.
- **FAIL** — checked, and wrong.
- **PENDING** — a real action nobody has performed yet.
- **MANUAL** — cannot be established without credentials this repository does
  not hold; the named tool is the evidence.
- **BLOCKED** — waiting on a decision, not on an action.

**A prepared script is never a PASS.** An earlier version of this check
reported ten of ten green while public registration was still enabled on the
shared project and the weekly RPC had never been installed on it. Nothing it
said was false; the total implied a completeness it had not earned, because
the two most important facts about the environment had no gate at all.

## The cloud development project: all three done

All three were carried out on **26 September 2026**, in the dashboard, with the
Product Owner signed in. They are kept here because the procedures are what a
second project would need, and because the checks are how anybody confirms the
state has not drifted.

|                         | Done                                      | Proved by                                                 |
| ----------------------- | ----------------------------------------- | --------------------------------------------------------- |
| 1. The weekly migration | applied, ledger recorded, schema reloaded | `verify-week-function.sql`, `verify-cloud-week.mjs` 11/11 |
| 2. Public registration  | off at the Auth server                    | `/auth/v1/settings` says `disable_signup: true`           |
| 3. The probe accounts   | 8 removed, 4 accounts left                | the survivors each own a business or are the demo         |

None of it needed a service-role key, a database password or an access token,
and none was written down.

### 1. The weekly migration — applied

**Done.** Applied through the SQL Editor after checking the pasted text was
byte-identical to the file in this repository (SHA-256 `aa14a678…34aabe0e`,
7165 bytes). The ledger row was written by hand and then corrected to the
filename form the CLI itself uses, `20260930100000_a_week_can_be_looked_at_whole.sql`,
so `db push` sees a migration it has already applied rather than one to
replay. `notify pgrst, 'reload schema'` followed in the same session.

Afterwards `verify-week-function.sql` ran clean and
`verify-cloud-week.mjs` reported 11/11, including the one that matters: the
deployed page makes **one** weekly call instead of seven day calls.

The procedure, for a project that still needs it:

`supabase/migrations/20260930100000_a_week_can_be_looked_at_whole.sql` adds
`get_week_availability`, which the public booking page's week strip calls. The
deployed beta works without it -- `fetchWeekAvailability` falls back to the same
engine one day at a time -- but that is seven round trips a week instead of one.

Verified before it was written down: it applies cleanly to a database in
exactly the cloud's current state, and
`tools/release/verify-week-function.sql` passes against the result.

Any of these, in order of preference:

```bash
# a. The CLI, with a personal access token from the dashboard.
#    Applies every migration the project is missing, in order, and records
#    them in the ledger.
export SUPABASE_ACCESS_TOKEN=...        # this command only; never committed
npx supabase link --project-ref qqzzscfrbotsoizfabvw
npx supabase db push

# b. psql, with the project's database password.
psql "$CLOUD_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260930100000_a_week_can_be_looked_at_whole.sql
```

c. Or the dashboard's SQL Editor: paste that one file, whole, and run it. The
whole file is now replay-safe -- `create or replace function` always was, and
the `create type` is wrapped so a second run is a no-op rather than
`42710 type already exists`. Verified by applying it twice to a database in
the project's exact current state.

**If you use the SQL Editor, record it in the ledger afterwards.** `db push`
decides what to apply by reading `supabase_migrations.schema_migrations`, and
a migration applied by hand leaves no row there, so the next push replays it:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('20260930100000', 'a_week_can_be_looked_at_whole')
on conflict (version) do nothing;
```

The replay would now be harmless, but an accurate ledger is what stops the
next person having to work out whether it was.

Then, in the same session:

```sql
notify pgrst, 'reload schema';
```

**This is not optional.** PostgREST caches the schema at boot. Without the
reload the function exists and the API still answers `404 PGRST202`, which is
indistinguishable from not having applied it at all. It was observed exactly
that way while preparing this.

Finally, prove it:

```bash
psql "$CLOUD_DB_URL" -v ON_ERROR_STOP=1 -f tools/release/verify-week-function.sql
node tools/release/verify-cloud-week.mjs
```

The first checks the signature, the enum, `SECURITY DEFINER` with a pinned
`search_path`, that `EXECUTE` reaches `anon` and `authenticated` and not
`PUBLIC`, and that the returned shape is still `day, state, free_count`. The
second watches the deployed page's network traffic: it passes only if the page
calls the weekly RPC and gets a 200, and fails if it is quietly falling back.

**Leave the fallback in place.** It costs nothing while the function exists and
it is what keeps a fresh or half-migrated project working.

### 2. Public registration — off

**Done.** Authentication → Sign In / Providers → User Signups → _Allow new
users to sign up_, off, saved. `/auth/v1/settings` now answers
`disable_signup: true`, a real registration attempt is refused with
`signup_disabled`, and signing in still answers `invalid_credentials` for a
wrong password rather than anything about the instance — so no existing account
was touched. The deployed beta picked it up with no redeploy: both entry
screens now say so, in both languages.

**`mailer_autoconfirm` is still `true` and that is deliberate.** Turning
confirmation on without a mail provider would lock every new account out
instead of verifying it, and a provider costs money.

The procedure, and what the project answered before it:

```bash
curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $ANON_KEY"
# "disable_signup": false, "mailer_autoconfirm": true
```

That meant anyone could register any address and use it immediately, because
nothing confirmed it. The application refuses a non-reserved address in its own
forms, but that is guidance in a browser, not a server-side control.

In the dashboard: **Authentication → Sign In / Providers**, under _User
Signups_, turn _Allow new users to sign up_ off and save. It is on that page
itself, not inside the Email provider.

Nothing else changes. Signing in is untouched, so no existing account is
affected. Guest booking never involved an account and is unaffected.

**The product follows this setting on its own.** Both entry screens read
`GET /auth/v1/settings` when they open and stop offering to create an account
once `disable_signup` is on, replacing the toggle with a sentence in the
reader's language. Nothing needs redeploying, and the bundle carries no opinion
of its own about who may register -- it asks. If the question cannot be
answered the form stays up, and GoTrue's refusal is still translated rather
than shown raw.

To create a fictional account afterwards:

```bash
SUPABASE_SERVICE_ROLE_KEY=... node tools/dev/provision-demo-account.mjs \
  alguien@example.test "Alguien Demo"
```

It refuses any address that could belong to a real person, refuses a project
that does not say it is `development`, refuses an account that already exists,
and writes the password to a file outside the repository.

Confirm afterwards with the same `/auth/v1/settings` call: `disable_signup`
must read `true`.

### 3. The probe accounts — removed

**Done.** Eight accounts, all on `@bookingplatform.test`: five `gate-…`, two
`probe-…` and one `p14-probe-…`. Every one was checked first, in SQL, against
the same three questions `cleanup-probe-accounts.mjs` asks — does it own a
business, a professional profile, a customer record — and every one answered no
to all three. They were then removed through Authentication → Users, which is
the Admin API doing it, so nothing here ever held a service-role key.

Four accounts remain and each is meant to: the demonstration account and the
owners of the three businesses. Afterwards: no ownerless business, no orphaned
professional profile, no orphaned customer, and the businesses still hold 3 and
2 services and 14 and 11 appointments exactly as before.

`gate-reusable` appears in earlier notes and never existed on the project.

The procedure, for next time:

|                        |     |
| ---------------------- | --- |
| `p14-probe-…`          | 1   |
| `gate-…` (timestamped) | 5   |
| `gate-reusable`        | 1   |

That list is what was created here, not an inventory of the project — only the
service-role key can produce one, which is the first thing the command below
does.

```bash
SUPABASE_SERVICE_ROLE_KEY=... node tools/dev/cleanup-probe-accounts.mjs
SUPABASE_SERVICE_ROLE_KEY=... node tools/dev/cleanup-probe-accounts.mjs --delete
```

The first run only reports. Both runs check, per account, that it owns no
business, no professional profile and no customer record, and skip it if it
owns any of them. `demo@bookingplatform.test` is refused by name as well as by
pattern, and so is any address outside `@bookingplatform.test`.

Read the report before running it again with `--delete`. An account it lists
as `keep` is one it will never touch, and the reason is on the same line.

## Development data

### Commands that destroy data

Three scripts can: `tools/e2e/reset.sh`, `tools/dev/reset-demo-data.sh` and
`tools/local-postgres/run-validation.sh` — the last drops a whole database.
All three call `tools/dev/disposable-db.cjs` before touching anything, which
refuses any host that is not on this machine. `ALLOW_REMOTE_RESET=yes`
overrides it and is never appropriate for ordinary development.

`npm run db:reset` is the Supabase CLI acting on the local container; it
cannot reach a linked project without an explicit `--linked`.

`supabase/seed.sql` is the safe demo data: one business, Spanish content,
invented customers with `@example.test` addresses. It contains no real person,
and nothing that arrives in it should.

To reset a development database, recreate it from migrations and seed rather
than deleting rows -- `run-validation.sh` does exactly that and then proves the
result.

**The SQL suites are single-shot.** Each says "run against a freshly reset
stack" in its header and means it: they leave their fixtures behind, and a
second run against the same database fails for the wrong reason. Against a
long-lived development project, clean up afterwards -- fixture businesses by
slug, `%@bookingplatform.test` users, the English fixture customer names -- or
the Spanish demo data becomes unrecognisable.

## Sending notifications

Nothing sends by itself. A dispatcher drains the outbox:

```bash
DISPATCH_DB_URL=postgresql://... npm run notifications:dispatch
DISPATCH_DB_URL=postgresql://... npm run notifications:dispatch -- --watch --limit 50

# Windows, or any machine where psql is not on PATH:
PSQL=C:/path/to/psql.exe DISPATCH_DB_URL=... npm run notifications:dispatch
```

It ships with the mock provider: it delivers nowhere and records everything,
which is what is wanted before a paid channel exists. Every flow can be
exercised end to end without an account, a card or a contract.

It requires a connection that may call `claim_due_notifications`, which no
browser role can. That is the boundary described in
[ADR 0020](DECISIONS/0020-notifications-leave-through-an-outbox.md), and it is
why this is a command and not a screen.

Each pass first calls `requeue_stalled_notifications`, which puts back anything
a previous dispatcher claimed and never finished. It does not give back the
attempt that claim burned: it may have sent before it died.

## Looking at what is happening

**The notifications screen** (`/app/notifications`) is the first place to look:
what is pending, what was sent, what failed and why, per business, read through
Row Level Security. A professional sees their own and nobody else's.

**An appointment's detail screen** shows the messages queued for that one
appointment, next to the history of the appointment itself.

**The history log** (`appointment_events`) answers "what happened to this
appointment, when, and who did it" -- including changes made directly in SQL,
which are recorded as `system`.

When those are not enough, query the database. Useful starting points:

```sql
-- The backlog, oldest first.
select kind, channel, status, scheduled_for, attempt_count, last_error
from public.notifications
where status in ('pending', 'processing')
order by scheduled_for;

-- Everything that gave up, and what it said.
select kind, locale, attempt_count, last_error, failed_at
from public.notifications
where status = 'failed'
order by failed_at desc;

-- One appointment, end to end.
select e.occurred_at, e.event_type, e.actor_type, e.reason
from public.appointment_events e
where e.appointment_id = '...'
order by e.occurred_at;
```

## What may be written down

Logs are read by more people than a message is, and they are copied into chat
windows and issue trackers.

- Never a booking access token. It is a bearer credential
  ([ADR 0019](DECISIONS/0019-the-guest-token-rides-in-the-fragment.md)); a log
  line containing one is a disclosure.
- Never a password, a service-role key, a database URL with credentials in it,
  or a session token.
- Not a customer's full address. The dispatcher redacts: `l***@example.test`,
  `***0144`. `last_error` holds a short reason, truncated, never a provider's
  response body -- those echo the request, and the request is the message.
- Not a message body or subject. What was sent is reconstructable from the
  template key and the payload by anyone entitled to see them.

## Supporting somebody

1. Find the appointment: the professional's own screens, by customer name or
   date. Their identity on it is what they booked with, frozen
   ([ADR 0021](DECISIONS/0021-an-appointment-remembers-who-booked-it.md)).
2. Read its history. Every status change and move is there, with who did it.
3. Read its notifications. Pending means not due yet or waiting for a
   dispatcher; failed carries a reason.
4. If a message should go again, the fix is a new row rather than an edited
   one -- the outbox is append-only to every client, including the owner.
5. If a guest lost their link, it cannot be recovered from a log, by design.
   The professional can cancel or move the appointment for them.

## Payments, in development

No money moves. The provider is the mock, and the database refuses a simulated
outcome unless `platform_settings.payment_simulation_enabled` is true -- which
`supabase/seed.sql` sets and which **a production deployment must leave
false**. The simulate controls on the confirmation page are drawn from the same
switch, so there is one thing to get right rather than two.

```sql
-- What is owed, what was paid, and what happened to it.
select p.status, p.amount, p.currency, p.requirement, p.failure_code, p.paid_at
from public.payments p
where p.appointment_id = '...'
order by p.created_at desc;

-- The provider's side of the story.
select e.occurred_at, e.event_type, e.previous_status, e.new_status, e.failure_code
from public.payment_events e
where e.payment_id = '...'
order by e.occurred_at;

-- Slots being held right now.
select a.id, a.starts_at, a.hold_expires_at
from public.appointments a
where a.hold_expires_at > now();
```

Refunding is a professional's action in the interface, never automatic, and
never implied by a cancellation
([ADR 0023](DECISIONS/0023-cancelling-is-not-refunding.md)).

**Retention is an open decision.** Nothing deletes a payment, a payment event,
a notification or a recipient address, ever. Accounting and dispute windows
argue for keeping payment records considerably longer than message records,
and no period has been chosen for either. This is a pre-production privacy and
accounting gate, not an oversight.

## What does not exist yet, deliberately

No paid messaging provider, no real payment provider, no production
environment, no store
listing, no uptime monitoring, no alerting, no log aggregation. Each is a
decision to take when there is something to protect, not before.
