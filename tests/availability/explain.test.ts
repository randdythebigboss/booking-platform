/**
 * The settings preview has to be right, because its whole job is to be
 * believed. These pin it to the professional's own example at every grid he
 * can choose, and to the cases where the honest answer is "nothing fits".
 */
import { describe, expect, it } from 'vitest';

import { SLOT_INTERVAL_CHOICES, describeGridExample } from '@/features/availability/explain';

/** His example, verbatim: a 20-minute edge-up at 10:30, then a 40-minute cut. */
const HIS_EXAMPLE = {
  firstStartClock: '10:30',
  firstServiceMinutes: 20,
  nextServiceMinutes: 40,
};

describe('the worked example behind the start-time grid', () => {
  it('a 15-minute grid offers 11:00, with ten minutes left over', () => {
    const example = describeGridExample({ ...HIS_EXAMPLE, slotIntervalMinutes: 15 });
    expect(example).toEqual({ firstEndsClock: '10:50', nextStartClock: '11:00', gapMinutes: 10 });
  });

  it('a 10-minute grid offers 10:50 itself, with no gap', () => {
    const example = describeGridExample({ ...HIS_EXAMPLE, slotIntervalMinutes: 10 });
    expect(example).toEqual({ firstEndsClock: '10:50', nextStartClock: '10:50', gapMinutes: 0 });
  });

  it('a 5-minute grid also packs tight', () => {
    expect(describeGridExample({ ...HIS_EXAMPLE, slotIntervalMinutes: 5 })?.gapMinutes).toBe(0);
  });

  it('a 30-minute grid waits until 11:00', () => {
    const example = describeGridExample({ ...HIS_EXAMPLE, slotIntervalMinutes: 30 });
    expect(example?.nextStartClock).toBe('11:00');
    expect(example?.gapMinutes).toBe(10);
  });

  it('even an hourly grid gives 11:00 here, not noon', () => {
    // I expected noon when I wrote this and the engine said 11:00, which is
    // right: the grid is anchored to the 09:00 opening, so 11:00 is on it and
    // a 40-minute cut from 11:00 clears the 10:30 edge-up completely. The
    // "pushed to the next hour" fear in the feedback does not happen at ANY
    // of the offered grids for his example, and that is worth stating.
    const example = describeGridExample({ ...HIS_EXAMPLE, slotIntervalMinutes: 60 });
    expect(example?.nextStartClock).toBe('11:00');
    expect(example?.gapMinutes).toBe(10);
  });

  it('a gap only appears when the grid steps over the finish time', () => {
    // The thing that actually costs the professional time is a grid whose
    // steps do not land on 10:50. Thirty minutes does that; ten does not.
    const coarse = describeGridExample({ ...HIS_EXAMPLE, slotIntervalMinutes: 30 });
    const fine = describeGridExample({ ...HIS_EXAMPLE, slotIntervalMinutes: 10 });
    expect(coarse?.gapMinutes).toBe(10);
    expect(fine?.gapMinutes).toBe(0);
  });

  it('never claims a start earlier than the appointment already there', () => {
    for (const slotIntervalMinutes of SLOT_INTERVAL_CHOICES) {
      const example = describeGridExample({ ...HIS_EXAMPLE, slotIntervalMinutes });
      expect(example).not.toBeNull();
      expect(example!.gapMinutes).toBeGreaterThanOrEqual(0);
      expect(example!.nextStartClock! >= example!.firstEndsClock).toBe(true);
    }
  });

  it('says so plainly when nothing fits before closing', () => {
    const example = describeGridExample({
      slotIntervalMinutes: 15,
      firstStartClock: '17:00',
      firstServiceMinutes: 20,
      nextServiceMinutes: 120,
      closeClock: '18:00',
    });
    expect(example?.nextStartClock).toBeNull();
  });

  it('refuses inputs that do not describe a day', () => {
    expect(describeGridExample({ ...HIS_EXAMPLE, slotIntervalMinutes: 0 })).toBeNull();
    expect(describeGridExample({ ...HIS_EXAMPLE, slotIntervalMinutes: Number.NaN })).toBeNull();
    expect(
      describeGridExample({ ...HIS_EXAMPLE, slotIntervalMinutes: 15, nextServiceMinutes: 0 }),
    ).toBeNull();
  });

  it('is computed by the engine, so a longer service is never easier to place', () => {
    const short = describeGridExample({
      ...HIS_EXAMPLE,
      slotIntervalMinutes: 15,
      nextServiceMinutes: 30,
    });
    const long = describeGridExample({
      ...HIS_EXAMPLE,
      slotIntervalMinutes: 15,
      nextServiceMinutes: 240,
    });
    expect(short?.nextStartClock).toBe('11:00');
    // Four hours from 10:50 still fits before 18:00, but never sooner.
    expect(long!.nextStartClock! >= short!.nextStartClock!).toBe(true);
  });
});
