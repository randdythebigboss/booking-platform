import { existsSync, readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

type Icon = { src: string; sizes: string; type: string; purpose: string };

const pixels = (path: string) => PNG.sync.read(readFileSync(path));

// `readUInt8` rather than indexing, because every index here is in bounds by
// construction and TypeScript cannot see that.
const hasAlpha = (path: string) => {
  const image = pixels(path);

  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data.readUInt8(i) < 255) return true;
  }

  return false;
};

/**
 * How much of the frame the artwork occupies, as a fraction of the width.
 *
 * "Artwork" is whatever differs from the colour in the corner, which is the
 * background of any icon worth shipping. A full-bleed icon returns ~1; a logo
 * floating in a margin returns the width of the logo.
 */
const coverage = (path: string) => {
  const image = pixels(path);
  const data = image.data;
  const background = [data.readUInt8(0), data.readUInt8(1), data.readUInt8(2)] as const;
  let left = image.width;
  let right = 0;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (image.width * y + x) * 4;
      const distance = Math.max(
        Math.abs(data.readUInt8(i) - background[0]),
        Math.abs(data.readUInt8(i + 1) - background[1]),
        Math.abs(data.readUInt8(i + 2) - background[2]),
      );

      if (distance > 24) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  return right < left ? 0 : (right - left + 1) / image.width;
};

/**
 * The packaging contract, checked in CI.
 *
 * A manifest that loses its icons or a service worker that starts caching API
 * responses are both silent: the application looks fine and the failure shows
 * up as somebody being offered an "install" that does not appear, or -- much
 * worse -- an installed app answering with a stale calendar.
 */

const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
const serviceWorker = readFileSync('public/sw.js', 'utf8');
const appConfig = JSON.parse(readFileSync('app.json', 'utf8')).expo;

describe('the web manifest', () => {
  it('has everything a browser needs before it offers to install', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    // Relative, so the same file works at a domain root and under a subpath.
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('ships an icon big enough to install with, and a maskable one', () => {
    const sizes = manifest.icons.map((icon: Icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');

    const purposes = manifest.icons.map((icon: Icon) => icon.purpose);
    expect(purposes).toContain('any');
    expect(purposes).toContain('maskable');
  });

  it('points at icons that exist', () => {
    for (const icon of manifest.icons as Icon[]) {
      expect(existsSync(`public/${icon.src}`), icon.src).toBe(true);
    }
  });

  /**
   * The defect this exists to prevent: Android's adaptive *foreground* is a
   * small logo on transparency, and it is tempting to reuse it everywhere.
   * Declared as `any` it is drawn literally -- and on an iOS home screen the
   * transparency composites onto black, so the application's icon becomes a
   * black square with a little glyph floating in the middle of it.
   */
  it('has no transparency in any icon it declares', () => {
    for (const icon of manifest.icons as Icon[]) {
      expect(hasAlpha(`public/${icon.src}`), `${icon.src} must be opaque`).toBe(false);
    }
  });

  it('fills the frame with the `any` icons, and keeps the maskable one inside the safe zone', () => {
    const icons = manifest.icons as Icon[];

    // A literally drawn icon that leaves a margin looks shrunken next to every
    // other icon on the home screen.
    for (const icon of icons.filter((i) => i.purpose === 'any')) {
      expect(coverage(`public/${icon.src}`), `${icon.src} should fill its frame`).toBeGreaterThan(
        0.9,
      );
    }

    // A maskable icon is cropped to a circle or a squircle, so anything
    // outside the middle 80% can be cut off.
    for (const icon of icons.filter((i) => i.purpose === 'maskable')) {
      expect(
        coverage(`public/${icon.src}`),
        `${icon.src} should stay inside the safe zone`,
      ).toBeLessThan(0.8);
    }
  });

  it('starts in the product language', () => {
    expect(manifest.lang).toBe('es');
  });

  it('agrees with the Expo configuration about what this application is', () => {
    expect(appConfig.web.themeColor).toBe(manifest.theme_color);
    expect(appConfig.web.name).toBe(manifest.name);
    expect(appConfig.scheme).toBe('bookingplatform');
  });
});

/**
 * Runs `public/sw.js` in a stubbed worker scope and hands back its
 * `isCacheable`, for a deployment served from `scope`.
 *
 * Executing it rather than reading it, because the bug this replaced a
 * string-matching test over was invisible in the source: the allow-list looked
 * completely reasonable and matched nothing at all once the site moved to a
 * repository subpath.
 */
function serviceWorkerAt(scope: string): (url: URL) => boolean {
  const context = {
    self: {
      registration: { scope },
      location: { origin: new URL(scope).origin },
      addEventListener() {},
      skipWaiting() {},
      clients: { claim() {} },
    },
    caches: { keys: async () => [], open: async () => ({}), match: async () => undefined },
    fetch: async () => ({}),
    URL,
    Promise,
  };

  createContext(context);
  runInContext(serviceWorker, context);

  return (context as unknown as { isCacheable: (url: URL) => boolean }).isCacheable;
}

describe('the service worker', () => {
  const ROOT = 'https://app.example.test/';
  const SUBPATH = 'https://someone.github.io/booking-platform/';

  it('caches the build output when the site is at a domain root', () => {
    const isCacheable = serviceWorkerAt(ROOT);

    for (const path of [
      '/_expo/static/js/web/entry-abc.js',
      '/assets/x.png',
      '/icons/icon-512.png',
      '/fonts/a.ttf',
    ]) {
      expect(isCacheable(new URL(path, ROOT)), path).toBe(true);
    }
  });

  /**
   * The regression. GitHub Pages serves a project site from `/<repo>/`, so
   * every asset arrives prefixed. An allow-list anchored at `/` matched none
   * of them, and the worker installed, took control and cached zero bytes --
   * silently, because caching nothing looks exactly like working.
   */
  it('caches the build output when the site is under a repository subpath', () => {
    const isCacheable = serviceWorkerAt(SUBPATH);

    for (const path of ['_expo/static/js/web/entry-abc.js', 'assets/x.png', 'icons/icon-512.png']) {
      expect(isCacheable(new URL(path, SUBPATH)), path).toBe(true);
    }

    // And it does not start caching another project served from the same host.
    expect(isCacheable(new URL('https://someone.github.io/other-repo/_expo/static/js/a.js'))).toBe(
      false,
    );
  });

  it('never caches an API response, a page, or another origin', () => {
    for (const scope of [ROOT, SUBPATH]) {
      const isCacheable = serviceWorkerAt(scope);

      expect(isCacheable(new URL('rest/v1/appointments?select=*', scope)), scope).toBe(false);
      expect(isCacheable(new URL('auth/v1/token', scope)), scope).toBe(false);
      expect(isCacheable(new URL('p/demo-studio/book', scope)), scope).toBe(false);
      expect(isCacheable(new URL(scope)), scope).toBe(false);
      expect(isCacheable(new URL('https://abcdef.supabase.co/rest/v1/appointments')), scope).toBe(
        false,
      );
    }
  });

  it('leaves navigations alone rather than serving pages from a cache', () => {
    expect(serviceWorker).toContain("request.method !== 'GET'");
    expect(serviceWorker).toContain('if (!isCacheable(url)) return;');
  });
});

describe('native configuration', () => {
  it('has the identifiers a build would need, without enrolling anywhere', () => {
    expect(appConfig.ios.bundleIdentifier).toBe('com.bookingplatform.app');
    expect(appConfig.android.package).toBe('com.bookingplatform.app');
    expect(appConfig.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('keeps the deep-link scheme the guest links are built against', () => {
    expect(appConfig.scheme).toBe('bookingplatform');
  });
});
