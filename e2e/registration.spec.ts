import type { Page } from '@playwright/test';

import { expectNoRawError } from './support/app';
import { expect, test } from './support/test';

/**
 * What the account screens do when the Auth server is not creating accounts.
 *
 * The frontend's reserved-domain rule is guidance; the project's
 * `disable_signup` setting is the boundary. The screens read that setting from
 * `GET /auth/v1/settings` and stop offering something the server will refuse.
 *
 * The local stack's auth shim answers that endpoint like GoTrue does, so the
 * only way to see the closed state here is to answer for it. That is honest
 * for this test: what is under test is the screen's reaction to a given
 * answer, and `tests/auth/capabilities.test.ts` covers the reading of it.
 */

const SETTINGS = '**/auth/v1/settings*';

const ES = {
  professionalToggle: '¿Aún no tienes cuenta? Créala',
  customerToggle: '¿No tienes cuenta? Créala',
  closed: /no está creando cuentas nuevas/,
  signIn: 'Iniciar sesión',
};

async function answerSettings(page: Page, disabled: boolean) {
  await page.route(SETTINGS, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ disable_signup: disabled, external: {} }),
    }),
  );
}

test.describe('when the server is not creating accounts', () => {
  test('the professional screen says so instead of offering a form @mobile', async ({ page }) => {
    await answerSettings(page, true);
    await page.goto('/login');

    await expect(page.getByText(ES.closed)).toBeVisible();
    await expect(page.getByRole('button', { name: ES.professionalToggle })).toHaveCount(0);

    // Signing in is untouched -- this closes a door, it does not lock the ones
    // that already work.
    await expect(page.getByRole('button', { name: ES.signIn })).toBeVisible();
    await expectNoRawError(page);
  });

  test('the customer screen says so, and booking without an account still works', async ({
    page,
  }) => {
    await answerSettings(page, true);
    await page.goto('/account/login');

    await expect(page.getByText(ES.closed)).toBeVisible();
    await expect(page.getByRole('button', { name: ES.customerToggle })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Seguir sin cuenta/ })).toBeVisible();
    await expectNoRawError(page);
  });
});

test.describe('when the server is creating accounts', () => {
  test('both screens still offer it', async ({ page }) => {
    await answerSettings(page, false);

    await page.goto('/login');
    await expect(page.getByRole('button', { name: ES.professionalToggle })).toBeVisible();

    await page.goto('/account/login');
    await expect(page.getByRole('button', { name: ES.customerToggle })).toBeVisible();
  });
});
