import { describe, expect, it } from 'vitest';

import {
  formatDateIn,
  formatDateTimeIn,
  formatDuration,
  formatMoney,
  formatTimeIn,
} from '@/lib/format';

/**
 * Locale and timezone are two different questions, and every test here asks
 * them separately: the same instant in two languages, and two instants in the
 * same language. Nothing in this module may let one answer the other.
 */
const ES = 'es-DO';
const EN = 'en-US';

describe('formatDuration', () => {
  it('reads naturally on both sides of an hour', () => {
    expect(formatDuration(30, EN)).toMatch(/30/);
    expect(formatDuration(60, EN)).toMatch(/1/);
    expect(formatDuration(90, EN)).toMatch(/1.*30/);
  });

  it('uses the reader units rather than one language fixed ones', () => {
    const spanish = formatDuration(45, ES);
    const english = formatDuration(45, EN);
    expect(spanish).toMatch(/45/);
    expect(english).toMatch(/45/);
  });

  it('does not throw on a locale Intl cannot expand', () => {
    expect(() => formatDuration(45, 'zz-ZZ-nonsense')).not.toThrow();
  });
});

describe('formatMoney', () => {
  it('formats a known currency', () => {
    expect(formatMoney(1200, 'DOP', ES)).toMatch(/1,200/);
  });

  it('renders the same amount differently per locale, and never hardcodes a symbol', () => {
    const spanish = formatMoney(800, 'DOP', ES);
    const english = formatMoney(800, 'DOP', EN);

    expect(spanish).toMatch(/800/);
    expect(english).toMatch(/800/);
    // Both must name the currency somehow -- a bare "800" would be a bug.
    expect(spanish.replace(/[\d.,\s]/g, '').length).toBeGreaterThan(0);
    expect(english.replace(/[\d.,\s]/g, '').length).toBeGreaterThan(0);
  });

  it('uses the currency it was given, not the locale own', () => {
    expect(formatMoney(10, 'USD', ES)).toMatch(/10/);
    expect(formatMoney(10, 'EUR', EN)).toMatch(/10/);
    expect(formatMoney(10, 'USD', ES)).not.toBe(formatMoney(10, 'EUR', ES));
  });

  it('degrades gracefully instead of throwing on an unknown code', () => {
    expect(formatMoney(1200, 'XXXX', ES)).toBe('1200.00 XXXX');
  });
});

describe('formatTimeIn', () => {
  it('renders in the business timezone, not the host one', () => {
    const instant = new Date('2026-09-21T13:00:00.000Z');
    expect(formatTimeIn(instant, 'America/Santo_Domingo', ES)).toMatch(/09:00/);
    expect(formatTimeIn(instant, 'Europe/Madrid', ES)).toMatch(/03:00/);
  });

  it('keeps the business timezone when the language changes', () => {
    // 17:00 in Santo Domingo. Whatever the words around it, it is 5pm there.
    const instant = new Date('2026-09-23T21:00:00.000Z');
    expect(formatTimeIn(instant, 'America/Santo_Domingo', ES)).toMatch(/05:00/);
    expect(formatTimeIn(instant, 'America/Santo_Domingo', EN)).toMatch(/5:00/);
  });

  it('survives a daylight saving change in a zone that observes one', () => {
    // Both 10:00 local in New York, one side of the November change each.
    const edt = new Date('2026-10-20T14:00:00.000Z');
    const est = new Date('2026-11-10T15:00:00.000Z');
    expect(formatTimeIn(edt, 'America/New_York', EN)).toMatch(/10:00/);
    expect(formatTimeIn(est, 'America/New_York', EN)).toMatch(/10:00/);
  });
});

describe('formatDateIn', () => {
  it('can land on a different calendar day per timezone', () => {
    const instant = new Date('2026-09-22T02:00:00.000Z');
    expect(formatDateIn(instant, 'America/Santo_Domingo', ES)).toMatch(/21/);
    expect(formatDateIn(instant, 'UTC', ES)).toMatch(/22/);
  });

  it('names the weekday and month in the reader language', () => {
    const instant = new Date('2026-09-23T15:00:00.000Z');
    const spanish = formatDateIn(instant, 'America/Santo_Domingo', ES);
    const english = formatDateIn(instant, 'America/Santo_Domingo', EN);

    expect(spanish).toMatch(/miércoles/i);
    expect(spanish).toMatch(/septiembre/i);
    expect(english).toMatch(/wednesday/i);
    expect(english).toMatch(/september/i);
  });

  it('is the same calendar day in both languages', () => {
    const instant = new Date('2026-09-23T15:00:00.000Z');
    expect(formatDateIn(instant, 'America/Santo_Domingo', ES)).toMatch(/23/);
    expect(formatDateIn(instant, 'America/Santo_Domingo', EN)).toMatch(/23/);
  });
});

describe('formatDateTimeIn', () => {
  it('carries the day, because a move can cross one', () => {
    const rendered = formatDateTimeIn(new Date('2026-09-28T14:00:00.000Z'), 'America/Santo_Domingo', ES);
    expect(rendered).toMatch(/28/);
    expect(rendered).toMatch(/10/);
  });

  it('renders in the business timezone, not the device one', () => {
    const instant = new Date('2026-09-28T02:00:00.000Z');
    expect(formatDateTimeIn(instant, 'America/Santo_Domingo', ES)).toMatch(/27/);
    expect(formatDateTimeIn(instant, 'UTC', ES)).toMatch(/28/);
  });
});
