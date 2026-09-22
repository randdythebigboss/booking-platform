import { describe, expect, it } from 'vitest';

import {
  APPOINTMENT_ACTOR_TYPES,
  APPOINTMENT_EVENT_TYPES,
  statusLabelKey,
} from '@/features/appointments';
import { WEEKDAY_KEYS } from '@/features/availability/schedule';
import { BOOKING_ERROR_CODES, guestStatusKey } from '@/features/booking';
import { WORKSPACE_ERROR_CODES } from '@/features/workspace';
import { SUPPORTED_LOCALES, en, es, resources } from '@/locales';
import { APPOINTMENT_STATUSES, type Weekday } from '@/types/domain';

/**
 * The dictionaries must not drift.
 *
 * The typecheck already refuses to compile an English dictionary that is
 * missing a Spanish key or invents one of its own -- `en` is declared as
 * `Translations`, which is `typeof es` with its values widened. These tests
 * cover what a type cannot: that nothing is blank, that nothing was left in
 * the wrong language, and that every key the app *builds at runtime* exists.
 */

type Dict = Record<string, unknown>;

function flatten(value: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Dict)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === 'string') out[path] = entry;
    else Object.assign(out, flatten(entry, path));
  }
  return out;
}

const flatEs = flatten(es);
const flatEn = flatten(en);

describe('key parity', () => {
  it('has exactly the same keys in both languages', () => {
    expect(Object.keys(flatEn).sort()).toEqual(Object.keys(flatEs).sort());
  });

  it('has no empty strings anywhere', () => {
    for (const [key, value] of Object.entries(flatEs)) {
      expect(value.trim(), `es.${key} is empty`).not.toBe('');
    }
    for (const [key, value] of Object.entries(flatEn)) {
      expect(value.trim(), `en.${key} is empty`).not.toBe('');
    }
  });

  it('keeps the same interpolation placeholders on both sides', () => {
    // A sentence that says {{name}} in Spanish and {{nombre}} in English
    // renders the placeholder verbatim to whoever reads the second one.
    const placeholders = (value: string) =>
      (value.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) ?? []).map((m) => m.replace(/[{}\s]/g, '')).sort();

    for (const key of Object.keys(flatEs)) {
      expect(placeholders(flatEn[key] as string), `placeholders differ at ${key}`).toEqual(
        placeholders(flatEs[key] as string),
      );
    }
  });

  it('did not leave an English sentence sitting in the Spanish dictionary', () => {
    // Not a grammar checker -- a smoke alarm. These words appear in almost any
    // untranslated English UI string and in essentially no Spanish one.
    const tell = /\b(the|your|and|with|appointment|booking|time)\b/i;
    const allowed = new Set(['language.en', 'language.es']);

    // Placeholder NAMES are code, not copy: {{time}} is English-looking on
    // purpose and says nothing about whether the sentence was translated.
    const withoutPlaceholders = (value: string) => value.replace(/{{[^}]*}}/g, ' ');

    const suspects = Object.entries(flatEs)
      .filter(([key, value]) => !allowed.has(key) && tell.test(withoutPlaceholders(value)))
      .map(([key]) => key);

    expect(suspects).toEqual([]);
  });

  it('ships exactly the languages the product claims to speak', () => {
    expect(Object.keys(resources).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });
});

describe('keys the app builds at runtime', () => {
  const both = (key: string) => {
    expect(flatEs, `es is missing ${key}`).toHaveProperty(key);
    expect(flatEn, `en is missing ${key}`).toHaveProperty(key);
  };

  it('has a label for every appointment status the database can hold', () => {
    for (const status of APPOINTMENT_STATUSES) both(statusLabelKey(status));
  });

  it('has a guest-facing label for every status too', () => {
    for (const status of APPOINTMENT_STATUSES) both(guestStatusKey(status));
  });

  it('has a label for every action the lifecycle can offer', () => {
    for (const status of APPOINTMENT_STATUSES) both(`appointments.action_${status}`);
  });

  it('has a sentence for every event type crossed with every actor', () => {
    // The actor is part of the key, so the matrix is what has to exist. A
    // missing cell would render as a raw key to whoever hit that combination.
    const shapes = ['created', 'rescheduled', 'cancelled', 'statusChanged', 'statusChangedPlain'];
    for (const shape of shapes) {
      for (const actor of APPOINTMENT_ACTOR_TYPES) both(`history.${shape}_${actor}`);
    }
    expect(APPOINTMENT_EVENT_TYPES.length).toBe(3);
  });

  it('has a name for all seven weekdays', () => {
    for (let day = 0; day <= 6; day += 1) both(WEEKDAY_KEYS[day as Weekday]);
  });

  it('has a message for every error code the backend can produce', () => {
    for (const code of BOOKING_ERROR_CODES) both(`errors.booking.${code}`);
    for (const code of WORKSPACE_ERROR_CODES) both(`errors.workspace.${code}`);
  });
});

describe('plural forms', () => {
  it('declares both plural categories wherever one is used', () => {
    const plurals = Object.keys(flatEs).filter((key) => key.endsWith('_one'));
    expect(plurals.length).toBeGreaterThan(0);

    for (const one of plurals) {
      const other = one.replace(/_one$/, '_other');
      expect(flatEs, `es is missing ${other}`).toHaveProperty(other);
      expect(flatEn, `en is missing ${other}`).toHaveProperty(other);
    }
  });

  it('interpolates the count rather than concatenating it', () => {
    for (const key of Object.keys(flatEs).filter((k) => /_one$|_other$/.test(k))) {
      expect(flatEs[key], `es.${key}`).toContain('{{count}}');
      expect(flatEn[key], `en.${key}`).toContain('{{count}}');
    }
  });
});
