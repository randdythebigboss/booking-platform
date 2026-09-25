/**
 * The service worker, and what it is deliberately not allowed to do.
 *
 * It exists for one reason: a browser will not offer to install a web
 * application without one. It is therefore the smallest thing that satisfies
 * that and nothing more.
 *
 * **It never caches an API response.** Every request to Supabase goes to the
 * network, always, and if the network is not there the request fails and the
 * application says so. Availability is computed from a live calendar: a slot
 * that was free two minutes ago may be somebody else's now, and an installed
 * app that answers from a cache would show a booking page that is quietly
 * lying. There is no offline booking, on purpose.
 *
 * **It never caches a page.** Navigations go to the network too. What it
 * caches is the application's own static build output -- the JavaScript
 * bundle, fonts, icons -- which is immutable, hashed by the build, and
 * contains nothing about anybody.
 *
 * So: no customer data, no appointment data, no tokens, nothing private, ever
 * written to disk by this file.
 */

const CACHE = 'booking-platform-shell-v1';

/**
 * Where this deployment is served from, ending without a slash.
 *
 * `''` for a site at a domain root. `'/booking-platform'` when GitHub Pages
 * serves it from a repository subpath -- and the paths below have to allow for
 * that, or they match nothing at all. They matched nothing at all: the worker
 * installed, took control, and quietly cached zero bytes, because every asset
 * arrives as `/booking-platform/_expo/...` and the allow-list was written for
 * a root deployment.
 *
 * Taken from the registration's own scope rather than from a build-time
 * constant, so this file stays static and needs no templating.
 */
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');

// Only what the build emits, and only when it is hashed and immutable.
const CACHEABLE = ['/_expo/static/', '/assets/', '/icons/', '/fonts/'];

function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  return CACHEABLE.some((prefix) => url.pathname.startsWith(BASE + prefix));
}

self.addEventListener('install', () => {
  // Nothing is pre-cached: the build's filenames change every release, and a
  // hardcoded list is a list that goes stale.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Anything else -- a navigation, an API call, a cross-origin request -- is
  // left entirely alone. Not "network first": untouched.
  if (!isCacheable(url)) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
