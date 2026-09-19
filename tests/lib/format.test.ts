import { describe, expect, it } from 'vitest';

import { formatDateIn, formatDuration, formatMoney, formatTimeIn } from '@/lib/format';

describe('formatDuration', () => {
  it('reads naturally on both sides of an hour', () => {
    expect(formatDuration(30)).toBe('30 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(90)).toBe('1 h 30 min');
  });
});

describe('formatMoney', () => {
  it('formats a known currency', () => {
    expect(formatMoney(1200, 'DOP')).toMatch(/1,200/);
  });

  it('degrades gracefully instead of throwing on an unknown code', () => {
    expect(formatMoney(1200, 'XXXX')).toBe('1200.00 XXXX');
  });
});

describe('formatTimeIn', () => {
  it('renders in the business timezone, not the host one', () => {
    const instant = new Date('2026-09-21T13:00:00.000Z');
    expect(formatTimeIn(instant, 'America/Santo_Domingo')).toMatch(/09:00/);
    // es-DO renders a 12-hour clock, so Madrid reads 03:00 in the afternoon.
    expect(formatTimeIn(instant, 'Europe/Madrid')).toMatch(/03:00/);
  });
});

describe('formatDateIn', () => {
  it('can land on a different calendar day per timezone', () => {
    const instant = new Date('2026-09-22T02:00:00.000Z');
    expect(formatDateIn(instant, 'America/Santo_Domingo')).toMatch(/21/);
    expect(formatDateIn(instant, 'Europe/Madrid')).toMatch(/22/);
  });
});
