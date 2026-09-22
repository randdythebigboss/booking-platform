import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { bookAsGuest, option, signIn, TEXT } from './support/app';
import { openDateISO } from './support/dates';
import { TENANT_A } from './support/fixtures';
import { expect, test } from './support/test';

/**
 * Automated accessibility checking, on the screens people actually use.
 *
 * This is not a WCAG certification and does not pretend to be one -- an
 * automated tool finds perhaps a third of real barriers. What it does find is
 * the third that is unambiguous and cheap to fix: a control with no accessible
 * name, ARIA that contradicts itself, text nobody can read against its
 * background. Those are exactly the defects that creep in unnoticed.
 *
 * Findings are fixed rather than suppressed. If something ever has to be
 * excluded, the reason belongs here in writing.
 */

const STANDARD = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(STANDARD).analyze();

  const readable = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    where: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
  }));

  expect(readable, JSON.stringify(readable, null, 2)).toEqual([]);
}

test.describe('the pages a customer sees', () => {
  test('the public booking page', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await expect(page.getByText(TEXT.es.chooseService)).toBeVisible();
    await audit(page);
  });

  test('the booking page with every step open', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await option(page, TENANT_A.services.free).click();
    await page.getByRole('textbox', { name: TEXT.es.date }).fill(openDateISO());
    await expect(page.getByRole('radio', { name: /\d{1,2}:\d{2}/ }).first()).toBeVisible();
    await audit(page);
  });

  test('the confirmation page', async ({ page }) => {
    await bookAsGuest(page);
    await audit(page);
  });

  test('the sign-in page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: TEXT.es.signIn })).toBeVisible();
    await audit(page);
  });
});

test.describe('the pages a professional sees', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
  });

  test('the dashboard', async ({ page }) => {
    await expect(page).toHaveURL(/dashboard/);
    await audit(page);
  });

  test('the appointment list', async ({ page }) => {
    await page.goto('/app/appointments');
    await expect(page.getByRole('link', { name: /\d{1,2}:\d{2}/ }).first()).toBeVisible();
    await audit(page);
  });

  test('the settings screen, where every input needs a name', async ({ page }) => {
    await page.goto('/app/settings');
    await expect(page.getByRole('textbox').first()).toBeVisible();
    await audit(page);
  });

  test('the services screen', async ({ page }) => {
    await page.goto('/app/services');
    await expect(page.getByText(TENANT_A.services.free).first()).toBeVisible();
    await audit(page);
  });
});
