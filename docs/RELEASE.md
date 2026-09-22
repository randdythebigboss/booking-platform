# Release candidate

**Version: `0.1.0-beta.1`**

What has to be true before this is put in front of anybody, and what was true
when it was last checked. Short on purpose: a checklist nobody finishes is
worse than no checklist.

## Where the version lives

| Place | Value |
| --- | --- |
| `package.json` `version` | `0.1.0-beta.1` |
| `app.json` `expo.extra.release` | `0.1.0-beta.1` |
| `app.json` `expo.version` | `0.1.0` — the platform version; Apple and Google reject a prerelease tag |
| Diagnostics screen | reads `expo.extra.release` |

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

| | |
| --- | --- |
| Version | `0.1.0-beta.1` |
| Branch | `phase11/release-candidate` |
| Lint, types | clean |
| Unit tests | **351 passing**, 32 files |
| SQL suites | **10 passing**, from an empty database, 35 migrations |
| End-to-end | **64 passing** — 58 desktop, 6 at 375px |
| Accessibility | **0 violations** (axe, WCAG 2.1 A + AA) across 8 screens |
| Expo doctor | 21/21 |
| Web export | 2.5 MB; 1.72 MB JS raw, **454 KB gzipped**, one chunk |
| Secret scan | clean — only the validation regex and test placeholders |
| Tables without RLS | **0** |
| `SECURITY DEFINER` without a pinned `search_path` | **0** |
| Functions `anon` may execute | 13, all classified |
| `anon` on notifications, payments, payment_events, platform_settings | **no privilege at all** |
| Payment simulation, cloud | **off** |
| Real payment provider | **none** |
| Real messaging provider | **none** |

## Cutting the candidate

A Git tag is the whole ceremony:

```bash
git tag -a v0.1.0-beta.1 -m "Release candidate: free beta, no real payments"
git push origin v0.1.0-beta.1
```

**No GitHub Release is published**, because publishing one reads as a
distribution decision and that decision is the Product Owner's. **Nothing is
deployed** — see [DEPLOYMENT.md](DEPLOYMENT.md) for what would be involved and
what still has to be chosen.

## If something is wrong afterwards

[OPERATIONS.md](OPERATIONS.md) covers what a support conversation looks like
and where the diagnostics screen is. [BETA-TESTING.md](BETA-TESTING.md) is what
a tester reads.
