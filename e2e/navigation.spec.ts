import { chooseDay, expectNoRawError, option, signIn } from './support/app';
import { openDateISO } from './support/dates';
import { TENANT_A } from './support/fixtures';
import { expect, test } from './support/test';

/**
 * Phase 13: the frame around the product, and the controls inside it.
 *
 * Everything here was found by using the thing rather than by reading it. The
 * workspace had no navigation at all -- a stack of grey buttons on the
 * dashboard and the browser's own Back arrow -- the filters lost themselves on
 * every visit, and the weekly editor had no idea what a closed day was. These
 * are the tests that stop each of those coming back.
 */

test.describe('the workspace has a frame', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
  });

  test('marks where you are, on a desk', async ({ page }) => {
    await page.goto('/app/calendar');

    const nav = page.getByRole('navigation').first();
    await expect(nav).toBeVisible();

    // Every primary destination, reachable without going through a menu.
    for (const name of ['Inicio', 'Agenda', 'Citas', 'Servicios']) {
      await expect(nav.getByRole('link', { name })).toBeVisible();
    }

    // And the current one says so, rather than only looking different.
    await expect(nav.getByRole('link', { name: 'Agenda' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('puts four destinations and a way to the rest under a thumb @mobile', async ({
    page,
    viewport,
  }) => {
    // The tab bar is the phone's answer; a desk gets the sidebar instead.
    test.skip((viewport?.width ?? 0) >= 900, 'the tab bar only exists on a phone');
    await page.goto('/app/dashboard');

    const nav = page.getByRole('navigation').first();
    for (const name of ['Inicio', 'Agenda', 'Citas', 'Servicios', 'Más']) {
      await expect(nav.getByRole('link', { name })).toBeVisible();
    }

    await nav.getByRole('link', { name: 'Más' }).click();
    await page.waitForURL(/\/app\/more/);

    // The overflow is where the rest live, and they are reachable from it.
    await page.getByRole('link', { name: 'Horario', exact: true }).click();
    await page.waitForURL(/\/app\/availability/);
    await expectNoRawError(page);
  });

  test('carries the language control on every screen it frames @mobile', async ({ page }) => {
    for (const route of ['/app/dashboard', '/app/appointments', '/app/settings']) {
      await page.goto(route);
      await expect(page.getByRole('radio', { name: 'English', exact: true })).toBeVisible();
    }
  });
});

test.describe('the appointment filters', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
  });

  /**
   * They used to live in component state, so opening an appointment and
   * pressing Back gave you the default list rather than the one you left.
   */
  test('live in the address, so Back returns the list you left', async ({ page }) => {
    await page.goto('/app/appointments');

    await page.getByRole('radio', { name: 'Pasadas' }).click();
    await expect(page).toHaveURL(/scope=past/);

    await page.getByRole('button', { name: /^Estado:/ }).click();
    await page.getByRole('radio', { name: 'Confirmada' }).click();
    await expect(page).toHaveURL(/status=confirmed/);

    // A reload is the cheapest proof that the state is in the URL and not in
    // a component that happens not to have unmounted yet.
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Pasadas' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('button', { name: /^Estado: Confirmada/ })).toBeVisible();
    await expectNoRawError(page);
  });

  test('says so when a filter finds nothing, and offers a way out', async ({ page }) => {
    await page.goto('/app/appointments?scope=past&status=no_show');

    await expect(page.getByText('Nada por aquí. Prueba con otro filtro.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Próximas' }).first()).toBeVisible();
  });
});

