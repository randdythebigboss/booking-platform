# Architecture decision records

One file per decision of consequence. Short, dated, and never rewritten: if a
decision changes, a new record supersedes the old one.

| #                                                        | Decision                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| [0001](0001-one-expo-codebase.md)                        | One Expo codebase for iOS, Android and web                       |
| [0002](0002-supabase-as-backend.md)                      | Supabase as the backend                                          |
| [0003](0003-availability-is-computed.md)                 | Availability is computed, never stored                           |
| [0004](0004-engine-on-client-enforcement-in-database.md) | The engine runs on the client; enforcement lives in the database |
| [0005](0005-exclusion-constraint-for-double-booking.md)  | A GiST exclusion constraint prevents double booking              |
| [0006](0006-guest-booking-via-definer-rpc.md)            | Guest booking through a SECURITY DEFINER function                |
| [0007](0007-vitest-for-domain-tests.md)                  | Vitest for domain tests                                          |
| [0008](0008-typed-routes-disabled.md)                    | Typed routes disabled for now                                    |
| [0009](0009-atomic-writes-via-invoker-functions.md)      | Multi-step writes go through SECURITY INVOKER functions          |
| [0010](0010-no-data-fetching-library.md)                 | No data-fetching library yet                                     |
| [0011](0011-slot-grid-anchored-to-shift-start.md)        | The slot grid is anchored to the shift start                     |
| [0012](0012-availability-api-returns-empty.md)           | The availability API answers with silence, not with errors       |
| [0013](0013-guest-access-by-bearer-link.md)              | A guest's appointment is reached by a bearer link                |
| [0014](0014-appointment-lifecycle.md)                    | The appointment lifecycle is a graph, not a column               |
| [0015](0015-one-event-log-for-appointment-history.md)    | One event log, not a status history table                        |
| [0016](0016-the-professional-is-not-a-customer.md)       | The published grid binds customers, not the owner                |
| [0017](0017-spanish-is-the-source-language.md)           | Spanish is the source language, parity enforced by types          |
| [0018](0018-customer-matching-is-deliberately-timid.md)  | Customer matching is deliberately timid                          |
| [0019](0019-the-guest-token-rides-in-the-fragment.md)    | The guest token rides in the URL fragment                        |
| [0020](0020-notifications-leave-through-an-outbox.md)     | Notifications leave through an outbox                            |
| [0021](0021-an-appointment-remembers-who-booked-it.md)   | An appointment remembers who booked it                           |
| [0022](0022-the-appointment-is-the-hold.md)               | The appointment is the hold                                      |
| [0023](0023-cancelling-is-not-refunding.md)              | Cancelling is not refunding                                      |
