import { describe, expect, it } from 'vitest';

import {
  notificationTemplates,
  renderNotification,
  TEMPLATE_KEYS,
  type NotificationPayload,
} from '@/features/notifications';
import { SUPPORTED_LOCALES } from '@/locales';

/**
 * A message is written once and read later, possibly much later. These tests
 * are about the two things that cannot be corrected afterwards: the language
 * it was written in, and the instant it claims the appointment is at.
 */

const payload: NotificationPayload = {
  appointmentId: 'a1',
  businessName: 'Salón Aurora',
  professionalName: 'Alex Rivera',
  serviceName: 'Corte de cabello',
  customerName: 'Lucía Fernández',
  // 14:00 in Santo Domingo, which is UTC-4 all year.
  startsAt: '2026-10-19T18:00:00Z',
  endsAt: '2026-10-19T18:30:00Z',
  timezone: 'America/Santo_Domingo',
};

describe('the registry', () => {
  it('has every template in every language the product speaks', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of TEMPLATE_KEYS) {
        expect(notificationTemplates[locale][key], `${locale}.${key}`).toBeTypeOf('function');
      }
    }
  });

  it('produces a subject and a body for all of them, in both languages', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of TEMPLATE_KEYS) {
        const message = renderNotification(key, locale, payload);
        expect(message.subject.trim(), `${locale}.${key} subject`).not.toBe('');
        expect(message.body.trim(), `${locale}.${key} body`).not.toBe('');
      }
    }
  });
});

describe('language', () => {
  it('writes Spanish for a booking made in Spanish', () => {
    const message = renderNotification('booking.confirmed', 'es', payload);

    expect(message.subject).toContain('confirmada');
    expect(message.body).toContain('Hola Lucía Fernández');
  });

  it('writes English for a booking made in English', () => {
    const message = renderNotification('booking.confirmed', 'en', payload);

    expect(message.subject).toContain('confirmed');
    expect(message.body).toContain('Hello Lucía Fernández');
  });

  it('falls back to Spanish for a language the product does not speak', () => {
    // Not to English. Spanish is the product's language, not its second choice.
    const message = renderNotification('booking.confirmed', 'fr', payload);

    expect(message.subject).toBe(renderNotification('booking.confirmed', 'es', payload).subject);
  });

  it('never translates what the business typed', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const message = renderNotification('booking.reminder', locale, payload);

      expect(message.body).toContain('Corte de cabello');
      expect(message.body).toContain('Alex Rivera');
      expect(message.subject).toContain('Salón Aurora');
    }
  });
});

describe('time', () => {
  it('states the appointment in the business timezone, not in UTC', () => {
    // 18:00Z is 14:00 in Santo Domingo. A reader in another country still has
    // to turn up at two in the afternoon, local to the business.
    const spanish = renderNotification('booking.confirmed', 'es', payload);
    const english = renderNotification('booking.confirmed', 'en', payload);

    expect(spanish.body).toContain('2:00');
    expect(english.body).toContain('2:00');
    expect(spanish.body).toContain('America/Santo_Domingo');
  });

  it('keeps the instant while changing the language', () => {
    const madrid = { ...payload, timezone: 'Europe/Madrid' };
    const message = renderNotification('booking.confirmed', 'en', madrid);

    // The same instant is 20:00 in Madrid. Locale and timezone are independent.
    expect(message.body).toContain('8:00');
  });

  it(`writes the date in the reader's language`, () => {
    expect(renderNotification('booking.reminder', 'es', payload).body).toContain('octubre');
    expect(renderNotification('booking.reminder', 'en', payload).body).toContain('October');
  });
});

describe('what a message leaves out', () => {
  it('never carries the booking access token', () => {
    // The payload has no token by construction; this is the guard that says so
    // out loud, because an email link is the obvious place one would appear.
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of TEMPLATE_KEYS) {
        const message = renderNotification(key, locale, payload);
        expect(message.body).not.toMatch(/token=/i);
      }
    }
  });

  it('copes with a booking that recorded no service or professional', () => {
    const bare = { ...payload, serviceName: null, professionalName: null };

    for (const locale of SUPPORTED_LOCALES) {
      const message = renderNotification('booking.confirmed', locale, bare);
      expect(message.body).not.toContain('null');
      expect(message.body.trim()).not.toBe('');
    }
  });
});
