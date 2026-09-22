import { existsSync, readFileSync } from 'node:fs';

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
    expect(manifest.start_url).toBe('/');
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
      expect(existsSync(`public${icon.src}`), icon.src).toBe(true);
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
      expect(hasAlpha(`public${icon.src}`), `${icon.src} must be opaque`).toBe(false);
    }
  });

  it('fills the frame with the `any` icons, and keeps the maskable one inside the safe zone', () => {
    const icons = manifest.icons as Icon[];

    // A literally drawn icon that leaves a margin looks shrunken next to every
    // other icon on the home screen.
    for (const icon of icons.filter((i) => i.purpose === 'any')) {
      expect(coverage(`public${icon.src}`), `${icon.src} should fill its frame`).toBeGreaterThan(0.9);
    }

    // A maskable icon is cropped to a circle or a squircle, so anything
    // outside the middle 80% can be cut off.
    for (const icon of icons.filter((i) => i.purpose === 'maskable')) {
      expect(coverage(`public${icon.src}`), `${icon.src} should stay inside the safe zone`).toBeLessThan(0.8);
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

describe('the service worker', () => {
  it('caches only the build output, and names the allowance explicitly', () => {
    expect(serviceWorker).toContain('_expo');
    expect(serviceWorker).toContain('assets');
    expect(serviceWorker).toContain('icons');
  });

  it('never caches anything from the API or another origin', () => {
    // The rule that matters: an installed application must not answer a
    // question about somebody's calendar from disk. Everything it will cache
    // is same-origin and is a path the build emits.
    expect(serviceWorker).toContain('url.origin === self.location.origin');

    const allowList = serviceWorker.match(/const CACHEABLE = \[(.*?)\];/s)?.[1] ?? '';
    expect(allowList).not.toBe('');
    expect(allowList).not.toMatch(/supabase/i);
    expect(allowList).not.toMatch(/rest/);
    expect(allowList).not.toMatch(/auth/);
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
