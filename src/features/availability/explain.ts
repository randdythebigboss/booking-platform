import { computeAvailableSlots } from './slots';
import type { IsoDate } from '@/types/domain';

/**
 * Answers the question the professional actually asked, with the real engine.
 *
 * The feedback was "a customer books a 20-minute edge-up at 10:30, the next
 * wants a 40-minute haircut -- what happens?". That is a question about the
 * start-time grid, and a settings screen that answers it with the number 15
 * has not answered it.
 *
 * So the preview is COMPUTED, by `computeAvailableSlots`, on a fabricated day
 * with one fabricated appointment. It is not a table of sentences written by
 * hand next to the real code and free to disagree with it: if the grid ever
 * changes, this moves with it or the tests here fail.
 *
 * Nothing in here touches the database or the professional's real calendar.
 */

/** A Monday far from any daylight-saving edge, used only to do the sum. */
const EXAMPLE_DATE: IsoDate = '2026-10-05';
const EXAMPLE_TZ = 'UTC';
/** Midnight on the example day: earlier than any slot, so notice never bites. */
const EXAMPLE_NOW = new Date(`${EXAMPLE_DATE}T00:00:00.000Z`);

export interface GridExampleInput {
  slotIntervalMinutes: number;
  /** The appointment already in the calendar. */
  firstStartClock: string;
  firstServiceMinutes: number;
  /** The service the next customer wants. */
  nextServiceMinutes: number;
  /** The working day the example pretends to have. */
  openClock?: string;
  closeClock?: string;
}

export interface GridExample {
  /** When the existing appointment finishes. */
  firstEndsClock: string;
  /** The first start the grid actually offers afterwards, or null if none. */
  nextStartClock: string | null;
  /** Minutes between the two. Zero means the day packs with no gap. */
  gapMinutes: number;
}

function clockToMinutes(clock: string): number {
  const [h, m] = clock.split(':');
  return Number(h) * 60 + Number(m);
}

function minutesToClock(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Works out what the configured grid does to one concrete pair of bookings.
 *
 * Returns null only when the inputs cannot describe a day at all; a grid that
 * genuinely offers nothing after the first appointment returns a result with
 * `nextStartClock: null`, which is a finding and not an error.
 */
export function describeGridExample(input: GridExampleInput): GridExample | null {
  const {
    slotIntervalMinutes,
    firstStartClock,
    firstServiceMinutes,
    nextServiceMinutes,
    openClock = '09:00',
    closeClock = '18:00',
  } = input;

  if (!Number.isFinite(slotIntervalMinutes) || slotIntervalMinutes <= 0) return null;
  if (!Number.isFinite(firstServiceMinutes) || firstServiceMinutes <= 0) return null;
  if (!Number.isFinite(nextServiceMinutes) || nextServiceMinutes <= 0) return null;

  const firstStart = clockToMinutes(firstStartClock);
  const firstEnd = firstStart + firstServiceMinutes;
  const firstEndsClock = minutesToClock(firstEnd);

  const dayStart = Date.parse(`${EXAMPLE_DATE}T00:00:00.000Z`);
  const busyStart = new Date(dayStart + firstStart * 60_000);
  const busyEnd = new Date(dayStart + firstEnd * 60_000);

  const slots = computeAvailableSlots({
    date: EXAMPLE_DATE,
    timezone: EXAMPLE_TZ,
    now: EXAMPLE_NOW,
    service: {
      durationMinutes: nextServiceMinutes,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    },
    // weekday 1 is Monday, which EXAMPLE_DATE is.
    rules: [{ weekday: 1, startTime: openClock, endTime: closeClock }],
    exceptions: [],
    busy: [{ startsAt: busyStart, endsAt: busyEnd }],
    policy: {
      slotIntervalMinutes,
      minimumNoticeMinutes: 0,
      bookingHorizonDays: 365,
    },
  });

  const next = slots.find((slot) => slot.startsAt.getTime() >= busyEnd.getTime());
  if (!next) {
    return { firstEndsClock, nextStartClock: null, gapMinutes: 0 };
  }

  const nextStartMinutes = Math.round((next.startsAt.getTime() - dayStart) / 60_000);
  return {
    firstEndsClock,
    nextStartClock: minutesToClock(nextStartMinutes),
    gapMinutes: nextStartMinutes - firstEnd,
  };
}

/** The start-time grids offered in Settings. Minutes. */
export const SLOT_INTERVAL_CHOICES = [5, 10, 15, 20, 30, 60] as const;