test.describe('the weekly hours editor', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/availability');
  });

  test('is seven days you can read at a glance', async ({ page }) => {
    for (const day of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']) {
      await expect(page.getByRole('switch', { name: day })).toBeVisible();
    }

    // The seed works Monday to Friday and is closed at the weekend.
    await expect(page.getByRole('switch', { name: 'Lunes' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('switch', { name: 'Domingo' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(page.getByRole('button', { name: /^Domingo\./ })).toContainText('Cerrado');
  });

  test('reads a loose time the way a till does, and says what is unsaved', async ({ page }) => {
    const save = page.getByRole('button', { name: 'Guardar la semana' });
    await expect(save).toBeDisabled();

    await page.getByRole('button', { name: /^Lunes\./ }).click();
    const from = page.getByRole('textbox', { name: 'Desde' }).first();

    await from.fill('930');
    await from.blur();
    await expect(from).toHaveValue('09:30');

    await expect(page.getByText('Tienes cambios sin guardar.')).toBeVisible();
    await expect(save).toBeEnabled();

    await page.getByRole('button', { name: 'Descartar' }).click();
    await expect(from).toHaveValue('09:00');
    await expect(save).toBeDisabled();
  });

  test('refuses two periods that overlap, against the one that causes it', async ({ page }) => {
    await page.getByRole('button', { name: /^Lunes\./ }).click();
    await page.getByRole('button', { name: 'Añadir tramo' }).click();

    await expect(page.getByText('Ese día tiene tramos que se solapan.')).toBeVisible();

    // Saving is refused rather than silently writing a broken week.
    await page.getByRole('button', { name: 'Guardar la semana' }).click();
    await expect(page.getByText('Corrige primero las horas marcadas.')).toBeVisible();
    await expectNoRawError(page);
  });

  test('never claims to have changed a date-specific exception', async ({ page }) => {
    await expect(page.getByText('Cambios en fechas concretas')).toBeVisible();
    await expect(
      page.getByText('El horario semanal de arriba es la norma. Todo lo demás es una excepción.'),
    ).toBeVisible();
  });
});

test.describe('the services list', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/services');
  });

  /**
   * Hide used to be a one-way door: there was no Show anywhere on the list,
   * and nothing said why there was no delete.
   */
  test('hides a service and puts it back', async ({ page }) => {
    await expect(page.getByText(/Los servicios no se borran/)).toBeVisible();

    await page.getByRole('button', { name: 'Ocultar' }).first().click();
    await expect(page.getByText('Ocultos')).toBeVisible();

    const show = page.getByRole('button', { name: 'Mostrar' }).first();
    await expect(show).toBeVisible();
    await show.click();

    await expect(page.getByRole('button', { name: 'Ocultar' }).first()).toBeVisible();
    await expectNoRawError(page);
  });
});

test.describe('the public booking page', () => {
  test('says how far through you are @mobile', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);

    await expect(page.getByText(/Paso 1 de 5/)).toBeVisible();
    await option(page, TENANT_A.services.free).click();
    await chooseDay(page, openDateISO());
    await expect(page.getByText(/Paso 3 de 5/)).toBeVisible();
  });

  test('keeps Confirm in reach once everything is chosen @mobile', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await option(page, TENANT_A.services.free).click();
    await chooseDay(page, openDateISO());
    await page
      .getByRole('radio', { name: /\d{1,2}:\d{2}.*Libre/ })
      .first()
      .click();

    await page.getByRole('textbox', { name: 'Nombre completo' }).fill('Rosa Jiménez');
    await page.getByRole('textbox', { name: 'Teléfono' }).fill('+1 809 555 0777');

    // One in the review card, one pinned to the bottom of the viewport.
    await expect(page.getByRole('button', { name: 'Confirmar reserva' })).toHaveCount(2);
    await expect(page.getByText(/Paso 5 de 5/)).toBeVisible();
  });
});

test.describe('the storefront', () => {
  test('offers the booking link before the price list, not after it @mobile', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}`);

    // The call to action is a Button inside a Link, so the role a reader
    // meets is button; the anchor around it is only how it navigates.
    const book = page.getByRole('button', { name: 'Reservar', exact: true });
    await expect(book.first()).toBeVisible();

    // Above the fold, which is the whole point: the old one was below six
    // services.
    const top = await book.first().boundingBox();
    expect(top?.y ?? Infinity).toBeLessThan(400);
    await expectNoRawError(page);
  });
});
