import { bookAsGuest, expectNoRawError, option, signIn } from './support/app';
import { count, query } from './support/db';
import { openDateISO } from './support/dates';
import { TENANT_A, TENANT_B } from './support/fixtures';
import { expect, test } from './support/test';

/**
 * Phase 14: the week the customer sees, and the week the professional runs.
 *
 * The complaint that started this phase was that a customer had to tap a day
 * to find out whether it was worth tapping. Most of what follows is that, its
 * privacy consequences, and the calendar the professional got in exchange.
 */

test.describe('the customer sees the week before choosing a day', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await option(page, TENANT_A.services.free).click();
    // The strip only means anything once a service is chosen, because
    // availability depends on how long the service takes.
    await expect(page.getByText(/El número son las horas libres/)).toBeVisible();
  });

  test('says how many times each day has, before it is tapped @mobile', async ({ page }) => {
    // Every chip is named with its date and what it holds -- a number of free
    // times, or why there are none.
    const chips = page.getByRole('radio', { name: /—\s*(\d+ horas? libres?|Cerrado|Sin horas)/ });
    expect(await chips.count()).toBeGreaterThan(0);

    // At least one day the seeded professional works is genuinely offerable.
    const free = page.getByRole('radio', { name: /—\s*\d+ horas? libres?/ });
    expect(await free.count()).toBeGreaterThan(0);
    await expectNoRawError(page);
  });

  test('never offers a day the shop does not work', async ({ page }) => {
    // The seed is closed on Sunday. A closed chip exists and cannot be pressed.
    const closed = page.getByRole('radio', { name: /— Cerrado$/ });
    if ((await closed.count()) > 0) {
      await expect(closed.first()).toBeDisabled();
    }
  });

  test('never offers a day that has already gone', async ({ page }) => {
    // The strip starts at today in the business timezone, so stepping back is
    // refused rather than silently clamped into last week.
    await expect(page.getByRole('button', { name: 'Semana anterior' })).toBeDisabled();
  });

  test('the count says nothing about who holds the other times', async ({ page, context }) => {
    const guest = await context.newPage();
    await bookAsGuest(guest, {
      date: openDateISO(2),
      guest: { name: 'Semana Privada', phone: '+1 809 555 0991', email: 'semana@example.test' },
    });
    await guest.close();

    await page.reload();
    await option(page, TENANT_A.services.free).click();
    await expect(page.getByText(/El número son las horas libres/)).toBeVisible();

    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toContain('Semana Privada');
    expect(body).not.toContain('semana@example.test');
    expect(body).not.toContain('+1 809 555 0991');
    await expectNoRawError(page);
  });

  test('takes somebody straight to the soonest free time', async ({ page }) => {
    await page.getByRole('button', { name: 'Próxima hora libre' }).click();

    // It lands on a day AND picks the earliest time on it, which is the whole
    // point: one press instead of a search.
    await expect(page.getByText(/Te llevamos al/)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/Paso 4 de 5/)).toBeVisible();
    await expectNoRawError(page);
  });

  test('availability follows the service, not just the day', async ({ page }) => {
    const readCounts = async () => {
      const labels = await page.getByRole('radio', { name: /— \d+ horas? libres?/ }).all();
      const numbers: number[] = [];
      for (const chip of labels) {
        const name = (await chip.getAttribute('aria-label')) ?? '';
        const match = name.match(/(\d+) horas? libres?/);
        if (match) numbers.push(Number(match[1]));
      }
      return numbers.reduce((total, value) => total + value, 0);
    };

    const withShort = await readCounts();

    // A longer service fits fewer times into the same working day. It must
    // never be possible for the longer one to show more.
    await option(page, TENANT_A.services.deposit).click();
    await page.waitForTimeout(1500);
    const withLong = await readCounts();

    expect(withLong).toBeLessThanOrEqual(withShort);
  });
});

