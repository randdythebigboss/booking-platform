import { bookAsGuest, expectNoRawError, signIn } from './support/app';
import { query } from './support/db';
import { TENANT_A } from './support/fixtures';
import { expect, test } from './support/test';

/**
 * The other half of the product: somebody signs in and runs their day.
 *
 * Deliberately a smoke path rather than an exhaustive one. The domain rules
 * about who may move what are proved in supabase/tests; what a browser adds is
 * that the screens reach them at all.
 */

test.describe('a professional runs their day', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
  });

  test('lands on a dashboard that knows whose it is @mobile', async ({ page }) => {
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByText(TENANT_A.name).first()).toBeVisible();
    await expect(page.getByText(/Tu enlace de reservas/)).toBeVisible();
    await expectNoRawError(page);
  });

  test('lists appointments and opens one', async ({ page }) => {
    await page.goto('/app/appointments');
    await expect(page.getByText('Citas').first()).toBeVisible();

    // The seed leaves exactly one appointment behind, so there is always
    // something here to open.
    const appointment = page.getByRole('link', { name: /\d{1,2}:\d{2}/ }).first();
    await expect(appointment).toBeVisible();
    await appointment.click();

    await expect(page).toHaveURL(/\/app\/appointments\/[0-9a-f-]+/);
    await expectNoRawError(page);
  });

  test('changes an appointment status, and the database agrees', async ({ page }) => {
    await page.goto('/app/appointments');
    await page
      .getByRole('link', { name: /\d{1,2}:\d{2}/ })
      .first()
      .click();
    await page.waitForURL(/\/app\/appointments\/[0-9a-f-]+/);

    const id = page.url().split('/appointments/')[1]?.split(/[?#]/)[0] ?? '';
    const before = query(`select status from public.appointments where id = '${id}'`);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

    await expect
      .poll(() => query(`select status from public.appointments where id = '${id}'`))
      .toBe('cancelled');
    expect(before).not.toBe('cancelled');

    await expectNoRawError(page);
  });

  test('sees a booking that a guest just made', async ({ page, context }) => {
    const guestPage = await context.newPage();
    await bookAsGuest(guestPage);
    await guestPage.close();

    await page.goto('/app/appointments');
    await expect(page.getByText('Lucía Prueba').first()).toBeVisible();
  });

  test('opens its services and its availability', async ({ page }) => {
    await page.goto('/app/services');
    await expect(page.getByText(TENANT_A.services.free).first()).toBeVisible();
    await expectNoRawError(page);

    await page.goto('/app/availability');
    // The week is seven collapsed summaries; the boxes belong to the day you
    // open. Monday is the one the seed gives hours to.
    await expect(page.getByRole('button', { name: /^Lunes\./ })).toContainText('09:00');
    await page.getByRole('button', { name: /^Lunes\./ }).click();
    await expect(page.getByRole('textbox', { name: 'Desde' }).first()).toHaveValue('09:00');
    await expectNoRawError(page);
  });

  test('has a diagnostics screen that names the release and hides everything else', async ({
    page,
  }) => {
    await page.goto('/app/diagnostics');

    const body = (await page.textContent('body')) ?? '';

    // The version is the reason the screen exists during a beta.
    expect(body).toContain('0.1.0-beta.1');
    expect(body).toContain('local');

    // And these are the reasons it is a curated list rather than a dump.
    expect(body).not.toContain('eyJ');
    expect(body).not.toContain('Lucía');
    expect(body).not.toMatch(/\+1 809 555/);
  });
});

test.describe('the workspace is closed to strangers', () => {
  test('sends a signed-out visitor to the sign-in page @mobile', async ({ page }) => {
    await page.goto('/app/calendar');

    await page.waitForURL(/\/login/);
    await expect(page.getByRole('button', { name: /Iniciar sesión|Sign in/ })).toBeVisible();
    await expectNoRawError(page);
  });

  test('does the same for a deep link to one appointment', async ({ page }) => {
    await page.goto('/app/appointments/bbbbbbbb-6666-4666-8666-000000000001');

    await page.waitForURL(/\/login/);
    await expectNoRawError(page);
  });
});
