import { bookAsGuest, chooseDay, expectNoRawError, firstSlot, option, TEXT } from './support/app';
import { count, query } from './support/db';
import { openDateISO } from './support/dates';
import { GUEST, TENANT_A } from './support/fixtures';
import { expect, test } from './support/test';

/**
 * The journey the whole product exists for: a stranger with a link ends up
 * with an appointment, can move it, and can call it off.
 */

test.describe('a guest books, moves and cancels', () => {
  test('books an appointment in Spanish and lands on a confirmation @mobile', async ({ page }) => {
    const before = count('public.appointments', 'true');

    const url = await bookAsGuest(page);

    // The credential rides in the fragment, which is the only part of a URL a
    // server never sees. ADR 0019.
    expect(url).toContain('#token=');
    expect(url).not.toContain('?token=');

    await expect(page.getByText(GUEST.name)).toBeVisible();
    await expect(page.getByText(TENANT_A.services.free)).toBeVisible();
    await expectNoRawError(page);

    expect(count('public.appointments', 'true')).toBe(before + 1);
  });

  test('survives a reload, because the credential is in the link', async ({ page }) => {
    await bookAsGuest(page);

    await page.reload();

    await expect(page.getByText(TEXT.es.booked)).toBeVisible();
    await expect(page.getByText(GUEST.name)).toBeVisible();
  });

  test('moves the appointment to another time', async ({ page }) => {
    const url = await bookAsGuest(page);
    const appointmentId = url.split('/booking/')[1]?.split('/')[0] ?? '';
    const originalStart = query(
      `select starts_at from public.appointments where id = '${appointmentId}'`,
    );

    await page.getByRole('button', { name: TEXT.es.reschedule }).click();
    await chooseDay(page, openDateISO(8));

    const slot = firstSlot(page);
    await expect(slot).toBeVisible();
    await slot.click();
    await page.getByRole('button', { name: TEXT.es.move }).click();

    await expect(page.getByText(TEXT.es.booked)).toBeVisible();
    await expectNoRawError(page);

    const movedStart = query(
      `select starts_at from public.appointments where id = '${appointmentId}'`,
    );
    expect(movedStart).not.toBe(originalStart);

    // Moving is a move, not a second booking.
    expect(query(`select status from public.appointments where id = '${appointmentId}'`)).toBe(
      'confirmed',
    );
  });

  test('cancels the appointment and reaches a terminal state', async ({ page }) => {
    const url = await bookAsGuest(page);
    const appointmentId = url.split('/booking/')[1]?.split('/')[0] ?? '';

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: TEXT.es.cancel }).click();

    await expect(page.getByText(TEXT.es.cancelled)).toBeVisible();
    await expectNoRawError(page);

    expect(query(`select status from public.appointments where id = '${appointmentId}'`)).toBe(
      'cancelled',
    );

    // A cancelled appointment offers nothing further to do with it.
    await expect(page.getByRole('button', { name: TEXT.es.cancel })).toHaveCount(0);
  });

  test('books in English without changing what the database stores', async ({ page }) => {
    await bookAsGuest(page, {
      language: 'en',
      guest: { name: 'Nora Test', phone: '+1 809 555 0122', email: 'nora@example.test' },
    });

    await expect(page.getByText(TEXT.en.booked)).toBeVisible();

    // The language the booking was made in is recorded with it, because every
    // later message about it is written in that language and not in whichever
    // one somebody happens to be reading in.
    expect(
      query('select customer_locale from public.appointments order by created_at desc limit 1'),
    ).toBe('en');
  });

  test('switching language changes the page, not the appointment', async ({ page }) => {
    const url = await bookAsGuest(page);
    const appointmentId = url.split('/booking/')[1]?.split('/')[0] ?? '';
    const before = query(
      `select starts_at || '|' || status || '|' || customer_name_snapshot
         from public.appointments where id = '${appointmentId}'`,
    );

    await page.getByRole('radio', { name: 'English', exact: true }).click();
    await expect(page.getByText(TEXT.en.booked)).toBeVisible();

    await page.getByRole('radio', { name: 'Español', exact: true }).click();
    await expect(page.getByText(TEXT.es.booked)).toBeVisible();

    const after = query(
      `select starts_at || '|' || status || '|' || customer_name_snapshot
         from public.appointments where id = '${appointmentId}'`,
    );
    expect(after).toBe(before);
  });
});

test.describe('the public page', () => {
  test('shows an unknown business as not found, not as an error @mobile', async ({ page }) => {
    await page.goto('/p/no-such-business');

    await expect(page.getByText(TEXT.es.notFound)).toBeVisible();
    await expectNoRawError(page);
  });

  test('offers the seeded services on the booking page', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);

    await expect(option(page, TENANT_A.services.free)).toBeVisible();
    await expect(page.getByText(TENANT_A.name, { exact: true }).first()).toBeVisible();
  });
});
