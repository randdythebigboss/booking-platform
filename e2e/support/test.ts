import { test as base } from '@playwright/test';

import { resetDatabase } from './db';

/**
 * The `test` every spec in this suite imports.
 *
 * It is Playwright's, with one thing added: the database goes back to the
 * fixtures before each test, automatically. Making that opt-in would mean
 * every new spec is one forgotten line away from depending on whatever the
 * test before it left behind.
 */
export const test = base.extend<{ freshDatabase: void }>({
  freshDatabase: [
    // Playwright reads the destructured names to decide what to inject, so the
    // parameter has to be a pattern even when this fixture needs nothing.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      resetDatabase();
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
