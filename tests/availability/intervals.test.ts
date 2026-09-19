import { describe, expect, it } from 'vitest';

import { contains, normalize, overlaps, subtract } from '@/features/availability/intervals';

describe('overlaps', () => {
  it('treats intervals as half-open, so touching is not overlapping', () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
    expect(overlaps({ start: 0, end: 11 }, { start: 10, end: 20 })).toBe(true);
  });
});

describe('contains', () => {
  it('accepts an interval flush with both edges', () => {
    expect(contains({ start: 0, end: 10 }, { start: 0, end: 10 })).toBe(true);
    expect(contains({ start: 0, end: 10 }, { start: 0, end: 11 })).toBe(false);
  });
});

describe('normalize', () => {
  it('sorts, merges touching intervals and drops empty ones', () => {
    expect(
      normalize([
        { start: 30, end: 40 },
        { start: 0, end: 10 },
        { start: 10, end: 20 },
        { start: 50, end: 50 },
      ]),
    ).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 40 },
    ]);
  });

  it('does not mutate its input', () => {
    const input = [{ start: 0, end: 10 }];
    normalize(input)[0]!.end = 999;
    expect(input[0]!.end).toBe(10);
  });
});

describe('subtract', () => {
  it('punches a hole in the middle', () => {
    expect(subtract([{ start: 0, end: 100 }], [{ start: 40, end: 60 }])).toEqual([
      { start: 0, end: 40 },
      { start: 60, end: 100 },
    ]);
  });

  it('clips cuts that hang over the edges', () => {
    expect(subtract([{ start: 0, end: 100 }], [{ start: -50, end: 10 }])).toEqual([
      { start: 10, end: 100 },
    ]);
  });

  it('returns nothing when the cut swallows the window', () => {
    expect(subtract([{ start: 0, end: 100 }], [{ start: 0, end: 100 }])).toEqual([]);
  });

  it('applies every cut across every window', () => {
    expect(
      subtract(
        [
          { start: 0, end: 50 },
          { start: 60, end: 120 },
        ],
        [
          { start: 10, end: 20 },
          { start: 70, end: 80 },
        ],
      ),
    ).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 50 },
      { start: 60, end: 70 },
      { start: 80, end: 120 },
    ]);
  });
});
