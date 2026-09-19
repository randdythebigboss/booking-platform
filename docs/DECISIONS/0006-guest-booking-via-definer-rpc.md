# 0006 - Guest booking through a SECURITY DEFINER function

**Date:** 2026-09-19
**Status:** Accepted

## Context

The MVP requires booking without an account. A guest holds only the `anon`
key, so any table they can write to, anyone can write to.

## Decision

`anon` has no INSERT policy on `appointments` or `customers`. Bookings go
through `public.book_appointment`, which is `SECURITY DEFINER`, validates
everything itself, and writes as the definer.

Each appointment carries an `access_token` UUID, returned once at booking
time, which authorises `get_appointment_by_token` and
`cancel_appointment_by_token`.

## Consequences

The attack surface for an unauthenticated user is the parameter list of four
functions, not a set of tables.

A guest can see and cancel their own booking and nobody else's, without an
account.

The token is a bearer credential and belongs in the confirmation link. Anyone
holding the link can cancel the booking. For the MVP that is the right
trade-off against forcing an account; revisit it in Phase 6 if abuse appears.

Every `SECURITY DEFINER` function pins `search_path = public, pg_temp`, and
is revoked from `PUBLIC` before being granted deliberately.
