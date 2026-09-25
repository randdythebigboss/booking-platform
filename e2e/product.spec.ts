import { bookAsGuest, chooseDay, expectNoRawError, option, signIn, TEXT } from './support/app';
import { count, query } from './support/db';
import { openDateISO } from './support/dates';
import { GUEST, TENANT_A } from './support/fixtures';
import { expect, test } from './support/test';

/**
 * The Phase 12 product pass: the date control, the language toggle, the
 * professional's setup path, what a customer can see of a day, the optional
 * account, the conversation, and the Azul button with nothing behind it.
 */

const SPANISH_MONTH =
  /de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/;

test.describe('choosing a day', () => {
  test('is a control, not a text field @mobile', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await option(page, TENANT_A.services.free).click();

    // The old field is gone, and seven tappable days are there instead.
    await expect(page.getByRole('textbox', { name: 'Fecha' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: SPANISH_MONTH })).toHaveCount(7);
  });

  test('never offers a day that has already gone', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await option(page, TENANT_A.services.free).click();

    const days = await page
      .getByRole('radio', { name: SPANISH_MONTH })
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));

    // The strip begins today. Stepping back from today is refused rather than
    // silently wrapping into last week.
    const back = page.getByRole('button', { name: 'Semana anterior' });
    await expect(back).toBeDisabled();
    expect(days.length).toBe(7);
  });

  test('a time that has gone cannot be chosen', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await option(page, TENANT_A.services.free).click();
    await chooseDay(page, openDateISO(0));

    const gone = page.getByRole('radio', { name: /\d{1,2}:\d{2}.*Ya pasó/ });
    if ((await gone.count()) > 0) {
      await expect(gone.first()).toBeDisabled();
    }
  });
});

test.describe('the language toggle', () => {
  test('is on every screen, in the same place @mobile', async ({ page }) => {
    for (const path of [
      '/',
      `/p/${TENANT_A.slug}`,
      `/p/${TENANT_A.slug}/book`,
      '/login',
      '/account/login',
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole('radio', { name: 'Español', exact: true }),
        `no language control on ${path}`,
      ).toBeVisible();
    }
  });

  test('changes the page and keeps everything that was chosen', async ({ page }) => {
    const date = openDateISO();
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await option(page, TENANT_A.services.free).click();
    await chooseDay(page, date);
    await page
      .getByRole('radio', { name: /\d{1,2}:\d{2}.*Libre/ })
      .first()
      .click();
    await page.getByRole('textbox', { name: TEXT.es.fullName }).fill('Media Escrita');

    await page.getByRole('radio', { name: 'English', exact: true }).click();
    await expect(page.getByText(TEXT.en.chooseService)).toBeVisible();

    // The typed name, the chosen service and the chosen day all survive.
    await expect(page.getByRole('textbox', { name: TEXT.en.fullName })).toHaveValue(
      'Media Escrita',
    );
    const checked = await page
      .getByRole('radio')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => node.getAttribute('aria-checked') === 'true')
          .map((node) => node.getAttribute('aria-label') ?? ''),
      );
    expect(checked).toContain(TENANT_A.services.free);
    expect(checked.some((label) => /\d/.test(label))).toBe(true);
  });

  test('does not sign anybody out', async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/settings');
    await page.getByRole('radio', { name: 'English', exact: true }).click();
    await page.waitForTimeout(800);

    await page.goto('/app/dashboard');
    await expect(page).toHaveURL(/\/app\/dashboard/);
  });
});

