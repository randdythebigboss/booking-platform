# What still blocks real people

Phase 13 is approved for **fictional data**. This page is the single answer to
the only question that matters before that changes: _can a real professional,
with real customers, use this yet?_

**No.** Not because the product does not work — it does — but because four
things a person is entitled to have are not built, and one thing that happened
in Phase 12 has to be understood before it happens again.

Everything here is a gate, not a bug. Each one is a decision somebody has to
make, and none of them is engineering's to make alone.

---

## The shortest version

| Gate                  | State                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| Retention             | **None.** Nothing is ever deleted, and no period exists for anything.    |
| Deletion on request   | **No path.** And a booking's recorded identity cannot be rewritten.      |
| Account recovery      | **None.** No password reset, because nothing can send email.             |
| Message delivery      | **Nothing is ever sent.** The in-app thread is the only working channel. |
| Identity of a sign-up | **Unverified.** Anyone can register any address and use it immediately.  |
| Environments          | **One.** A development project. There is no production.                  |

---

## 1. Retention

Nothing in this product deletes anything, ever, and no retention period has
been chosen for any of it:

- `appointments`, and their immutable snapshot of who booked and what they paid
- `customers` — name, telephone, and email where one was given
- `appointment_events` — the full lifecycle of every booking
- `notifications` — including **the recipient's address, stored on the row**
- `payments` and `payment_events`
- `appointment_messages` — what a customer and a professional said to each other

The periods argue against each other, which is why this cannot be decided in
passing: an accounting or dispute window wants payment records kept for years,
and a conversation about a haircut does not need keeping at all. Both numbers
are open. See [PRIVACY.md](PRIVACY.md).

## 2. Deletion on request

There is no way for a customer to ask for their data to be removed, and no
mechanism that would carry such a request through appointments, history,
notifications and payments.

Two specifics that make this harder than it sounds:

- **A booking's identity is immutable by design.** A database trigger raises
  `APPOINTMENT_IDENTITY_IS_IMMUTABLE` if anything tries to rewrite
  `customer_name_snapshot` on an existing appointment. That is correct — a
  record that can be edited is not a record — but it means **anonymising in
  place is not possible**. Erasure would have to delete the appointment, which
  destroys history the business may be required to keep.
- **Deleting the `customers` row is not erasure.** The snapshots on past
  appointments keep the name and telephone number regardless.

So "delete my data" needs a policy decision about what history is allowed to
lose, before it needs any code.

Export on request has the same status: nothing exists.

## 3. Account recovery

- **There is no password reset.** It needs email, and no email provider is
  connected. A professional who forgets their password today has no route back
  to their own business.
- The seeded demo account cannot be recovered even in principle:
  `demo@bookingplatform.test` is on a reserved non-deliverable domain, and
  GoTrue refuses it as invalid. Its password can only be changed from the
  Supabase dashboard.
- **Email confirmation is off.** `signUp` returns a usable session
  immediately, for any address, whether or not the person owns it. In a beta
  with real people that is an impersonation route: somebody can register
  `owner@somebodyelses-salon.com` and be signed in before anyone notices.
- No two-factor authentication, no single sign-on, no session revocation, and
  no staff accounts — one person per business, owner only.

## 4. Message delivery

- **Nothing leaves the application.** No email, no SMS, no WhatsApp, no push.
- Notifications are composed, queued in an outbox, and handed to a
  `MockNotificationProvider` that delivers nothing. The queue, its states, its
  retries and its deduplication are all real and visible under _Avisos_; the
  delivery is not.
- **The dispatcher is not deployed.** It is a script somebody runs by hand.
  Nothing drains the outbox on a schedule.
- Reminders are scheduled, rescheduled and cancelled correctly. None arrives.
- The **in-app conversation on each appointment is the only channel that
  works** — and nothing tells anybody a message is waiting. A customer reads it
  the next time they open their booking link. Settings says so, in both
  languages, next to the reminder control.

A real customer who is told "we will remind you" and is not reminded has been
lied to by the product. That is the reason this is a gate and not a backlog
item.

---

## What this checkpoint found

### The demo password was published, and it worked

Until 25 September 2026 the shared cloud demo account's password was printed on
the front page of a public repository. It signed in. A session reached **13
customer rows**, including one **genuine personal email address and telephone
number** left by a real test booking.

- The cloud account's password has been **changed**, and the old one verified
  dead.
- The front page no longer states a password;
  `tests/packaging/credentials.test.ts` fails if it starts again.
- The seed and the development guide now say, next to the value, that it
  unlocks a disposable local database and nothing else.

**What is not fixed, and cannot be:** the old value is in public git history for
ever. Any account anywhere that still uses it is compromised. Rotation is the
only remedy, and it has to happen out of band.

The cause was not the password. It was loading `supabase/seed.sql` — a file
that already carried a warning — into a shared project.

### Loose ends in the development project

None of these is dangerous with fictional data. All of them should be cleared
before a real person is invited.

- One customer row holds a real personal email address and telephone number.
  It is the Product Owner's own, from a test booking. It is theirs to remove.
- Two throwaway `probe-…@bookingplatform.test` accounts were created by this
  checkpoint to establish whether sign-up is open. Removing an auth user needs
  the dashboard.
- A second business, **Salón Aurora**, exists from a Phase 12 self-service
  test, owned by a different account, published, with a professional also
  called "Alex Rivera".

---

## What would have to be true

Not a plan, and not an estimate — the list a decision has to cover:

1. Retention periods, per table, with the accounting question answered.
2. A deletion path, and a decision about what history may lose.
3. An email provider, which unlocks password reset, email confirmation and
   every notification channel at once. **This costs money**, so it is a
   Product Owner decision.
4. A production environment, separate from development, with its own project,
   its own data and backups that somebody has tested restoring.
5. A controller relationship between the platform and each business, written
   down, with a legal basis, a notice and consent wording.
6. Who is on call when it breaks.

Until then: **fictional data only.** Reserved test domains, telephone numbers
in the 555 range, invented people.

## See also

[PRIVACY.md](PRIVACY.md) · [SECURITY.md](SECURITY.md) ·
[LIMITATIONS.md](LIMITATIONS.md) · [OPERATIONS.md](OPERATIONS.md) ·
[BETA-TESTING.md](BETA-TESTING.md)
