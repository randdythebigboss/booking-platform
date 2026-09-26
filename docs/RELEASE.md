# Release candidate

**Version: `0.1.0-beta.2`**

What has to be true before this is put in front of anybody, and what was true
when it was last checked. Short on purpose: a checklist nobody finishes is
worse than no checklist.

## Where the version lives

| Place                           | Value                                                                    |
| ------------------------------- | ------------------------------------------------------------------------ |
| `package.json` `version`        | `0.1.0-beta.2`                                                           |
| `app.json` `expo.extra.release` | `0.1.0-beta.2`                                                           |
| `app.json` `expo.version`       | `0.1.0` — the platform version; Apple and Google reject a prerelease tag |
| Diagnostics screen              | reads `expo.extra.release`                                               |

`tests/packaging/release.test.ts` fails if those disagree. They did once, and
the diagnostics screen confidently reported a 1.0.0 release that never existed.

## The checklist

Everything below is a command, not a judgement call.

```bash
npm ci
npm run verify                      # lint, typecheck, 351 unit tests
npm run test:i18n                   # Spanish and English agree in shape
npm run expo:export                 # note: --clear, see below
npm run expo:doctor

EXPECT_SUPABASE_URL=https://<project>.supabase.co ./tools/release/verify-build.sh
```

### Why the export clears the cache

`EXPO_PUBLIC_*` values are compiled into the bundle and Metro caches the
result. Build for the end-to-end stack, then build a release without
`--clear`, and the release quietly carries `http://127.0.0.1:4301`: an
application that loads perfectly, installs perfectly and cannot reach
anything. That happened here. `npm run expo:export` now passes `--clear`,
and `tools/release/verify-build.sh` checks the result rather than trusting it.

The same cache once served a stale `app.json`, which is how the diagnostics
screen came to report a version nobody had released.

Database, from nothing:

```bash
PGBIN=/path/to/pgsql/bin ./tools/local-postgres/run-validation.sh
# or, where Docker is available:
supabase db reset && <the SQL suites, as .github/workflows/ci.yml runs them>
```

Browser, against a real database:

```bash
E2E_DB_URL=... E2E_SUPABASE_URL=... E2E_SUPABASE_ANON_KEY=... ./tools/e2e/run.sh
```

Then, by hand, the things a checklist cannot do:

- [ ] **Secret scan** — no tracked `.env`, no key material, no `service_role`
      outside documentation.
- [ ] **Simulation flag** — `payment_simulation_enabled = false` in every
      shared environment.
- [ ] **Demo data only** — no real person's name, telephone number or email
      anywhere in any environment.
- [ ] **Cloud migrations** — every migration applied to the target project, and
      `notify pgrst, 'reload schema'` afterwards.
- [ ] **RLS and grants** — queried from the database, not assumed from the
      migrations. See [SECURITY.md](SECURITY.md).
- [ ] **Packaging** — the export carries the manifest, the service worker, the
      icons and `display: standalone`.
- [ ] **Spanish and English** — one complete booking in each, in a browser.
- [ ] **A phone-width viewport** — no horizontal scrolling, nothing under 44px.
- [ ] **Read [LIMITATIONS.md](LIMITATIONS.md)** and confirm it is still true.

## Last verified

|                                                                      |                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| Version                                                              | `0.1.0-beta.2`                                                |
| Branch                                                               | `main`                                                        |
| GitHub Actions                                                       | all three jobs green                                          |
| Lint, types                                                          | clean                                                         |
| Unit tests                                                           | **396 passing**, 36 files                                     |
| SQL suites                                                           | **12 passing**, from an empty database, 40 migrations         |
| End-to-end                                                           | **128 tests**, 12 files — desktop and 375px                   |
| Accessibility                                                        | **0 violations** (axe, WCAG 2.1 A + AA), in the browser suite |
| Expo doctor                                                          | 20/21 — see below                                             |
| Web export                                                           | 1.83 MB JS raw, **503 KB gzipped**, one chunk                 |
| Clean clone                                                          | `npm ci`, verify, export, verify-build, secret scan — pass    |
| Secret scan                                                          | clean — only the validation regex and test placeholders       |
| Tables without RLS                                                   | **0**                                                         |
| `SECURITY DEFINER` without a pinned `search_path`                    | **0**                                                         |
| Functions `anon` may execute                                         | 13, all classified                                            |
| `anon` on notifications, payments, payment_events, platform_settings | **no privilege at all**                                       |
| Payment simulation, cloud                                            | **off**                                                       |
| Real payment provider                                                | **none**                                                      |
| Real messaging provider                                              | **none**                                                      |
| Cloud smoke                                                          | booking and cancellation on the deployed beta, both languages |
| Responsive                                                           | 320 / 375 / 430 / 768px — no horizontal overflow              |

