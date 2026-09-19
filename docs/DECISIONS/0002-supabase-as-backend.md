# 0002 - Supabase as the backend

**Date:** 2026-09-19
**Status:** Accepted

## Context

The MVP has a hard constraint: US$0 of infrastructure. It also has a hard
requirement: correctness under concurrency, which is a database problem.

## Decision

Supabase: PostgreSQL, Auth, PostgREST and Row Level Security.

## Consequences

PostgreSQL gives range types, GiST exclusion constraints and real transactions
-- which is what makes the no-double-booking guarantee possible at all. A
document store would have meant solving it in application code, badly.

Row Level Security means authorisation is enforced by the database rather than
by remembering to add a `where` clause.

The free tier pauses a project after a week of inactivity. That is acceptable
for development and demos, and is the kind of limit that is cheap to outgrow
later.

Lock-in is mostly to PostgreSQL, not to Supabase. The schema, the migrations
and the functions are standard SQL.
