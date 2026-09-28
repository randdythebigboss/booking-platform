# 0024. No web push until it can be delivered and tested end to end

Date: 2026-09-28
Status: accepted

## Context

The first professional to field-test the beta asked for a notification on his
phone when a customer books, and reminders 15 or 30 minutes before an
appointment. Both are reasonable requests and neither is currently met: the
product tells him about a new booking only when he opens it and looks.

The question this record answers is not "would push be nice". It is "can this
product deliver a push notification to a closed application, at zero cost,
securely, and can we prove it".

## What is already here

- A service worker (`public/sw.js`) exists **only** so a browser will offer to
  install the application. It caches the static build and nothing else, and it
  has no `push` and no `notificationclick` handler.
- The notification outbox already models the right events, including
  `booking_created` for the professional, and already has an `in_app` channel.
- Delivery is a mock provider. `tools/notifications/dispatch.ts` is run by
  hand.

So the event model is ready. The delivery path is not.

## What genuine web push would require

1. `push` and `notificationclick` handlers in the service worker.
2. A VAPID key pair. Free.
3. A table of device subscriptions, with RLS confining each row to its owner,
   and a migration to create it. **Applying a migration to the shared cloud
   project is a Product Owner operation** in this project: it is done in the
   dashboard SQL editor, and no service-role key or database password is
   held by anyone else.
4. Something that runs **when the application is closed** and sends the push.
   This is the part that decides the answer. The candidates:
   - a Supabase Edge Function: needs a deploy credential the Product Owner
     holds, and is a new runtime this project has so far avoided;
   - a Postgres trigger making an outbound request: needs `pg_net` or `http`,
     neither of which is enabled, and enabling one is again a dashboard
     operation;
   - a scheduled GitHub Actions workflow: free, but its floor is roughly five
     minutes, scheduled runs are throttled on a quiet repository, and it would
     require the service-role key to live as a CI secret. A key that can read
     every table in the project, stored so that a scheduled job can use it
     unattended, is a materially larger security decision than the feature.

## The platform reality, which is not uniform

- **Android, Chrome desktop, Edge**: web push works well.
- **iOS/iPadOS**: web push exists from 16.4, but **only** for a PWA the user
  has added to the Home Screen, and only while the system has not evicted it.
  A hairstylist with an iPhone who has not installed the page to his Home
  Screen gets nothing at all, and there is no way for the application to tell
  him that reliably in advance.

So even a correct implementation would deliver to some professionals and
silently not to others, on a device split we cannot see.

## Decision

**We do not implement web push in this phase.**

Three of the four requirements above are Product Owner operations, and the
fourth is a security decision about a service-role key that the feature does
not justify on its own. Most importantly, none of it can be tested end to end
from here: there is no way to prove a notification arrives on a closed phone
without the credentials to deploy the sender and a device to receive it.

The instruction this follows is the project's own: do not ship a control that
appears enabled and cannot deliver anything. A toggle labelled "notify me on
my phone" that silently does nothing on iOS would be worse than the honest
absence of one.

## What we do instead

- Say plainly, where the professional would look for it, that nothing is sent
  outside the application yet. The notifications screen now says exactly that
  rather than describing a mock provider.
- Keep the outbox as the single record of what the product intends to send, so
  that when a delivery path is approved the events do not have to be invented.

## What would change this

Any one of these, from the Product Owner, makes it worth revisiting:

- approval to deploy a Supabase Edge Function, plus the credential to do it;
- approval to hold a service-role key as a CI secret for a scheduled sender;
- a decision that Android-and-desktop-only delivery is acceptable, stated to
  the professionals who will rely on it.

Until one of those exists, the honest product is the one that does not
pretend.
