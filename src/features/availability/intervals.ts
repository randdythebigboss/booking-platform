/**
 * Interval arithmetic over epoch milliseconds.
 *
 * Deliberately free of any date library: this is the part of the availability
 * engine that has to be obviously correct, so it stays small and pure.
 */

export interface Interval {
  /** Inclusive start, epoch milliseconds. */
  start: number;
  /** Exclusive end, epoch milliseconds. */
  end: number;
}

/** Half-open overlap test: `[a.start, a.end)` against `[b.start, b.end)`. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** True when `inner` fits entirely inside `outer`. */
export function contains(outer: Interval, inner: Interval): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

/** Drops empty intervals, sorts by start, and merges anything touching. */
export function normalize(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);

  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/** Returns `base` minus every interval in `cuts`. */
export function subtract(base: readonly Interval[], cuts: readonly Interval[]): Interval[] {
  const holes = normalize(cuts);
  const result: Interval[] = [];

  for (const window of normalize(base)) {
    let cursor = window.start;

    for (const hole of holes) {
      if (hole.end <= cursor) continue;
      if (hole.start >= window.end) break;

      if (hole.start > cursor) {
        result.push({ start: cursor, end: Math.min(hole.start, window.end) });
      }
      cursor = Math.max(cursor, hole.end);
      if (cursor >= window.end) break;
    }

    if (cursor < window.end) {
      result.push({ start: cursor, end: window.end });
    }
  }

  return result;
}