test.describe('what a customer can see of a day', () => {
  test('shows the whole day, not only the gaps', async ({ page }) => {
    await page.goto(`/p/${TENANT_A.slug}/book`);
    await option(page, TENANT_A.services.free).click();
    await chooseDay(page, openDateISO());

    const all = await page.getByRole('radio', { name: /^\d{1,2}:\d{2}/ }).count();
    const free = await page.getByRole('radio', { name: /\d{1,2}:\d{2}.*Libre/ }).count();

    expect(all).toBeGreaterThan(0);
    expect(free).toBeLessThanOrEqual(all);
    // The legend, because shading alone never carries meaning.
    await expect(page.getByText('Ocupado', { exact: true })).toBeVisible();
  });

  /**
   * The privacy rule, stated as a test. A busy slot may say that it is busy
   * and must say nothing else.
   */
  test('never says who has a taken time', async ({ page, context }) => {
    const guest = await context.newPage();
    await bookAsGuest(guest, {
      date: openDateISO(2),
      guest: { name: 'Persona Privada', phone: '+1 809 555 0999', email: 'privada@example.test' },
    });
    await guest.close();

    await page.goto(`/p/${TENANT_A.slug}/book`);
    await option(page, TENANT_A.services.free).click();
    await chooseDay(page, openDateISO(2));
    await expect(page.getByRole('radio', { name: /\d{1,2}:\d{2}.*Ocupado/ }).first()).toBeVisible();

    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toContain('Persona Privada');
    expect(body).not.toContain('privada@example.test');
    expect(body).not.toContain('+1 809 555 0999');
    await expectNoRawError(page);
  });
});

test.describe('the professional setup path', () => {
  test('a fully set-up business is not nagged', async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.waitForTimeout(1500);

    // The seeded business has services, hours and a published page, so the
    // checklist has nothing to say and does not say it.
    await expect(page.getByText('Pon tu negocio en marcha')).toHaveCount(0);
  });
});

test.describe('the Azul button', () => {
  test('says plainly that it is not a payment @mobile', async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/settings');
    await expect(page.getByText('Pagos con tarjeta (Azul)')).toBeVisible();
    await expect(page.getByText('Todavía no disponible')).toBeVisible();

    await page.getByRole('button', { name: 'Pagar con Azul' }).first().click();
    await expect(page.getByText(/no se ha cobrado nada/i)).toBeVisible();
    await expect(page.getByText(/todavía no está disponible/i)).toBeVisible();
  });

  test('takes no payment and creates nothing', async ({ page }) => {
    const before = count('public.payments', 'true');

    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/settings');
    await page.getByRole('button', { name: 'Pagar con Azul' }).first().click();
    await page.waitForTimeout(1200);

    expect(count('public.payments', 'true')).toBe(before);
  });
});

test.describe('the conversation about an appointment', () => {
  test('a guest writes with nothing but their link', async ({ page }) => {
    await bookAsGuest(page);

    await expect(page.getByRole('heading', { name: TEXT.es.messages })).toBeVisible();
    await page.getByRole('textbox', { name: 'Escribe un mensaje' }).fill('Llego un poco tarde.');
    await page.getByRole('button', { name: 'Enviar' }).click();

    await expect(page.getByText('Llego un poco tarde.')).toBeVisible();
    expect(count('public.appointment_messages', "author = 'customer'")).toBe(1);
  });

  test('the professional reads it and answers', async ({ page, context }) => {
    const guest = await context.newPage();
    await bookAsGuest(guest, { guest: { ...GUEST, name: 'Habla Conmigo' } });
    await guest
      .getByRole('textbox', { name: 'Escribe un mensaje' })
      .fill('¿Puedo llegar 10 min tarde?');
    await guest.getByRole('button', { name: 'Enviar' }).click();
    await expect(guest.getByText('¿Puedo llegar 10 min tarde?')).toBeVisible();

    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/appointments');
    await page
      .getByRole('link', { name: /Habla Conmigo/ })
      .first()
      .click();
    await page.waitForURL(/\/app\/appointments\/[0-9a-f-]+/);

    await expect(page.getByText('¿Puedo llegar 10 min tarde?')).toBeVisible();
    await page.getByRole('textbox', { name: 'Escribe un mensaje' }).fill('Sin problema.');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByText('Sin problema.')).toBeVisible();

    // And the guest sees the answer on their own link.
    await guest.reload();
    await expect(guest.getByText('Sin problema.')).toBeVisible();
    await guest.close();
  });

  test('a wrong credential reads nothing of it', async ({ page }) => {
    const url = await bookAsGuest(page);
    const id = url.split('/booking/')[1]?.split('/')[0] ?? '';

    await page.getByRole('textbox', { name: 'Escribe un mensaje' }).fill('Secreto del cliente.');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByText('Secreto del cliente.')).toBeVisible();

    await page.goto(`/booking/${id}/confirmation#token=00000000-0000-4000-8000-000000000000`);
    await page.waitForTimeout(1500);

    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toContain('Secreto del cliente.');
    await expectNoRawError(page);
  });

  test('says that nothing leaves the application', async ({ page }) => {
    await bookAsGuest(page);
    await expect(page.getByText(/No se envía nada por correo ni por WhatsApp/i)).toBeVisible();
  });
});

