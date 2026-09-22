# Putting the beta somewhere

What the application needs from a host, what has been verified against a real
one, and what changes when the URL is chosen.

**Nothing here has been deployed.** No hosting account exists, no domain has
been bought, and making the application publicly reachable is a Product Owner
decision, not an engineering one.

## What the build is

`npx expo export --platform web --output-dir dist` produces static files:
HTML, JavaScript, images, a web manifest and a service worker. There is no
server, no build step at request time and no runtime configuration — the
Supabase URL and publishable key are compiled in, so **a build belongs to one
environment** and pointing it at another means building again.

## What a host has to provide

| Requirement | Why | What happens without it |
| --- | --- | --- |
| **HTTPS** | Service workers and installability require a secure context | The application works; it never offers to install |
| **A fallback for unmatched paths** | Routing is client-side | `/p/some-business` returns the host's own 404 page |
| **Correct MIME types** | `.webmanifest` and `.js` in particular | Silent: the manifest is ignored, the bundle may not execute |
| **Files served as-is** | Nothing needs rewriting, minifying or injecting | Varies, all bad |

Nothing else. No environment variables at runtime, no secrets on the host, no
Node process, no database connection from the host.

## The fallback, which is the only interesting part

Expo Router writes one HTML file per route, and a dynamic route becomes a
literal directory: `dist/p/[slug].html`, `dist/p/[slug]/book.html`. No plain
file server matches `/p/demo-studio` against a folder called `[slug]`, so
every public booking link — the thing the product is *for* — returns 404.

Two ways to fix it, and the first works everywhere:

**A `404.html` that is the application shell.** Copy `index.html` to
`404.html` after building. Any unmatched path serves the application, the
client router reads the path and renders the right screen. Every static host
already has this behaviour; nothing is configured.

```bash
npx expo export --platform web --output-dir dist
cp dist/index.html dist/404.html
```

The honest caveat: the page renders correctly but the HTTP status is 404.
That is invisible to a person and matters only to a crawler.

**A rewrite rule, where the host offers one.** Conceptually the same thing,
with a 200:

> serve any path that is not a file as `/index.html`

Every host spells this differently — `_redirects`, `vercel.json`, `serve.json`,
an `nginx` `try_files`. None of it belongs in the repository until a host is
chosen, so none of it is here.

## GitHub Pages

The repository is already on GitHub, so Pages is the obvious $0 option. It was
evaluated properly rather than assumed, by building for a subpath and serving
the result through a server that reproduces Pages' own rules.

**It works.** Verified end to end at `/<repo>/`:

| | |
| --- | --- |
| The application loads | ✅ |
| Deep link to `/<repo>/p/demo-studio/book` | ✅ renders, via the `404.html` fallback |
| A guest booking, start to confirmation | ✅ |
| The credential in the fragment, and a reload | ✅ |
| Manifest fetched, `start_url` and `scope` correct | ✅ |
| Service worker registered, scoped to `/<repo>/` | ✅ |

Two things make that true, and both are in the repository now:

1. **`experiments.baseUrl` in `app.json`**, set to `/<repo>`. Expo then
   prefixes the paths it emits. It is **not** set by default, because the
   default deployment is a domain root and a wrong `baseUrl` breaks everything.
2. **Relative URLs where Expo does not reach.** The manifest link, the
   apple-touch icon and the service-worker registration are written by hand in
   `src/app/+html.tsx`, and now read `process.env.EXPO_BASE_URL`. The manifest
   itself uses `./` for `start_url` and `scope` and relative icon paths, so the
   same file is correct at a root and under a subpath.

Before this, all of those pointed at the domain root and 404'd under a
subpath. The application still ran, and simply never offered to install — the
kind of failure nobody notices.

To deploy there, someone would:

```bash
# in app.json: "experiments": { "baseUrl": "/booking-platform" }
npx expo export --platform web --output-dir dist
cp dist/index.html dist/404.html
```

and publish `dist/` to the Pages branch. **This has not been done, and Pages
has not been enabled.**

The one caveat worth stating: a **user or organisation** site
(`name.github.io`) serves from the root and needs no `baseUrl` at all. A
**project** site needs it, and the setting is then wrong for every other host.
That is a reason to prefer a root-serving host, not a reason Pages cannot work.

## Host-neutral, deliberately

No provider-specific configuration file is committed. The export is plain
static output plus one rule — *unmatched path serves the application shell* —
that every host can express. Committing a `vercel.json` would make the beta
quietly about Vercel.

## Supabase, when the URL is chosen

Two settings in the Supabase dashboard, under **Authentication → URL
Configuration**, have to name the beta URL before a professional can sign in
from it:

* **Site URL** — where authentication redirects land.
* **Redirect allow-list** — add `<beta-url>/**`.

Today they are `http://127.0.0.1:4320` and `http://127.0.0.1:4320/**`, which is
local development. **No placeholder for a future URL has been invented**, and
nothing here should be changed until a real one exists — a guessed URL in an
allow-list is an open redirect nobody is watching.

Adding the beta URL does not remove the local one. Both can be in the
allow-list, and local development keeps working.

Also required at that point:

* `EXPO_PUBLIC_SITE_URL` set to the beta URL at build time, because it is what
  the dashboard's shareable booking link is built from.
* A build made against the beta's Supabase project, not a developer's.

## What is not prepared, and why

**Universal Links and App Links** — opening a native application from an
`https://` link — need `apple-app-site-association` and `assetlinks.json`
served from the production domain, plus a team identifier from a paid
developer account. Neither exists. Preparing them against a guessed domain
would produce files that are wrong in a way nothing would catch.

**A custom domain, a CDN configuration, cache headers beyond a host's
defaults.** All of them are decisions about a URL that has not been chosen.
