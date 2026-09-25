/**
 * Writes the `404.html` a static host serves for an unmatched path.
 *
 *   node tools/release/make-spa-fallback.cjs dist
 *
 * ---------------------------------------------------------------------------
 * Why this is not just `cp index.html 404.html`
 * ---------------------------------------------------------------------------
 *
 * Expo Router writes one pre-rendered HTML file per route, and a dynamic route
 * becomes a literal directory -- `dist/p/[slug].html`. No static host matches
 * `/p/demo-studio` against a folder called `[slug]`, so the public booking
 * link, which is the whole product, returns the host's 404. Serving the
 * application for unmatched paths is the fix, and on GitHub Pages the only
 * hook for that is `404.html`.
 *
 * Copying `index.html` works, and logs a React hydration error on every
 * dynamic route: the file carries the *home page's* pre-rendered markup, the
 * client then draws a booking page, and React finds text it did not expect.
 * It recovers by re-rendering, so nothing breaks -- but a console full of
 * errors is not something to hand to a beta tester, and it would hide the next
 * real one.
 *
 * So this file does two things to the copy. It empties the root container, so
 * there is no pre-rendered home page to flash before the router replaces it.
 * And it turns off `__EXPO_ROUTER_HYDRATE__`, which is what makes the bundle
 * call `hydrateRoot` instead of `createRoot().render()` -- with the flag off
 * React is not comparing anything to anything and there is no mismatch to
 * report.
 *
 * The cost is that this one file shows nothing until the bundle parses. Every
 * directly-addressable route keeps its own pre-rendered shell and is
 * unaffected.
 */
const fs = require('fs');
const path = require('path');

const dist = process.argv[2] ?? 'dist';
const source = path.join(dist, 'index.html');
const target = path.join(dist, '404.html');

const html = fs.readFileSync(source, 'utf8');

// The root Expo Router mounts into, with everything the export pre-rendered
// inside it. Non-greedy would stop at the first nested `</div>`, so this
// matches to the last one before the closing body.
const ROOT = /(<div id="root">)[\s\S]*(<\/div>\s*<script)/;

const HYDRATE = 'globalThis.__EXPO_ROUTER_HYDRATE__=true;';

if (!ROOT.test(html)) {
  throw new Error(`Could not find the root container in ${source}. Did the export format change?`);
}

if (!html.includes(HYDRATE)) {
  throw new Error(`Could not find the hydration flag in ${source}. Did the export format change?`);
}

const fallback = html
  .replace(ROOT, '$1$2')
  .replace(HYDRATE, 'globalThis.__EXPO_ROUTER_HYDRATE__=false;');

fs.writeFileSync(target, fallback);

console.log(
  `${target}  ${Math.round(fallback.length / 1024)} KB ` +
    `(${Math.round((1 - fallback.length / html.length) * 100)}% smaller than index.html)`,
);
