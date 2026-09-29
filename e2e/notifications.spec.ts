import { bookAsGuest, expectNoRawError, signIn, TEXT } from './support/app';
import { TENANT_A } from './support/fixtures';
import { expect, test } from './support/test';

/**
 * The notification centre, and the calendar file, in a real browser.
 *
 * These two are together because they answer the same question from opposite
 * ends: a guest books, the professional is told, and either of them can put
 * the result in their own calendar. The unit tests prove the branching and the
 * SQL suite proves who may read what; only a browser proves that the screen
 * wires them to each other.
 */

const ES = {
  activity: 'Novedades',
  unread: 'Sin leer',
  markAll: 'Marcar todo como leído',
  upToDate: 'Estás al día.',
  deliveries: 'Envíos',
  addToCalendar: 'Agregar a tu calendario',
  download: 'Descargar la cita',
  inAppOnly: /no envía notificaciones al teléfono/,
};

test.describe('the professional is told what happened', () => {
  test('a guest booking arrives as an unread notification @mobile', async ({ page }) => {
    await bookAsGuest(page, { guest: { name: 'Nora Aviso', phone: '809-555-0191' } });

    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/notifications');

    // It says what happened, in a sentence about the customer.
    await expect(page.getByText('Nora Aviso reservó una cita')).toBeVisible();

    // And it is unread. Asked of the unread view rather than of a badge,
    // because the seed has unread rows of its own and a badge somewhere on
    // the page proves nothing about this one.
    await page.getByRole('radio', { name: /Solo sin leer/ }).click();
    await expect(page.getByText('Nora Aviso reservó una cita')).toBeVisible();

    await expectNoRawError(page);
  });

  test('opening one marks it read and lands on the appointment', async ({ page }) => {
    await bookAsGuest(page, { guest: { name: 'Raul Leido', phone: '809-555-0192' } });

    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/notifications');

    await page.getByText('Raul Leido reservó una cita').click();

    // The link went where it said it would.
    await expect(page).toHaveURL(/\/app\/appointments\/[0-9a-f-]{36}/);
    // The name is on the page more than once -- the heading and the customer
    // card -- so this asks for the first, not for the only.
    await expect(page.getByText('Raul Leido').first()).toBeVisible();

    // And coming back, this row is no longer unread -- it is still in the
    // list, and gone from the unread view.
    await page.goto('/app/notifications');
    await expect(page.getByText('Raul Leido reservó una cita')).toBeVisible();

    await page.getByRole('radio', { name: /Solo sin leer/ }).click();
    await expect(page.getByText('Raul Leido reservó una cita')).toHaveCount(0);
  });

  test('marking everything read empties the list of unread things', async ({ page }) => {
    await bookAsGuest(page, { guest: { name: 'Tina Todo', phone: '809-555-0193' } });

    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/notifications');

    await page.getByRole('button', { name: ES.markAll }).click();

    // The "unread only" view is now empty, and says so rather than looking broken.
    await page.getByRole('radio', { name: /Solo sin leer/ }).click();
    await expect(page.getByText(ES.upToDate)).toBeVisible();
  });

  test('the outbox is still reachable, under its own tab', async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/notifications');

    await page.getByRole('radio', { name: ES.deliveries }).click();

    // The delivery monitor's own wording, which the activity tab never shows.
    await expect(page.getByText(/no está activado/)).toBeVisible();
    await expectNoRawError(page);
  });

  test('never claims to be a phone notification', async ({ page }) => {
    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/notifications');

    await expect(page.getByText(ES.inAppOnly)).toBeVisible();
  });
});

test.describe('putting an appointment in a calendar', () => {
  test('the customer downloads a real .ics from their confirmation @mobile', async ({ page }) => {
    await bookAsGuest(page, { guest: { name: 'Cali Archivo', phone: '809-555-0194' } });

    await expect(page.getByText(ES.addToCalendar)).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: ES.download }).click();
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/\.ics$/);

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const ics = Buffer.concat(chunks).toString('utf8');

    // A calendar file, and one a calendar will accept.
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toMatch(/UID:[0-9a-f-]{36}@booking-platform/);
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(ics).toMatch(/DTEND:\d{8}T\d{6}Z/);
    expect(ics).toContain(TENANT_A.name);

    // The reminder that was on screen is the reminder in the file.
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-PT15M');

    // And the identity is the appointment's, so a second download replaces
    // this event rather than sitting beside it.
    const uid = /UID:([0-9a-f-]{36})@/.exec(ics)?.[1];
    expect(page.url()).toContain(uid ?? 'no-uid');
  });

  test('the reminder the customer picks is the one written down', async ({ page }) => {
    await bookAsGuest(page, { guest: { name: 'Media Hora', phone: '809-555-0195' } });

    await page.getByRole('radio', { name: /30 minutos antes/ }).click();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: ES.download }).click();
    const file = await download;

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const ics = Buffer.concat(chunks).toString('utf8');

    expect(ics).toContain('TRIGGER:-PT30M');
    expect(ics).not.toContain('TRIGGER:-PT15M');
  });

  test('the professional can put the same appointment in their own calendar', async ({ page }) => {
    await bookAsGuest(page, { guest: { name: 'Pro Calendario', phone: '809-555-0196' } });

    await signIn(page, TENANT_A.email, TENANT_A.password);
    await page.goto('/app/appointments');
    await page.getByText('Pro Calendario').first().click();

    await expect(page.getByText(ES.addToCalendar)).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: ES.download }).click();
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/\.ics$/);
    await expectNoRawError(page);
  });

  test('a cancelled appointment offers a withdrawal, not a second event', async ({ page }) => {
    const url = await bookAsGuest(page, {
      guest: { name: 'Ana Cancela', phone: '809-555-0197' },
    });

    await page.getByRole('button', { name: TEXT.es.cancel }).click();
    await expect(page.getByText(TEXT.es.cancelled)).toBeVisible();

    await page.goto(url);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Descargar la cancelación/ }).click();
    const file = await download;

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const ics = Buffer.concat(chunks).toString('utf8');

    // Importing this withdraws the event somebody already has.
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
    // No alarm for an appointment that is not happening.
    expect(ics).not.toContain('BEGIN:VALARM');
  });
});
