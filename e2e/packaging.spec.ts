import { bookAsGuest } from './support/app';
import { TENANT_A } from './support/fixtures';
import { expect, test } from './support/test';

/**
 * What a browser needs before it will offer to install this, and -- much more
 * importantly -- what the installed copy is allowed to remember.
 *
 * tests/packaging/manifest.test.ts checks the files. This checks the running
 * thing: that the manifest is served, that the service worker registers, and
 * that having registered it does not start answering questions about somebody's
 * calendar from a cache.
 */

test.describe('the installable web application', () => {
  test('serves a manifest a browser can install from', async ({ page }) => {
    await page.goto('/');

    const href = await page.getAttribute('link[rel="manifest"]', 'href');
    expect(href).toBeTruthy();

    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);

    const manifest = await response.json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.name).toBeTruthy();
    expect(manifest.icons.length).toBeGreaterThan(1);

    // Relative, so the same file is correct at a domain root and under a
    // repository subpath. See docs/DEPLOYMENT.md.
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
  });

  test('serves every icon the manifest promises', async ({ page }) => {
    await page.goto('/');
    const href = await page.getAttribute('link[rel="manifest"]', 'href');
    const manifest = await (await page.request.get(href!)).json();

    for (const icon of manifest.icons as { src: string }[]) {
      const response = await page.request.get(icon.src);
      expect(response.status(), `${icon.src} is missing`).toBe(200);
      expect(response.headers()['content-type']).toContain('image/png');
    }
  });

  test('registers a service worker', async ({ page }) => {
    await page.goto('/');

    await expect
      .poll(async () => page.evaluate(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.getRegistrations().then((r) => r.length > 0)), {
        timeout: 15_000,
      })
      .toBeTruthy();
  });

  /**
   * The rule the service worker exists to keep: it may cache the build, and
   * nothing else. An installed application that answered an availability
   * question from disk would be quietly lying about a real calendar.
   */
  test('never caches an API response', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await page.waitForTimeout(1500); // let the worker settle after registering

    const cached = await page.evaluate(async () => {
      if (!('caches' in window)) return [];
      const names = await caches.keys();
      const urls: string[] = [];

      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) urls.push(request.url);
      }

      return urls;
    });

    for (const url of cached) {
      expect(url, 'the cache holds an API response').not.toMatch(/\/rest\/v1\//);
      expect(url, 'the cache holds an auth response').not.toMatch(/\/auth\/v1\//);
    }

    // Whatever it did cache is the build's own output.
    for (const url of cached) {
      expect(url).toMatch(/\/(_expo|assets|icons|fonts)\//);
    }
  });

  test('does not put an appointment in any cache', async ({ page }) => {
    await bookAsGuest(page);

    const leaked = await page.evaluate(async () => {
      if (!('caches' in window)) return [];
      const found: string[] = [];

      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          const body = (await response?.text()) ?? '';
          if (body.includes('Lucía Prueba')) found.push(request.url);
        }
      }

      return found;
    });

    expect(leaked).toEqual([]);
  });
});