test.describe('the optional customer account', () => {
  const password = 'cliente-password-123';

  async function signUpCustomer(page: Parameters<typeof chooseDay>[0], email: string) {
    await page.goto('/account/login');
    await page.getByRole('button', { name: /No tienes cuenta/ }).click();
    await page.getByRole('textbox', { name: /Nombre/ }).fill('Cris Cuenta');
    await page.getByRole('textbox', { name: /Correo/ }).fill(email);
    await page.getByRole('textbox', { name: /Contraseña/ }).fill(password);
    await page.getByRole('button', { name: /Crear/ }).first().click();
    await page.waitForURL(/\/account/, { timeout: 30_000 });
    // The sign-out button only exists once the session is really live, and
    // another page cannot ask "is anybody signed in?" until it is.
    await page.getByRole('button', { name: /Cerrar sesión/ }).waitFor({ timeout: 30_000 });
  }

  test('booking still needs no account at all @mobile', async ({ page }) => {
    await bookAsGuest(page);
    // Nothing on the confirmation asks a signed-out guest to have one.
    await expect(page.getByRole('button', { name: /Guardar esta cita/ })).toHaveCount(0);
  });

  test('a customer signs up, claims a booking and sees it', async ({ page }) => {
    const url = await bookAsGuest(page, { guest: { ...GUEST, name: 'Cris Cuenta' } });

    await signUpCustomer(page, `cliente${Date.now()}@example.test`);
    await expect(page.getByText(/Todavía no tienes citas/)).toBeVisible();

    await page.goto(url);
    await page.getByRole('button', { name: /Guardar esta cita/ }).click();
    await expect(page.getByText(/Guardada en tu cuenta/)).toBeVisible();

    await page.goto('/account');
    await expect(page.getByText(TENANT_A.name).first()).toBeVisible();
  });

  test('one account never sees another customer’s appointments', async ({ page, context }) => {
    const other = await context.newPage();
    await bookAsGuest(other, { guest: { ...GUEST, name: 'Alguien Mas' } });
    await other.close();

    await signUpCustomer(page, `solo${Date.now()}@example.test`);
    await page.goto('/account');
    await page.waitForTimeout(1500);

    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toContain('Alguien Mas');
    await expect(page.getByText(/Todavía no tienes citas/)).toBeVisible();
  });

  test('an appointment already claimed is not taken over', async ({ page, context }) => {
    const guest = await context.newPage();
    const url = await bookAsGuest(guest, { guest: { ...GUEST, name: 'Ya Reclamada' } });
    await guest.close();

    await signUpCustomer(page, `first${Date.now()}@example.test`);
    await page.goto(url);
    await page.getByRole('button', { name: /Guardar esta cita/ }).click();
    await expect(page.getByText(/Guardada en tu cuenta/)).toBeVisible();

    // A second account, the same link.
    await page.goto('/account');
    await page.getByRole('button', { name: /Cerrar sesión|Sign out/ }).click();
    await page.waitForTimeout(2000);

    await signUpCustomer(page, `second${Date.now()}@example.test`);
    await page.goto(url);
    await page.getByRole('button', { name: /Guardar esta cita/ }).click();
    await expect(page.getByText(/No pudimos guardarla/)).toBeVisible();

    const owner = query(
      "select count(*) from public.customers where full_name = 'Ya Reclamada' and auth_user_id is not null",
    );
    expect(owner).toBe('1');
  });
});
