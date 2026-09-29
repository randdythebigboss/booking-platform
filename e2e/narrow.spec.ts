import type { Page } from '@playwright/test';

import { signIn } from './support/app';
import { TENANT_A } from './support/fixtures';
import { expect, test } from './support/test';

/**
 * 320 pixels, which is as narrow as a phone gets.
 *
 * ---------------------------------------------------------------------------
 * Why this is its own suite
 * ---------------------------------------------------------------------------
 *
 * A control that is off the side of the screen is not a cosmetic problem. The
 * page does not scroll sideways, so there is no gesture that brings it back:
 * the button simply cannot be pressed, and the professional's only clue is
 * that the thing they were told to tap is not there.
 *
 * Two of these were real. On the calendar, "change every week" sat a hundred
 * pixels past the edge, because a row of buttons is laid out at its content
 * width and React Native does not shrink it unless told to -- so the `wrap`
 * that was supposed to stack them never got a narrow line to wrap onto. In
 * the block editor, the two time boxes each measured 181px inside a 115px
 * column, because a browser gives every text input an intrinsic width of
 * about twenty characters and will not go below it without `minWidth: 0`.
 *
 * Both were invisible at every width the suite tested before this one, and
 * both were invisible in the source. Only measuring the built page finds
 * them, so the measurement is the test.
 *
 * ---------------------------------------------------------------------------
 * What counts as a failure
 * ---------------------------------------------------------------------------
 *
 * Not everything wider than the window is wrong. The date strip and the
 * segmented filters are deliberately horizontal scrollers -- they are meant
 * to run past the edge, and a finger brings the rest into view. So an element
 * is only reported when nothing above it scrolls horizontally, which is
 * exactly the case where the user has no way to reach it.
 */

const NARROW = { width: 320, height: 720 };

/** Elements outside the viewport that no ancestor can scroll into view. */
async function unreachable(page: Page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const found: { text: string; left: number; right: number }[] = [];

    for (const element of Array.from(document.querySelectorAll('*'))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right <= viewport + 1 && box.left >= -1) continue;

      let ancestor = element.parentElement;
      let scrollable = false;
      while (ancestor && !scrollable) {
        const overflow = getComputedStyle(ancestor).overflowX;
        if (ancestor.scrollWidth > ancestor.clientWidth && /auto|scroll/.test(overflow)) {
          scrollable = true;
        }
        ancestor = ancestor.parentElement;
      }
      if (scrollable) continue;

      found.push({
        text: (element.textContent ?? '').trim().slice(0, 60),
        left: Math.round(box.left),
        right: Math.round(box.right),
      });
    }

    // The outermost offender is the useful one; its children repeat it.
    return found.slice(0, 5);
  });
}

async function expectNothingOffScreen(page: Page) {
  const offScreen = await unreachable(page);
  expect(offScreen, JSON.stringify(offScreen, null, 2)).toEqual([]);
}

test.describe('nothing is off the side of a 320px screen', () => {
  test.use({ viewport: NARROW });

  test('the pages anyone can reach', async ({ page }) => {
    for (const route of ['/p/demo-studio', '/p/demo-studio/book', '/login']) {
      await page.goto(route);
      await expect(page.locator('body')).toContainText(/\w/);
      await expectNothingOffScreen(page);
    }
  });

  test('the pages a professional works in', async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);

    const routes = [
      '/app/dashboard',
      '/app/calendar',
      '/app/appointments',
      '/app/services',
      '/app/availability',
      '/app/availability/exceptions',
      '/app/availability/blocks',
      '/app/availability/preview',
      '/app/notifications',
      '/app/settings',
    ];

    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator('body')).toContainText(/\w/);
      await expectNothingOffScreen(page);
    }
  });

  test('both ways of changing the hours can actually be pressed', async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/calendar');

    // The specific regression: these two stack rather than running off the
    // edge, and pressing the far one arrives where it says it does.
    for (const name of ['Cambiar solo este día', 'Cambiar todas las semanas']) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }

    await page.getByRole('button', { name: 'Cambiar todas las semanas' }).click();
    await page.waitForURL(/\/app\/availability$/);
  });
});
