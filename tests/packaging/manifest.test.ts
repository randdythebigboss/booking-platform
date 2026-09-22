import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

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
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toContain('512x512');

    const purposes = manifest.icons.map((icon: { purpose: string }) => icon.purpose);
    expect(purposes).toContain('maskable');
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
