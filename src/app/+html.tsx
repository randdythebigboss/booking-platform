import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * The HTML document every statically rendered web route is wrapped in.
 *
 * Two things live here, and both are about the guest's booking credential.
 *
 * A guest reaches their appointment with a bearer token. It now rides in the
 * URL fragment (`#token=...`), which is never sent to a server -- see
 * `src/features/booking/guest-token.ts`. Links shared before that change carry
 * `?token=...` instead, and those have to keep working.
 *
 * 1. `referrer: same-origin` sends a referrer only within this site and none
 *    at all to anyone else, so a link to a map, a calendar service or an image
 *    on somebody else's domain cannot hand the URL -- and with it, for a
 *    legacy link, the credential -- to a third party.
 *
 * 2. The inline script moves a legacy `?token=` into the fragment before
 *    anything else runs. It is deliberately here, in the document, rather than
 *    only in React: by the time the bundle mounts, the router has already read
 *    the query and owns the URL, and a rewrite from inside a component races
 *    with the router's own history writes. Running at parse time means the
 *    router never sees a `token` search parameter at all, so it cannot put one
 *    back. `useGuestToken` still performs the same upgrade, for native and for
 *    anything that reaches the screen without this shell.
 *
 * Neither affects native, and neither touches routing, so deep links keep
 * working exactly as they did.
 *
 * This component runs in Node during `expo export`, never in the browser. The
 * script it emits is the part that runs in the browser.
 */

/**
 * Moves `?token=` to `#token=` in place, before the application loads.
 *
 * Kept small, dependency-free and wrapped in try/catch: it runs before
 * anything else on the page, so it must not be able to stop the page loading.
 * The token is never logged, and `replaceState` rather than a push means the
 * query form does not stay one Back press away.
 */
const UPGRADE_LEGACY_TOKEN = `(function(){try{
var l=window.location;if(l.search.indexOf('token=')<0)return;
var p=new URLSearchParams(l.search);var t=p.get('token');if(!t)return;
p.delete('token');var q=p.toString();
var h=l.hash&&l.hash.indexOf('token=')>=0?l.hash:'#token='+encodeURIComponent(t);
window.history.replaceState(null,'',l.pathname+(q?'?'+q:'')+h);
}catch(e){}})();`;

/**
 * Registers the service worker, quietly.
 *
 * Wrapped and deferred: nothing about installability is worth delaying the
 * first paint for, and a browser without service workers -- or a page served
 * from a file, or a context that refuses them -- must load exactly as before.
 * A failure here is not an error the customer needs to hear about.
 */
const REGISTER_SERVICE_WORKER = `(function(){try{
if(!('serviceWorker' in navigator))return;
window.addEventListener('load',function(){
navigator.serviceWorker.register('/sw.js').catch(function(){});
});
}catch(e){}})();`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />

        {/* The booking link is a credential. Do not hand it to anyone else. */}
        <meta name="referrer" content="same-origin" />

        {/* Before the router can read it: the credential leaves the query. */}
        <script dangerouslySetInnerHTML={{ __html: UPGRADE_LEGACY_TOKEN }} />

        {/* Installable as a web application: the manifest, the colour the
            browser paints its chrome, and the bits iOS reads instead. None of
            this changes how the application behaves in a tab. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#208AEF" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Booking" />
        <link rel="apple-touch-icon" href="/icons/icon-512.png" />
        <meta
          name="description"
          content="Toma citas con un solo enlace. Tu calendario, tus servicios, tus clientes."
        />

        {/* Registers the service worker, which exists so a browser will offer
            to install this, and which caches nothing but the build's own
            static files. See public/sw.js. */}
        <script dangerouslySetInnerHTML={{ __html: REGISTER_SERVICE_WORKER }} />

        {/* Disables body scrolling on web so ScrollView works as it does on native. */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