test.describe('the professional runs the week', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/calendar');
  });

  test('draws the week as a grid on a desk', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 900, 'the grid needs a desk');

    await expect(page.getByRole('radio', { name: 'Semana' })).toBeVisible();
    // The legend, because a band and a block are not self-explanatory.
    await expect(page.getByText('Horario de trabajo')).toBeVisible();
    await expect(page.getByText('Reservado')).toBeVisible();
    await expectNoRawError(page);
  });

  test('moves a week at a time, and back to today', async ({ page }) => {
    const heading = page.getByText(
      /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/,
    );
    await expect(heading.first()).toBeVisible();

    await page.getByRole('button', { name: 'Semana siguiente' }).click();
    await page.waitForTimeout(800);
    await expect(page.getByRole('button', { name: 'Hoy' })).toBeEnabled();

    await page.getByRole('button', { name: 'Hoy' }).click();
    await page.waitForTimeout(800);
    await expect(page.getByRole('button', { name: 'Hoy' })).toBeDisabled();
    await expectNoRawError(page);
  });

  test('keeps a usable day agenda on a phone @mobile', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) >= 900, 'the phone gets the day, not the grid');

    // No seven-column grid, and no view switch to reach one.
    await expect(page.getByRole('radio', { name: 'Semana' })).toHaveCount(0);
    // The day strip is still how you move about.
    await expect(page.getByRole('radiogroup', { name: 'Elige un día' })).toBeVisible();
    await expectNoRawError(page);
  });

  test('points at the screen that changes what the week looks like', async ({ page }) => {
    await expect(page.getByText(/Falta o sobra tiempo en tu semana/)).toBeVisible();
    await page.getByRole('button', { name: 'Horario', exact: true }).last().click();
    await page.waitForURL(/\/app\/availability/);
  });
});

test.describe('the schedule preview is the real thing', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/availability');
  });

  test('shows what a customer would be offered, on the screen that decides it', async ({
    page,
  }) => {
    await expect(page.getByText('Lo que ve un cliente')).toBeVisible();
    // The professional's own view tells a booked hour from a closed one; the
    // public page never does.
    await expect(page.getByText(/Se ofrecen? \d+ horas?/)).toBeVisible({ timeout: 20000 });
    await expectNoRawError(page);
  });

  /**
   * The one lie that would matter on this screen: showing a draft as though
   * customers could already book it.
   */
  test('says plainly that an unsaved change is not availability', async ({ page }) => {
    await expect(page.getByText(/Tus cambios sin guardar todavía no cuentan/)).toHaveCount(0);

    await page.getByRole('button', { name: /^Lunes\./ }).click();
    const from = page.getByRole('textbox', { name: 'Desde' }).first();
    await from.fill('1000');
    await from.blur();

    await expect(page.getByText('Tienes cambios sin guardar.')).toBeVisible();
    await expect(page.getByText(/Tus cambios sin guardar todavía no cuentan/)).toBeVisible();

    await page.getByRole('button', { name: 'Descartar' }).click();
    await expect(page.getByText(/Tus cambios sin guardar todavía no cuentan/)).toHaveCount(0);
  });
});

test.describe('registration on the demonstration', () => {
  test('refuses an address that could belong to somebody @mobile', async ({ page }) => {
    await page.goto('/account/login');
    await page.getByRole('button', { name: /¿No tienes cuenta\? Créala/ }).click();

    await page.getByRole('textbox', { name: 'Nombre completo' }).fill('Alguien Real');
    await page.getByRole('textbox', { name: /Correo/ }).fill('owner@a-real-salon.com');
    await page.getByRole('textbox', { name: /Contraseña/ }).fill('una-clave-larga-123');
    await page.getByRole('button', { name: 'Crear cuenta' }).click();

    await expect(page.getByText(/solo acepta direcciones de prueba/)).toBeVisible();
    // And nothing was created.
    expect(count('auth.users', "email = 'owner@a-real-salon.com'")).toBe(0);
  });

  test('guest booking still needs no account at all @mobile', async ({ page }) => {
    const url = await bookAsGuest(page, {
      guest: { name: 'Sin Cuenta', phone: '+1 809 555 0992' },
    });
    expect(url).toContain('/confirmation');
    expect(query("select count(*) from public.customers where full_name = 'Sin Cuenta'")).toBe('1');
  });
});

test.describe('one business never sees another', () => {
  test('the week endpoint answers only for the professional asked about', async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/calendar');

    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toContain(TENANT_B.name);
    await expectNoRawError(page);
  });
});