### The one failing doctor check

`expo`, `expo-linking` and `expo-router` are each one patch behind what SDK 57
now asks for. Nothing in this repository changed; upstream published patches
after the lockfile was written. It is recorded rather than fixed because a
dependency bump is a change to what ships, and that belongs to a phase with a
full verification pass behind it, not to an operational closure.

## Deployed

|                    |                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| URL                | https://randdythebigboss.github.io/booking-platform/                                           |
| Host               | GitHub Pages, from this repository. No account, no domain, no cost                             |
| Published by       | `.github/workflows/deploy-pages.yml`, on every push to `main`                                  |
| Supabase           | `booking-platform-dev`; Site URL and allow-list point at the beta, local development URLs kept |
| Payment simulation | off                                                                                            |
| Search engines     | asked to stay away — `noindex, nofollow` and a `robots.txt`. **Not access control**            |

Two defects were found by deploying that no test had caught, both fixed with a
regression test:

- The **secret scan matched supabase-js**, which contains
  `startsWith("sb_secret_")` because classifying key formats is its job. It
  matches values now, not words.
- The **service worker cached nothing under the repository subpath**. Its
  allow-list was anchored at `/` while every asset arrives at
  `/booking-platform/...`, so it installed, took control and cached zero bytes
  — silently, because caching nothing looks like working.

## What the beta gained after it shipped

A product pass the Product Owner asked for before inviting anybody:

- The booking date is a week of days you tap, not a text field. It cannot
  reach the past, and "today" is today where the _business_ is.
- The times show the whole day -- free, taken, gone -- and a taken time says
  nothing whatsoever about who has it.
- The language control is a small toggle in the top-right of every screen.
- A professional gets a five-step setup guide that disappears when it is done.
- A customer may keep an account, and still never needs one to book.
- Each appointment has a conversation, reachable by the guest's own link or by
  the customer's account, and it is the only channel that works.
- Azul has a button that says card payment is not available yet.

## Cutting the candidate

A Git tag is the whole ceremony:

```bash
git tag -a v0.1.0-beta.2 -m "Beta 2: customer-centred scheduling and the professional week"
git push origin v0.1.0-beta.2
```

**No GitHub Release is published**, because publishing one reads as a
distribution decision and that decision is the Product Owner's. Tagging does
not deploy either: the beta is published by a push to `main`, and that is a
separate act from cutting a tag. What is serving right now is below.

## The tag, and what is actually serving

These are two different things and the difference is not a mistake.

|                                      |                      |
| ------------------------------------ | -------------------- |
| Tag `v0.1.0-beta.1`                  | commit `5781886`     |
| Tag `v0.1.0-beta.2`                  | commit `50547b5`     |
| `main`, and what GitHub Pages serves | `git rev-parse main` |
| Version the running bundle reports   | `0.1.0-beta.2`       |

`main` moves; the tag does not. Everything on `main` past `v0.1.0-beta.2` is
operational, and none of it changes what the product does for a tester:

- `07ebaf1` — tooling and documentation for the cloud work this repository
  cannot perform itself.
- `4724b57` — the account screens ask the Auth server whether registration is
  possible instead of assuming, and the readiness check reports five separate
  categories instead of one total.
- Documentation after that, including this section.

`node tools/release/readiness.mjs` reports the deployed commit and whether its
workflow succeeded, which is the answer to "what is actually out there" that
does not go stale.

**No tag was moved and no history was rewritten.** `v0.1.0-beta.2` still points
at the commit it was cut from, which is the only thing a tag is for.

**No `v0.1.0-beta.3` was cut**, because there is nothing to announce: no
feature, no fix to product behaviour, no change a tester would notice while
the shared project stays as it is. The version string stayed `0.1.0-beta.2`
deliberately, so the bundle keeps telling the truth about which release it is.

The next tag belongs to the next thing a tester can see.

`get_week_availability` was installed on the shared project on 26 September
2026, so the weekly view now makes one call where it used to make seven. That
is a real change in what the product does under somebody's finger — but it is
a change in the _environment_, not in this repository: the same commit produced
both behaviours, and the fallback that produced the old one is still there for
a project that has not been migrated. Tagging it would attach a version to
something a tag cannot describe.

So the next tag waits for the next change to the code, and this is the record
that the environment moved underneath it.

## If something is wrong afterwards

[OPERATIONS.md](OPERATIONS.md) covers what a support conversation looks like
and where the diagnostics screen is. [BETA-TESTING.md](BETA-TESTING.md) is what
a tester reads.
