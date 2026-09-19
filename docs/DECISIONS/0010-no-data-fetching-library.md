# 0010 - No data-fetching library yet

**Date:** 2026-09-19
**Status:** Accepted, revisit in Phase 4

## Context

Phase 1 screens each load one list and reload it after a change. The obvious
reach is for TanStack Query: caching, invalidation, retries.

## Decision

A 40-line `useAsyncData` hook, plus explicit `reload()` after a mutation.
Shared session and business state live in two React contexts.

## Consequences

One fewer dependency, and no cache to reason about while the data model is
still moving.

Each screen owns its own data, which is true today: services, schedule and
settings do not overlap.

This stops being true in Phase 4, where a calendar, a dashboard and an
appointment list all read appointments and all need to update when a status
changes. That is the moment to add a query library, not before.
