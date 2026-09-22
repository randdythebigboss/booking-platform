import { expectNoRawError, firstSlot, option, TEXT, switchLanguage } from './support/app';
import { count, query, setPaymentSimulation } from './support/db';
import { openDateISO } from './support/dates';
import { GUEST, TENANT_A } from './support/fixtures';
import { expect, test } from './support/test';

/**
 * Money, with nothing real behind it.
 *
 * Two opposite things have to be true at once, and each is a way the product
 * could embarrass somebody:
 *
 *   With no payment provider, a service that asks to be paid must not be
 *   bookable at all. The failure to avoid is a customer choosing a service,
 *   filling in their details, pressing a button called "Pay now" and meeting
 *   nothing.
 *
 *   With the demo provider, the page must say -- unmistakably, in the
 *   language being read -- that no real charge happens. The failure to avoid
 *   is somebody believing they have paid.
 */

const PAID_SERVICES = [TENANT_A.services.deposit, TENANT_A.services.full];

test.describe('with no payment provider at all', () => {
  // The shipping default, and the state the reset leaves behind.

  test('offers the free service and refuses the paid ones @mobile', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);

    await expect(option(page, TENANT_A.services.free)).toBeEnabled();

    for (const service of PAID_SERVICES) {
      const choice = option(page, new RegExp(service));
      await expect(choice, `${service} must not be bookable`).toBeDisabled();
      await expect(choice).toHaveAccessibleName(new RegExp('No se puede reservar en línea'));
    }
  });

  /**
   * The invariant, stated as a test: no route through the product reaches a
   * payment control when nothing can take a payment.
   */
  test('has no path to a pay button anywhere in the booking flow', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await option(page, TENANT_A.services.free).click();
    await page.getByRole('textbox', { name: TEXT.es.date }).fill(openDateISO());
    await firstSlot(page).click();
    await page.getByRole('textbox', { name: TEXT.es.fullName }).fill(GUEST.name);
    await page.getByRole('textbox', { name: TEXT.es.phone }).fill(GUEST.phone);
    await page.getByRole('button', { name: TEXT.es.confirm }).click();

    await expect(page.getByText(TEXT.es.booked)).toBeVisible();

    await expect(page.getByRole('button', { name: /Pagar/ })).toHaveCount(0);
    await expect(page.getByText(TEXT.es.demoPayment)).toHaveCount(0);

    // And nothing was invented behind the scenes either.
    expect(count('public.payments', 'true')).toBe(0);
  });

  test('explains why, rather than failing silently', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);

    await expect(page.getByText(/Este servicio pide un pago por adelantado/)).toBeVisible();
    await expectNoRawError(page);
  });
});

test.describe('with the demo provider switched on', () => {
  test.beforeEach(() => setPaymentSimulation(true));

  // Whatever a test in here does, the environment goes back to the default.
  // A shared database left in simulation mode is how a demo becomes a lie.
  test.afterEach(() => setPaymentSimulation(false));

  async function reachCheckout(page: Parameters<typeof firstSlot>[0], service: string) {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await option(page, service).click();
    await page.getByRole('textbox', { name: TEXT.es.date }).fill(openDateISO());
    await firstSlot(page).click();
    await page.getByRole('textbox', { name: TEXT.es.fullName }).fill(GUEST.name);
    await page.getByRole('textbox', { name: TEXT.es.phone }).fill(GUEST.phone);
    await page.getByRole('button', { name: TEXT.es.confirm }).click();
  }

  test('says in Spanish that the payment is a demonstration', async ({ page }) => {
    await reachCheckout(page, TENANT_A.services.deposit);

    await expect(page.getByText(TEXT.es.demoPayment)).toBeVisible();
    await expect(page.getByText(new RegExp(TEXT.es.noRealCharge))).toBeVisible();

    // Wording that would be a lie, checked for by hand because it is the whole
    // point of the section.
    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toContain('Se cobró');
    expect(body).not.toContain('tarjeta fue cobrada');
  });

  test('says the same thing in English', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await switchLanguage(page, 'en');
    await option(page, TENANT_A.services.deposit).click();
    await page.getByRole('textbox', { name: TEXT.en.date }).fill(openDateISO());
    await firstSlot(page).click();
    await page.getByRole('textbox', { name: TEXT.en.fullName }).fill(GUEST.name);
    await page.getByRole('textbox', { name: TEXT.en.phone }).fill(GUEST.phone);
    await page.getByRole('button', { name: TEXT.en.confirm }).click();

    await expect(page.getByText(TEXT.en.demoPayment)).toBeVisible();
    await expect(page.getByText(new RegExp(TEXT.en.noRealCharge, 'i'))).toBeVisible();

    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toContain('was charged');
    expect(body).not.toContain('Your card');
  });

  test('takes a deposit and leaves the rest owing at the shop', async ({ page }) => {
    await reachCheckout(page, TENANT_A.services.deposit);

    await page.getByRole('button', { name: /Pagar depósito/ }).click();
    await expect(page.getByText(/Pago de demostración completado/)).toBeVisible();
    await expectNoRawError(page);

    // The deposit is the deposit, and the arithmetic came from the database.
    expect(query("select amount::numeric(12,2)::text from public.payments limit 1")).toBe('1000.00');
    expect(query('select status from public.payments limit 1')).toBe('paid');
  });

  test('takes a full payment for a service that asks for one', async ({ page }) => {
    await reachCheckout(page, TENANT_A.services.full);

    await page.getByRole('button', { name: /^Pagar / }).click();
    await expect(page.getByText(/Pago de demostración completado/)).toBeVisible();

    expect(query("select amount::numeric(12,2)::text from public.payments limit 1")).toBe('3500.00');
    expect(query('select status from public.payments limit 1')).toBe('paid');
  });

  test('records one payment however many times the button is pressed', async ({ page }) => {
    await reachCheckout(page, TENANT_A.services.deposit);

    const pay = page.getByRole('button', { name: /Pagar depósito/ });
    await pay.click({ clickCount: 3, delay: 40 });

    await expect(page.getByText(/Pago de demostración completado/)).toBeVisible();

    expect(count('public.payments', "status = 'paid'")).toBe(1);
  });
});
