import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * The HTML document every statically rendered web route is wrapped in.
 *
 * It exists for one line: the referrer policy.
 *
 * A guest's appointment is reached by a bearer token in the query string
 * (ADR 0013), so the full URL is a credential. Browsers put the full URL in
 * the `Referer` header of any outbound navigation, which means a single link
 * to a third party -- a map, an "add to calendar" service, an image on
 * somebody else's domain -- would hand that credential to them, silently and
 * forever after.
 *
 * `same-origin` sends a referrer only within this site and none at all to
 * anyone else. There is nothing that links out today; this is here so that the
 * day somebody adds such a link, it is not a disclosure.
 *
 * It does not affect native at all, and it does not touch routing, so deep
 * links keep working exactly as they did.
 *
 * Runs in Node during `expo export`, never in the browser.
 */
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

        {/* Disables body scrolling on web so ScrollView works as it does on native. */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
