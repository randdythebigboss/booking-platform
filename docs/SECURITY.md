# Security

## The rule that matters most

**Security lives in the database, not in the UI.**

Row Level Security is enabled on every table, and every table is
deny-by-default: a table with RLS on and no matching policy returns nothing.
Hiding a button is a courtesy to the user, never a control.

## Three audiences

| Role            | Who                             | May read                                                                                 |
| --------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `anon`          | The public booking page         | Published businesses, their bookable professionals, their active services. Nothing else. |
| `authenticated` | A professional                  | Exactly the businesses they are an active member of.                                     |
| `service_role`  | Server-side infrastructure only | Everything. Bypasses RLS.                                                                |

### What the public cannot read

`availability_rules`, `availability_exceptions`, `blocked_times`, `customers`,
`appointments`, `appointment_items` and `payments` have **no `anon` policy at
all**. A stranger cannot query a professional's calendar, and cannot learn who
their customers are.

The booking page gets availability through `get_availability_context`, which
returns anonymous busy ranges: a start and an end, and nothing else. No name,
no service, no appointment id.

## The availability boundary

`get_available_slots` is designed for an anonymous caller holding identifiers
from a URL. Every visibility failure returns zero rows rather than an error:
an unpublished business, a professional not accepting bookings, an inactive
service, a service from another business, or one this professional does not
offer are all indistinguishable from "nothing is free that day".

Distinct errors would be an enumeration oracle. See
[DECISIONS/0012](DECISIONS/0012-availability-api-returns-empty.md).

The rows carry a start and an end. No block reasons, no customer, no
appointment, no schedule configuration. Blocked time, exceptions and weekly
rules remain unreadable by `anon`, which the suites assert directly.

## Guest booking

A guest has no account, so they cannot be given INSERT rights on
`appointments` -- that would let anyone insert anything.

Instead, `book_appointment` is `SECURITY DEFINER`. It validates everything
itself and then writes as the definer. The only way in is through its
parameters.

Each appointment carries an `access_token` (a UUID). It is returned once, at
booking time, and it is what lets a guest open and cancel their own booking
through `get_appointment_by_token` and `cancel_appointment_by_token` without
being able to see anyone else's.

That token belongs in the confirmation link. Treat it as a bearer credential.

## SECURITY DEFINER hygiene

Every `SECURITY DEFINER` function pins its resolution path:

```sql
set search_path = public, pg_temp
```

Without it, a caller who can create objects in a schema earlier on the path
could shadow a table or a function and have it run with the definer's rights.

Functions are also revoked from `PUBLIC` and granted deliberately, because
PostgreSQL grants `EXECUTE` to `PUBLIC` by default.

The membership helpers (`is_business_member`, `is_business_manager`,
`can_manage_professional`) are `SECURITY DEFINER` for a narrower reason: a
policy on `business_members` that queried `business_members` would recurse.

## Revoking on Supabase takes more than REVOKE FROM PUBLIC

On stock PostgreSQL, `revoke all on function f() from public` makes a
function private. On Supabase it does not. The platform sets default
privileges that GRANT execute on every new function directly to `anon`,
`authenticated` and `service_role`; revoking from `PUBLIC` leaves those
explicit role grants in place.

This was a real leak, found in the Phase 2 security review and fixed in
`20260921110000_lock_down_internal_helpers.sql`: `working_windows` let a
stranger read the exact shifts of any professional, including inside an
unpublished business, and `is_slot_within_availability` was a yes/no oracle
for mapping a private calendar one timestamp at a time.

So: **any function that is not meant to be public must be revoked from
`anon` and `authenticated` by name**, and `availability_api.sql` asserts it.

The membership helpers are the deliberate exception. RLS policies call them,
and a policy expression is evaluated with the querying role’s privileges, so
revoking would break the isolation they enforce. They only ever answer
questions about the caller.

## Secrets

The anon key is **not** a secret. It is designed to ship in the client bundle,
and RLS is what constrains it.

The service-role key **is** a secret, and it bypasses RLS entirely.

Rules:

- Never prefix a secret with `EXPO_PUBLIC_`. Anything with that prefix is
  inlined into the bundle and shipped to every device.
- Never read a secret from `src/`. ESLint blocks importing a service-role
  client from application code.
- `.env`, `.env.local` and `.env.*.local` are git-ignored. `.env.example`
  carries names and shapes, never values.
- If a service-role key is ever committed or pasted anywhere shared, rotate it
  in the Supabase dashboard. Removing the commit is not enough.

## Input handling

`book_appointment` treats its arguments as hostile. It re-derives the end time
from the service's own duration rather than trusting a client-supplied end,
re-checks working hours, exceptions, blocks, minimum notice and horizon, and
trims and validates the customer fields.

The client-side engine is a convenience for the customer, not a control.

## Before production

Phase 6 in [PRODUCT.md](PRODUCT.md) covers the pre-launch security work:

- [ ] Run every RLS policy against a cross-tenant test suite
- [ ] Concurrency test: N clients racing for one slot, exactly one wins
- [ ] Rate limiting on `book_appointment`
- [ ] Review `get_availability_context` for enumeration abuse
- [ ] Decide on retention and deletion for customer personal data
- [ ] Confirm no `EXPO_PUBLIC_` variable holds anything sensitive
