import { createInstance } from 'i18next';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { statusLabelKey } from '@/features/appointments';
import { validatePassword } from '@/features/auth/validation';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, resources } from '@/locales';

/**
 * i18next itself, driven the way the app drives it.
 *
 * A separate instance rather than the app's, so these tests never leave the
 * shared one in another language.
 */
const i18n = createInstance();

/** Keys built at runtime, exactly as `useDynamicT` does in the app. */
const tk = (key: string, values?: Record<string, unknown>) =>
  i18n.t(key as never, values ?? {}) as string;

beforeAll(async () => {
  await i18n.init({
    resources,
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    returnEmptyString: false,
    interpolation: { escapeValue: false },
  });
});

afterAll(async () => {
  await i18n.changeLanguage(DEFAULT_LOCALE);
});

describe('the default language', () => {
  it('starts in Spanish without being asked', () => {
    expect(i18n.language).toBe('es');
    expect(i18n.t('common.save')).toBe('Guardar');
  });
});

describe('switching language', () => {
  it('changes what everything reads, without a restart', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('common.save')).toBe('Save');

    await i18n.changeLanguage('es');
    expect(i18n.t('common.save')).toBe('Guardar');
  });

  it('renders a status in whichever language is current', async () => {
    const key = statusLabelKey('no_show');

    await i18n.changeLanguage('es');
    expect(tk(key)).toBe('No asistió');

    await i18n.changeLanguage('en');
    expect(tk(key)).toBe('No-show');

    await i18n.changeLanguage('es');
  });

  it('renders a backend error code in whichever language is current', async () => {
    // The database raised SLOT_TAKEN. Both of these are that one code.
    await i18n.changeLanguage('es');
    const spanish = i18n.t('errors.booking.SLOT_TAKEN');

    await i18n.changeLanguage('en');
    const english = i18n.t('errors.booking.SLOT_TAKEN');

    expect(spanish).not.toBe(english);
    expect(spanish).toMatch(/hora/i);
    expect(english).toMatch(/time/i);

    await i18n.changeLanguage('es');
  });

  it('renders a validation code with its interpolated constant', async () => {
    const issue = validatePassword('short');
    expect(issue).toBeDefined();

    await i18n.changeLanguage('es');
    expect(tk(`validation.${issue!.code}`, issue!.values)).toContain('8');

    await i18n.changeLanguage('en');
    expect(tk(`validation.${issue!.code}`, issue!.values)).toContain('8');

    await i18n.changeLanguage('es');
  });
});

describe('fallback', () => {
  it('falls back to Spanish, never to English', async () => {
    // i18next is asked for a language it was never given.
    await i18n.changeLanguage('ja');
    expect(i18n.t('common.save')).toBe('Guardar');
    await i18n.changeLanguage('es');
  });

  it('never renders a key as its own name', async () => {
    for (const language of SUPPORTED_LOCALES) {
      await i18n.changeLanguage(language);
      const rendered = i18n.t('appointments.title');
      expect(rendered).not.toBe('appointments.title');
      expect(rendered.length).toBeGreaterThan(0);
    }
    await i18n.changeLanguage('es');
  });
});

describe('pluralisation', () => {
  it('uses the plural rules of each language, not a concatenated count', async () => {
    await i18n.changeLanguage('es');
    expect(i18n.t('appointments.count', { count: 1 })).toBe('1 cita');
    expect(i18n.t('appointments.count', { count: 2 })).toBe('2 citas');
    expect(i18n.t('appointments.count', { count: 0 })).toBe('0 citas');

    await i18n.changeLanguage('en');
    expect(i18n.t('appointments.count', { count: 1 })).toBe('1 appointment');
    expect(i18n.t('appointments.count', { count: 2 })).toBe('2 appointments');
    expect(i18n.t('appointments.count', { count: 0 })).toBe('0 appointments');

    await i18n.changeLanguage('es');
  });

  it('pluralises the slot preview the same way', async () => {
    await i18n.changeLanguage('es');
    expect(i18n.t('preview.offered', { count: 1 })).toBe('Se ofrece 1 hora.');
    expect(i18n.t('preview.offered', { count: 12 })).toBe('Se ofrecen 12 horas.');

    await i18n.changeLanguage('en');
    expect(i18n.t('preview.offered', { count: 1 })).toBe('1 time offered.');
    expect(i18n.t('preview.offered', { count: 12 })).toBe('12 times offered.');

    await i18n.changeLanguage('es');
  });
});

describe('interpolation', () => {
  it('does not HTML-escape ordinary punctuation', async () => {
    await i18n.changeLanguage('es');
    // React escapes for us; double-escaping turns an apostrophe into &#39;.
    expect(i18n.t('appointments.note', { note: 'Trae su propio té & café' })).toContain('&');
    expect(i18n.t('appointments.note', { note: 'Trae su propio té & café' })).not.toContain(
      '&amp;',
    );
  });
});
