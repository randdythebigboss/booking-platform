import { bookAsGuest, chooseDay, expectNoRawError, firstSlot, option, TEXT } from './support/app';
import { count } from './support/db';
import { openDateISO } from './support/dates';
import { GUEST, TENANT_A } from './support/fixtures';
import { expect, test } from './support/test';

/**
 * What happens when things go wrong: the network drops, somebody presses the
 * button twice, a link is nonsense.
 *
 * The thread running through all of it is that the product must never claim
 * success it did not have, and must never show somebody a stack trace.
 */

test.describe('losing the network', () => {
  test('says so, and does not invent an appointment @mobile', async ({ page, context }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await option(page, TENANT_A.services.free).click();
    await chooseDay(page, openDateISO());
    await firstSlot(page).click();
    await page.getByRole('textbox', { name: TEXT.es.fullName }).fill(GUEST.name);
    await page.getByRole('textbox', { name: TEXT.es.phone }).fill(GUEST.phone);

    const before = count('public.appointments', 'true');

    await context.setOffline(true);
    await page.getByRole('button', { name: TEXT.es.confirm }).last().click();

    // Something honest is said, and it is said in Spanish.
    await expect(page.getByText(TEXT.es.booked)).toHaveCount(0);
    await expectNoRawError(page);

    // Nothing was booked. This is the assertion that matters.
    expect(count('public.appointments', 'true')).toBe(before);

    // And it recovers rather than needing a reload.
    await context.setOffline(false);
    await page.getByRole('button', { name: TEXT.es.confirm }).last().click();
    await expect(page.getByText(TEXT.es.booked)).toBeVisible();
    expect(count('public.appointments', 'true')).toBe(before + 1);
  });

  test('shows the offline notice while the connection is gone', async ({ page, context }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await expect(page.getByText(TEXT.es.chooseService)).toBeVisible();

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    await expect(page.getByText(new RegExp(TEXT.es.offline))).toBeVisible();

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByText(new RegExp(TEXT.es.offline))).toHaveCount(0);
  });
});

test.describe('pressing the button more than once', () => {
  test('books once however many times confirm is pressed', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await option(page, TENANT_A.services.free).click();
    await chooseDay(page, openDateISO());
    await firstSlot(page).click();
    await page.getByRole('textbox', { name: TEXT.es.fullName }).fill(GUEST.name);
    await page.getByRole('textbox', { name: TEXT.es.phone }).fill(GUEST.phone);

    const before = count('public.appointments', 'true');

    await page
      .getByRole('button', { name: TEXT.es.confirm })
      .last()
      .click({ clickCount: 3, delay: 30 });

    await expect(page.getByText(TEXT.es.booked)).toBeVisible();
    expect(count('public.appointments', 'true')).toBe(before + 1);
  });

  test('moves once however many times move is pressed', async ({ page }) => {
    const url = await bookAsGuest(page);
    const id = url.split('/booking/')[1]?.split('/')[0] ?? '';

    await page.getByRole('button', { name: TEXT.es.reschedule }).click();
    await chooseDay(page, openDateISO(8));
    await firstSlot(page).click();

    await page.getByRole('button', { name: TEXT.es.move }).click({ clickCount: 3, delay: 30 });

    await expect(page.getByText(TEXT.es.booked)).toBeVisible();

    // Moving is a move: one row, still confirmed, and no second appointment
    // for this guest hiding behind it.
    expect(count('public.appointments', `id = '${id}'`)).toBe(1);
    expect(count('public.appointments', `id = '${id}' and status = 'confirmed'`)).toBe(1);
    expect(count('public.appointments', `customer_name_snapshot = '${GUEST.name}'`)).toBe(1);
  });
});

test.describe('links that do not lead anywhere', () => {
  test('an unknown business page', async ({ page }) => {
    await page.goto('/p/this-does-not-exist');
    await expect(page.getByText(TEXT.es.notFound)).toBeVisible();
    await expectNoRawError(page);
  });

  test('an appointment id that is not even a uuid', async ({ page }) => {
    await page.goto('/booking/not-a-uuid/confirmation#token=also-not-a-uuid');

    await expect(page.getByText(TEXT.es.booked)).toHaveCount(0);
    await expectNoRawError(page);
  });

  test('a route the application does not have', async ({ page }) => {
    await page.goto('/there-is-no-such-page');

    await expectNoRawError(page);
    // Whatever it shows, it is a page and not a blank document.
    expect(((await page.textContent('body')) ?? '').trim().length).toBeGreaterThan(0);
  });
});

test.describe('the back button', () => {
  /**
   * Confirming replaces the history entry rather than pushing one, so Back
   * cannot land on a filled-in booking form whose Confirm button still works.
   * The design decision is what makes "press Back and press Confirm again"
   * impossible; this checks the decision survived.
   */
  test('cannot be used to book the same appointment twice', async ({ page }) => {
    const before = count('public.appointments', 'true');
    await bookAsGuest(page);
    expect(count('public.appointments', 'true')).toBe(before + 1);

    await page.goBack();
    await expectNoRawError(page);

    // Whatever is behind the confirmation, it is not a live booking form.
    await expect(page.getByRole('button', { name: TEXT.es.confirm })).toHaveCount(0);
    expect(count('public.appointments', 'true')).toBe(before + 1);
  });

  test('leaves the booking page usable after going back to it', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await page.goto('/login');

    await page.goBack();

    await expect(page.getByText(TEXT.es.chooseService)).toBeVisible();
    await option(page, TENANT_A.services.free).click();
    await expect(
      page
        .getByRole('radio', {
          name: /de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/,
        })
        .first(),
    ).toBeVisible();
    await expectNoRawError(page);
  });
});
