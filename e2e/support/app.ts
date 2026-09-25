import { expect, type Locator, type Page } from '@playwright/test';

import { openDateISO } from './dates';
import { GUEST, TENANT_A } from './fixtures';

/**
 * The journeys, written once.
 *
 * Everything here addresses the page the way a person does -- by role and by
 * accessible name -- and never by CSS structure. That is not only a style
 * preference: a selector like `div > div:nth-child(3)` passes while the label
 * is missing, and the accessibility pass in this same suite exists precisely
 * to notice missing labels. Selectors that depend on them keep the two honest.
 */

export type Language = 'es' | 'en';

/** Every string the suite asserts on, in both languages. */
export const TEXT = {
  es: {
    chooseService: '1. Elige un servicio',
    date: 'Fecha',
    nextWeek: 'Semana siguiente',
    fullName: 'Nombre completo',
    phone: 'Teléfono',
    email: 'Correo (opcional)',
    confirm: 'Confirmar reserva',
    booked: 'Tu cita está reservada',
    reschedule: 'Reprogramar',
    move: 'Mover mi cita',
    cancel: 'Cancelar esta cita',
    cancelled: 'Cita cancelada',
    notFound: 'No encontramos esta página',
    needTheLink: 'Esta página necesita el enlace personal que recibiste al reservar.',
    signIn: 'Iniciar sesión',
    demoPayment: 'Pago de demostración',
    noRealCharge: 'no se realizará ningún cargo real',
    offline: 'Sin conexión',
    messages: 'Mensajes',
  },
  en: {
    chooseService: '1. Choose a service',
    date: 'Date',
    nextWeek: 'Next week',
    fullName: 'Full name',
    phone: 'Phone',
    email: 'Email (optional)',
    confirm: 'Confirm booking',
    booked: 'You are booked',
    reschedule: 'Reschedule',
    move: 'Move my appointment',
    cancel: 'Cancel this appointment',
    cancelled: 'Appointment cancelled',
    notFound: 'We could not find this page',
    needTheLink: 'This page needs the personal link you were given when you booked.',
    signIn: 'Sign in',
    demoPayment: 'Demo payment',
    noRealCharge: 'no real charge will be made',
    offline: 'No connection',
    messages: 'Messages',
  },
} as const;

/** Switches the interface language and waits for it to actually change. */
export async function switchLanguage(page: Page, language: Language): Promise<void> {
  const label = language === 'es' ? 'Español' : 'English';
  await page.getByRole('radio', { name: label, exact: true }).click();
  await expect(page.getByText(TEXT[language].chooseService)).toBeVisible();
}

/**
 * Picks a day from the week strip that replaced the date text field.
 *
 * The strip shows seven days starting from whatever is currently chosen, so
 * reaching a date further out means stepping forward a week at a time -- the
 * same thing a person does. Each day is addressed by its full spoken date,
 * which is the accessible name the control carries in both languages.
 */
export async function chooseDay(page: Page, iso: string, language: Language = 'es'): Promise<void> {
  const spoken = new Intl.DateTimeFormat(language === 'es' ? 'es-DO' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T12:00:00Z`));

  const day = page.getByRole('radio', { name: spoken, exact: true });

  // Ten weeks of stepping more than covers the 60-day booking horizon.
  for (let attempt = 0; attempt < 10; attempt++) {
    if ((await day.count()) > 0) {
      await day.click();
      return;
    }
    await page.getByRole('button', { name: TEXT[language].nextWeek }).click();
    await page.waitForTimeout(250);
  }

  throw new Error(`the day strip never reached ${iso} (${spoken})`);
}

/** A service, a slot, a professional: all radios with an accessible name. */
export function option(page: Page, name: string | RegExp): Locator {
  return page.getByRole('radio', { name });
}

/**
 * Reveals the times that are not free, which the page folds away.
 *
 * Returns whether there was anything to reveal: a day nobody has booked yet
 * has nothing folded, and a test that insists otherwise is testing the seed
 * rather than the product.
 */
export async function showUnavailableTimes(page: Page): Promise<boolean> {
  // The grid has to exist before anything can be counted in it.
  await expect(page.getByRole('radio', { name: /\d{1,2}:\d{2}/ }).first()).toBeVisible();

  const toggle = page.getByRole('button', {
    name: /Ver \d+ horas? no disponibles?|Show \d+ unavailable/,
  });
  if ((await toggle.count()) === 0) return false;

  await toggle.click();
  return true;
}

/** The first free time on the chosen day, whatever it happens to be. */
export function firstSlot(page: Page): Locator {
  // Times are the only radios that appear after a date is chosen, and they are
  // named by the clock. Matching the shape rather than a particular hour keeps
  // this working when the seeded opening hours change.
  return page.getByRole('radio', { name: /\d{1,2}:\d{2}.*(Libre|Free)/ }).first();
}

interface BookOptions {
  slug?: string;
  service?: string;
  date?: string;
  language?: Language;
  guest?: { name: string; phone: string; email?: string };
}

/**
 * The whole guest journey, from the public page to the confirmation.
 *
 * Returns the confirmation URL, fragment and all, because the guest credential
 * lives in it and several tests need to go back to it.
 */
export async function bookAsGuest(page: Page, options: BookOptions = {}): Promise<string> {
  const {
    slug = TENANT_A.slug,
    service = TENANT_A.services.free,
    date = openDateISO(),
    language = 'es',
    guest = GUEST,
  } = options;

  await page.goto(`/p/${slug}/book`);

  if (language !== 'es') await switchLanguage(page, language);
  const text = TEXT[language];

  await expect(page.getByText(text.chooseService)).toBeVisible();
  await option(page, service).click();

  await chooseDay(page, date, language);

  const slot = firstSlot(page);
  await expect(slot).toBeVisible();
  await slot.click();

  await page.getByRole('textbox', { name: text.fullName }).fill(guest.name);
  await page.getByRole('textbox', { name: text.phone }).fill(guest.phone);
  if (guest.email) {
    await page.getByRole('textbox', { name: text.email }).fill(guest.email);
  }

  // Two of them once the review step is reached: the one in the card and the
  // one pinned to the bottom of the viewport. The pinned one is what a person
  // on a phone actually presses.
  await page.getByRole('button', { name: text.confirm }).last().click();

  await expect(page.getByText(text.booked)).toBeVisible();
  return page.url();
}

/** Signs a professional in and waits for the workspace to be reachable. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /Correo|Email/ }).fill(email);
  await page.getByRole('textbox', { name: /Contraseña|Password/ }).fill(password);
  await page.getByRole('button', { name: /Iniciar sesión|Sign in/ }).click();

  await page.waitForURL(/\/app\//);
}

/** True when nothing on the page looks like a leaked internal error. */
export async function expectNoRawError(page: Page): Promise<void> {
  const body = (await page.textContent('body')) ?? '';

  for (const leak of [
    'PGRST',
    'permission denied for',
    'relation "',
    'at Object.',
    'TypeError:',
    'supabase.co/rest',
    'SQLSTATE',
  ]) {
    expect(body, `the page shows "${leak}", which is not for a customer to read`).not.toContain(
      leak,
    );
  }
}
