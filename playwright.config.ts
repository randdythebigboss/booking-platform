import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * These tests drive the *built* application against a real database. They do
 * not replace the unit tests or the SQL suites -- those two already prove the
 * domain logic and the authorization. What only a browser can prove is that
 * the built bundle, the router, PostgREST and the screens agree with each
 * other, and that is the whole job here.
 *
 * The stack is brought up before the suite runs; see tools/e2e/run.sh and
 * docs/DEVELOPMENT.md. Nothing in this file talks to a cloud project, and CI
 * needs no credential to run it.
 */

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4321';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',

  // One worker, deliberately. The suite shares one database, and two tests
  // booking into the same calendar at the same time would fail each other for
  // reasons that have nothing to do with the product.
  workers: 1,
  fullyParallel: false,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  // Long enough for a cold bundle parse on a CI runner, short enough that a
  // hang is reported as a hang rather than sat on.
  timeout: 45_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL,
    // The application is Spanish first, and so is the browser driving it.
    locale: 'es-DO',
    timezoneId: 'America/Santo_Domingo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // Not the whole suite again: the specs tagged @mobile are the ones where
      // the layout can actually change whether something works.
      //
      // A narrow viewport rather than `devices['iPhone 13']` on purpose. A
      // real device descriptor also switches on touch emulation, and React
      // Native Web then listens for pointer events instead of the clicks
      // Playwright sends -- so the suite would fail on the framework rather
      // than on the product. The width is what the layout responds to.
      name: 'mobile',
      grep: /@mobile/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
  ],
});
