import { bookAsGuest, expectNoRawError, TEXT } from './support/app';
import { query } from './support/db';
import { TENANT_B } from './support/fixtures';
import { expect, test } from './support/test';

/**
 * The guest credential: an unguessable token that lets somebody manage one
 * appointment without an account (ADR 0019).
 *
 * The rule the whole design rests on is that it travels in the URL *fragment*,
 * which browsers do not put in a request. A server log, a proxy, a referrer
 * header and an access log all see the path and never the token. A regression
 * here would not look like a failure -- everything would keep working, while
 * quietly writing customers' credentials into somebody's logs.
 *
 * Nothing in this file prints a token.
 */

test.describe('the credential in the link', () => {
  test('never reaches the server', async ({ page }) => {
    const paths: string[] = [];
    page.on('request', (request) => paths.push(request.url()));

    const url = await bookAsGuest(page);
    const token = url.split('#token=')[1] ?? '';
    expect(token.length).toBeGreaterThan(20);

    await page.reload();

    // Every request the browser made, including the document request for the
    // page the token is on.
    for (const requested of paths) {
      expect(requested.includes(token), 'a request carried the guest credential').toBe(false);
    }
  });

  test('is not in the document request after a reload either', async ({ page }) => {
    const url = await bookAsGuest(page);
    const token = url.split('#token=')[1] ?? '';

    const documentRequest = page.waitForRequest((request) => request.resourceType() === 'document');
    await page.reload();
    const request = await documentRequest;

    expect(request.url()).not.toContain(token);
    expect(request.url()).toContain('/booking/');
  });

  test('refuses a token that belongs to a different appointment', async ({ page }) => {
    const url = await bookAsGuest(page);
    const id = url.split('/booking/')[1]?.split('/')[0] ?? '';

    // Tenant B's real token, pointed at tenant A's appointment.
    await page.goto(`/booking/${id}/confirmation#token=${TENANT_B.appointment.token}`);

    await expect(page.getByText(/No encontramos esa reserva|no pudimos cargar/i)).toBeVisible();
    await expect(page.getByText(TEXT.es.booked)).toHaveCount(0);
    await expectNoRawError(page);
  });

  test('refuses a token that is simply wrong', async ({ page }) => {
    const url = await bookAsGuest(page);
    const id = url.split('/booking/')[1]?.split('/')[0] ?? '';

    await page.goto(`/booking/${id}/confirmation#token=00000000-0000-4000-8000-000000000000`);

    await expect(page.getByText(TEXT.es.booked)).toHaveCount(0);
    await expectNoRawError(page);
  });

  test('asks for the link when there is no token at all', async ({ page }) => {
    const url = await bookAsGuest(page);
    const id = url.split('/booking/')[1]?.split('/')[0] ?? '';

    await page.goto(`/booking/${id}/confirmation`);

    await expect(page.getByText(TEXT.es.needTheLink)).toBeVisible();
    await expectNoRawError(page);
  });

  /**
   * Older links put the token in the query string, where a server does see it.
   * They still have to work -- somebody may have one in an email -- but the
   * URL must be cleaned before anything else happens.
   */
  test('moves a legacy ?token= link into the fragment', async ({ page }) => {
    const url = await bookAsGuest(page);
    const id = url.split('/booking/')[1]?.split('/')[0] ?? '';
    const token = query(`select access_token from public.appointments where id = '${id}'`);

    await page.goto(`/booking/${id}/confirmation?token=${token}`);

    await expect(page.getByText(TEXT.es.booked)).toBeVisible();

    const current = page.url();
    expect(current).toContain('#token=');
    expect(current).not.toContain('?token=');
  });

  test('lets the holder of the link cancel, and nobody else', async ({ page }) => {
    const url = await bookAsGuest(page);
    const id = url.split('/booking/')[1]?.split('/')[0] ?? '';

    // Without the token there is nothing to press.
    await page.goto(`/booking/${id}/confirmation`);
    await expect(page.getByRole('button', { name: TEXT.es.cancel })).toHaveCount(0);

    // With it, there is.
    await page.goto(url);
    await expect(page.getByRole('button', { name: TEXT.es.cancel })).toBeVisible();
  });
});
