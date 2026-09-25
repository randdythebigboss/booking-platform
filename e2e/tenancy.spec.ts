import { bookAsGuest, expectNoRawError, signIn } from './support/app';
import { query } from './support/db';
import { TENANT_A, TENANT_B } from './support/fixtures';
import { expect, test } from './support/test';

/**
 * Two businesses, and the wall between them.
 *
 * supabase/tests/tenant_isolation.sql already proves this at the database, and
 * that proof is the real one -- Row Level Security is what enforces it. What
 * this adds is the other half of the question: that the application actually
 * asks the database, rather than filtering in the client and calling it
 * security.
 */

test.describe('one business cannot see another', () => {
  test('sees only its own appointments', async ({ page, context }) => {
    // Give tenant A an appointment with an unmistakable name on it.
    const guest = await context.newPage();
    await bookAsGuest(guest, { guest: { name: 'Cliente De A', phone: '+1 809 555 0133' } });
    await guest.close();

    await signIn(page, TENANT_B.email, TENANT_B.password);
    await page.goto('/app/appointments');

    await expect(page.getByText(TENANT_B.appointment.customer).first()).toBeVisible();
    await expect(page.getByText('Cliente De A')).toHaveCount(0);
    await expect(page.getByText('Lucía Prueba')).toHaveCount(0);
  });

  test('cannot open the other business’s appointment by its id', async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);

    await page.goto(`/app/appointments/${TENANT_B.appointment.id}`);

    // It must say no. What it must not do is show the row.
    await expect(page.getByText(TENANT_B.appointment.customer)).toHaveCount(0);
    await expect(page.getByText(/no pertenece a este negocio|No encontramos/)).toBeVisible();
    await expectNoRawError(page);
  });

  test('cannot see the other business’s customers through its own screens', async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/appointments');

    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toContain(TENANT_B.appointment.customer);
    expect(body).not.toContain('marta@example.test');
  });

  test('keeps the two public pages separate', async ({ page }) => {
    await page.goto(`/p/${TENANT_B.slug}/book`);
    await expect(page.getByRole('radio', { name: TENANT_B.services.free })).toBeVisible();

    // Tenant A's services are not on tenant B's page.
    await expect(page.getByRole('radio', { name: TENANT_A.services.free })).toHaveCount(0);
  });

  test('books into the right calendar when two are open', async ({ page }) => {
    await bookAsGuest(page, {
      slug: TENANT_B.slug,
      service: TENANT_B.services.free,
      guest: { name: 'Cliente De B', phone: '+1 809 555 0144' },
    });

    const owner = query(
      `select b.slug from public.appointments a
         join public.businesses b on b.id = a.business_id
        where a.customer_name_snapshot = 'Cliente De B'`,
    );

    expect(owner).toBe(TENANT_B.slug);
  });
});
