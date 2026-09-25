# Where the beta lives

**Deployed:** https://randdythebigboss.github.io/booking-platform/

GitHub Pages, on the repository that already existed. No hosting account was
created, no domain was bought and nothing costs anything. The build is
published by `.github/workflows/deploy-pages.yml` on every push to `main`,
after the same gates CI runs.

This is a **beta**. Every business, customer and appointment in it is
invented, no payment provider is connected and no message is ever sent. See
[LIMITATIONS.md](LIMITATIONS.md).

## What the build is

`npx expo export --platform web --output-dir dist` produces static files:
HTML, JavaScript, images, a web manifest and a service worker. There is no
server, no build step at request time and no runtime configuration — the
Supabase URL and publishable key are compiled in, so **a build belongs to one
environment** and pointing it at another means building again.

## What a host has to provide

| Requirement                        | Why                                                         | What happens without it                                     |
| ---------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| **HTTPS**                          | Service workers and installability require a secure context | The application works; it never offers to install           |
| **A fallback for unmatched paths** | Routing is client-side                                      | `/p/some-business` returns the host's own 404 page          |
| **Correct MIME types**             | `.webmanifest` and `.js` in particular                      | Silent: the manifest is ignored, the bundle may not execute |
| **Files served as-is**             | Nothing needs rewriting, minifying or injecting             | Varies, all bad                                             |

Nothing else. No environment variables at runtime, no secrets on the host, no
Node process, no database connection from the host.

## The fallback, which is the only interesting part

Expo Router writes one HTML file per route, and a dynamic route becomes a
literal directory: `dist/p/[slug].html`, `dist/p/[slug]/book.html`. No plain
file server matches `/p/demo-studio` against a folder called `[slug]`, so
every public booking link — the thing the product is _for_ — returns 404.

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

This is the deployment. Evaluated before it was chosen, by building for a
subpath and serving the result through a server that reproduces Pages' own
rules, then confirmed against the live site.

**It works.** Verified end to end at `/<repo>/`:

|                                                   |                                         |
| ------------------------------------------------- | --------------------------------------- |
| The application loads                             | ✅                                      |
| Deep link to `/<repo>/p/demo-studio/book`         | ✅ renders, via the `404.html` fallback |
| A guest booking, start to confirmation            | ✅                                      |
| The credential in the fragment, and a reload      | ✅                                      |
| Manifest fetched, `start_url` and `scope` correct | ✅                                      |
| Service worker registered, scoped to `/<repo>/`   | ✅                                      |

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

The workflow does it, and takes both values from `actions/configure-pages`
rather than from a string somebody typed:

```yaml
APP_BASE_PATH: ${{ steps.pages.outputs.base_path }} # /booking-platform
EXPO_PUBLIC_SITE_URL: ${{ steps.pages.outputs.base_url }}
```

Two build-time inputs come from **repository variables**, not from the
repository: `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
Both are public client configuration -- the publishable key is constrained
entirely by Row Level Security and ships in the bundle by design. No secret
key, no database password and no management token is used by the application
or by the workflow.

### The 404 fallback, and why it is not a copy of index.html

`tools/release/make-spa-fallback.cjs` writes it. Copying `index.html` works
and logs a React hydration error on every deep link: the file carries the home
page's pre-rendered markup, the client then draws a booking page, and React
finds text it did not expect. So the copy has its root emptied and
`__EXPO_ROUTER_HYDRATE__` turned off -- React renders instead of hydrating,
there is nothing to disagree about, and the console is clean. It also removes
the flash of home-page content before the router catches up.

The remaining wrinkle is inherent to Pages: a deep-linked route is served with
an HTTP 404 status while rendering correctly. That is invisible to a person
and matters only to a crawler, which is being asked to stay away anyway.

### Asking search engines to stay away

The build emits `<meta name="robots" content="noindex, nofollow">` and ships a
`robots.txt` that disallows everything. Opting back in is deliberate:
`EXPO_PUBLIC_ALLOW_INDEXING=1` at build time.

**This is not access control.** The URL is public and anyone who has it can
open the site. Nothing about the beta should be described as private.

The one caveat worth stating: a **user or organisation** site
(`name.github.io`) serves from the root and needs no `baseUrl` at all. A
**project** site needs it, and the setting is then wrong for every other host.
That is a reason to prefer a root-serving host, not a reason Pages cannot work.

## Host-neutral, deliberately

No provider-specific configuration file is committed. The export is plain
static output plus one rule — _unmatched path serves the application shell_ —
that every host can express. Committing a `vercel.json` would make the beta
quietly about Vercel.

## Supabase, when the URL is chosen

Two settings in the Supabase dashboard, under **Authentication → URL
Configuration**, have to name the beta URL before a professional can sign in
from it:

- **Site URL** — where authentication redirects land.
- **Redirect allow-list** — add `<beta-url>/**`.

The Site URL is now the beta, and the local development URLs remain in the
allow-list so local work is unaffected. Adding the beta did not remove them.

Also required at that point:

- `EXPO_PUBLIC_SITE_URL` set to the beta URL at build time, because it is what
  the dashboard's shareable booking link is built from.
- A build made against the beta's Supabase project, not a developer's.

## What is not prepared, and why

**Universal Links and App Links** — opening a native application from an
`https://` link — need `apple-app-site-association` and `assetlinks.json`
served from the production domain, plus a team identifier from a paid
developer account. Neither exists. Preparing them against a guessed domain
would produce files that are wrong in a way nothing would catch.

**A custom domain, a CDN configuration, cache headers beyond a host's
defaults.** All of them are decisions about a URL that has not been chosen.
