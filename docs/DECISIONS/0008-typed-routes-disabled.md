# 0008 - Typed routes disabled for now

**Date:** 2026-09-19
**Status:** Accepted, revisit in Phase 1

## Context

Expo Router can generate types so that `href` values are checked against the
real route map. The generated types live in `.expo/types`, which is produced
by running the bundler and is not committed.

That makes `npm run typecheck` fail on a fresh clone and in CI unless a build
runs first.

## Decision

`experiments.typedRoutes` is `false`. Route strings are plain strings.

## Consequences

`npm run typecheck` works anywhere, immediately, with no build step -- which
matters more in Phase 0 than route-string safety over fourteen routes.

A typo in an `href` is not caught at compile time. Revisit once the route map
stops changing, by having CI run an export before typecheck.
