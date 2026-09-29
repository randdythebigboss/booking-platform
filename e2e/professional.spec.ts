import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { bookAsGuest, expectNoRawError, signIn } from './support/app';
import { query } from './support/db';
import { TENANT_A } from './support/fixtures';
import { expect, test } from './support/test';

/** Read from the manifest, so a version bump never needs this file edited. */
const RELEASE = JSON.parse(readFileSync('package.json', 'utf8')).version as string;

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
    expect(body).toContain(RELEASE);
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

/**
 * A half-finished week.
 *
 * The weekly hours screen holds a draft: typing in a box changes nothing until
 * the week is saved. Three things have to stay true about that draft, and none
 * of them is obvious enough to survive a refactor unwatched.
 *
 * The first is that a time box commits when focus leaves it, not on every
 * keystroke -- otherwise the caret jumps and `09:30` cannot be typed. The
 * consequence is that clicking Save *is* the blur, so the value has to be in
 * the week by the time the press is handled. A professional who types an hour
 * and reaches straight for Save must not have to click it twice.
 *
 * The second is that the draft is announced. An unsaved week that looks saved
 * is how somebody opens on Monday at an hour they thought they had changed.
 *
 * The third is that walking off the screen does not throw the draft away.
 * Checking a service before saving the week is an ordinary thing to do.
 */
test.describe('the weekly hours draft', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/availability');
    await page.getByRole('button', { name: /^Lunes\./ }).click();
  });

  const from = (page: Page) => page.getByRole('textbox', { name: 'Desde' }).first();

  test('says so, keeps the draft across a detour, and can throw it away', async ({ page }) => {
    await expect(page.getByText('Tienes cambios sin guardar.')).toBeHidden();

    await from(page).fill('07:30');
    await from(page).blur();

    // Announced, and counted: the total is the draft's, not the saved week's.
    await expect(page.getByText('Tienes cambios sin guardar.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Lunes\./ })).toContainText('07:30');

    // The preview is explicit that a customer is not being offered this yet.
    await expect(page.getByText(/todavía no cuentan/)).toBeVisible();

    // A detour, and back. The draft is still here.
    await page.getByRole('link', { name: 'Servicios' }).click();
    await page.waitForURL(/\/app\/services/);
    await page.goBack();
    await page.waitForURL(/\/app\/availability/);

    await expect(page.getByText('Tienes cambios sin guardar.')).toBeVisible();
    await expect(from(page)).toHaveValue('07:30');

    // Discard puts back what was saved, and the announcement goes with it.
    await page.getByRole('button', { name: 'Descartar' }).click();
    await expect(page.getByText('Tienes cambios sin guardar.')).toBeHidden();
    await expect(page.getByRole('button', { name: /^Lunes\./ })).toContainText('09:00');
    await expectNoRawError(page);
  });

  test('saves on the first click, although that click is also the blur', async ({ page }) => {
    await from(page).fill('07:30');

    // Pressed with the mouse rather than with `click()`, and the difference
    // matters. Playwright refuses to dispatch to a control it considers
    // disabled, and Save *is* disabled until the field commits -- which is
    // what the press itself does, so asking first deadlocks. A real pointer
    // asks nobody: mousedown blurs the box, the week takes the value, Save
    // turns live, and the click lands on a button that by then accepts it.
    // Driving the mouse is the faithful reproduction, and this behaviour was
    // also confirmed by hand in a browser.
    const save = page.getByRole('button', { name: 'Guardar la semana' });
    const box = await save.boundingBox();
    if (!box) throw new Error('Save the week is not on screen');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.getByText('Horario guardado.')).toBeVisible();
    await expect(page.getByText('Tienes cambios sin guardar.')).toBeHidden();

    // Put the seed back, so the rest of the suite sees the week it expects.
    await from(page).fill('09:00');
    await from(page).blur();
    await page.getByRole('button', { name: 'Guardar la semana' }).click();
    await expect(page.getByRole('button', { name: /^Lunes\./ })).toContainText('09:00');
    await expectNoRawError(page);
  });
});
