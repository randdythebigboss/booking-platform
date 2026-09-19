# 0007 - Vitest for domain tests

**Date:** 2026-09-19
**Status:** Accepted

## Context

The most important code in this product is pure functions over dates and
intervals. Testing it through a React Native renderer would be slow and would
add mocking for no benefit.

## Decision

Vitest in a Node environment, over `src/features` and `src/lib`. Component and
integration tests come later, with the screens that need them.

The structural rule that makes this work: **nothing in `src/features` imports
`react-native` or `@supabase/supabase-js`.**

## Consequences

The whole suite runs in under a second, so it can run on every save.

The parts that do touch React Native -- screens, the Supabase client -- are
deliberately thin, which is a useful pressure on the design.

When component tests arrive they will need a separate environment
configuration. That is a Phase 1 cost, accepted knowingly.
