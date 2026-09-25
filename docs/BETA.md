# Running a beta that costs nothing

What can be tested, shown and installed for $0, what it would take to go
further, and which of those steps only the Product Owner can take.

## The zero-cost rule

Nothing in this product activates an integration that requires payment,
billing details, a card, paid credits, a paid subscription, a commercial
commitment, or a platform fee merely to keep developing. Where a real provider
would go, there is an abstraction and a mock:

| Capability                 | What runs today                                    | What a real one would need                                                                                                                 |
| -------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Payments                   | `MockPaymentProvider`, behind a server-side switch | An account with Azul, CardNET, Stripe where available, or another compatible provider — merchant onboarding, and terms accepted personally |
| Email, SMS, WhatsApp       | `MockNotificationProvider`                         | A paid transactional provider                                                                                                              |
| iOS distribution           | Nothing                                            | Apple Developer Program, paid annually                                                                                                     |
| Android distribution       | Nothing                                            | Google Play registration, paid once                                                                                                        |
| Native builds in the cloud | Nothing                                            | An Expo account; EAS has a free tier, but the account is the Product Owner's to create                                                     |

**No real provider is connected, and no provider credential exists anywhere in
this repository or in the development project.** The provider abstractions
stay because postponing a provider is not the same as not having a seam for
one.

## What works for nothing today

**The web application, as a web application.** Built with
`npx expo export --platform web`, served by any static file server. This is
how every flow in the product is exercised.

**The web application, installed.** The export carries a manifest, icons,
theme colour and a service worker, so a browser offers "install" and the
result opens without browser chrome, has its own icon, and behaves like an
application. Nothing about installation requires an account or a store.

The icons come from `tools/dev/generate-web-icons.cjs`, which derives them from
the native ones and is run by hand when those change. It exists because the two
kinds of manifest icon are not interchangeable and look identical in a file
listing:

- An icon marked **`any`** is drawn literally — in the install prompt, in the
  task switcher, and on an iOS home screen, where transparency composites onto
  black rather than onto the page. It has to be opaque and full bleed.
- An icon marked **`maskable`** is cropped by the launcher to a circle, a
  squircle or a rounded square, so its corners must be filled and its logo must
  sit inside the middle 80%.

Android's adaptive _foreground_ is the second kind. Serving it as the first is
how an application ends up with a black square for an icon, so the packaging
tests assert opacity and coverage rather than merely that a file exists.

Two things are true about that install and are deliberate:

- It caches the build's own static files and **nothing else** — no page, no
  API response, no appointment. An installed application that answered
  availability from disk would be quietly lying about somebody's calendar.
- It needs HTTPS (or `localhost`) to install, because service workers do. A
  local development server on `127.0.0.1` qualifies.

**Expo Go, over the local network.** `npx expo start` prints a URL a phone on
the same wifi can open in Expo Go, which is a free application from either
store. Nothing needs to be signed. This is the cheapest way to see the product
on real hardware, and the only caveat is that Expo Go runs the SDK's own
native shell — anything the project added natively is not there. This project
adds nothing native today.

**A tunnel, if the phone is not on the same network.** `npx expo start
--tunnel` uses a free service. It is slower and occasionally flaky; the local
network is better where it works.

## What would cost something, and who has to do it

Each of these is a Product Owner step, not an engineering one:

1. **An Expo account** — free, and needed before `eas build` can produce an
   installable Android `.apk` in the cloud. EAS has a free tier; the account
   creation and its terms are personal.
2. **Google Play registration** — one-off fee, needed only to list publicly.
   An `.apk` can be installed directly on an Android device without it.
3. **Apple Developer Program** — annual fee, needed for any iOS install beyond
   Expo Go, including TestFlight.
4. **A domain and hosting** — the export is static and can be served from many
   free tiers, but choosing one is a decision about where customer traffic
   goes, and it is not made here.

A local Android build (`npx expo run:android`) needs Android Studio and a JDK
on this machine rather than money. It has not been attempted here, because a
successful local build proves the toolchain on one machine, which is worth
less than the checks that already run in CI.

## Deep links, for whenever there is a native build

The URL scheme is `bookingplatform://`, declared in `app.json`, and the web
paths are the contract. A native application would consume exactly these:

| Concept                   | Web                                  | Native                                                |
| ------------------------- | ------------------------------------ | ----------------------------------------------------- |
| A business's public page  | `/p/{slug}`                          | `bookingplatform://p/{slug}`                          |
| Booking a service         | `/p/{slug}/book`                     | `bookingplatform://p/{slug}/book`                     |
| A guest's own appointment | `/booking/{id}/confirmation#token=…` | `bookingplatform://booking/{id}/confirmation#token=…` |

Two things matter here and are already true:

- **The guest credential rides in the fragment**, and `useGuestToken` reads it
  through `Linking.useURL()` on native, because `useLocalSearchParams` drops a
  fragment. A deep link therefore carries the credential exactly as a web link
  does (ADR 0019).
- **Web URLs do not change** to accommodate native. The scheme mirrors the
  paths rather than replacing them.

Universal Links and App Links — the mechanism that opens a native application
from an `https://` URL — need `apple-app-site-association` and
`assetlinks.json` files served from a production domain, and a team
identifier from a paid developer account. Neither can be prepared
meaningfully without owning both, so neither has been.

## Resetting the demo

`tools/dev/reset-demo-data.sh` returns a development database to the Spanish
demo fixtures. It refuses unless `platform_settings.environment` says
`development` **and** `ALLOW_DEV_RESET=yes` is in the environment. See
[OPERATIONS.md](OPERATIONS.md).

## Before inviting anyone

- Turn the payment demo off in any shared environment, unless the point of the
  session is to show the payment flow:
  `update public.platform_settings set payment_simulation_enabled = false;`
  With it off, services that ask for money are marked unavailable and cannot
  be booked, and free services behave exactly as they always have.
- Decide the retention and deletion questions in [PRIVACY.md](PRIVACY.md), or
  decide deliberately to defer them for a closed demo with invented data.
- Read [OPERATIONS.md](OPERATIONS.md) for what a support conversation looks
  like, and where the diagnostics screen is.
