// Time analytics: focus time from timer events, local days, ranges, heatmap levels and streaks.
// Pure functions. Instants are Dates; local days are "YYYY-MM-DD" day keys in the hub time zone.

import { TZDate } from '@date-fns/tz';
import { focusIntervals, type Interval } from '../../shared/focusIntervals.ts';
import type { SessionEvent } from '../../shared/types.ts';

// Focus intervals live in shared/ so the web app draws a session's stretches the same way.
export { focusIntervals, type Interval };

export type Range = 'day' | 'week' | 'month' | 'year';

export function focusSeconds(events: SessionEvent[], now: Date): number {
  const ms = focusIntervals(events, now).reduce((sum, i) => sum + (i.end.getTime() - i.start.getTime()), 0);
  return Math.round(ms / 1000);
}

const HOUR_MS = 3_600_000;
const knownZones = new Set<string>();

/** Throws a RangeError unless Intl knows `tz`. Each zone is checked once. */
export function assertTimeZone(tz: string): void {
  if (knownZones.has(tz)) return;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    throw new RangeError(`Unknown time zone: ${tz}`);
  }
  knownZones.add(tz);
}

/** The local day an instant falls on. Independent of the process time zone. */
export function dayKey(d: Date, tz: string): string {
  assertTimeZone(tz);
  // Built from a timestamp, TZDate reads the wall clock through Intl and UTC getters only.
  const local = new TZDate(d.getTime(), tz);
  return formatDay(local.getFullYear(), local.getMonth() + 1, local.getDate());
}

/**
 * The first instant of a local day: local midnight, the first instant after it if a DST jump
 * skips it, or the first of the two if a fall-back repeats it. Independent of the process time zone.
 */
export function dayStart(day: string, tz: string): Date {
  assertTimeZone(tz);
  const { y, m, d } = parseDay(day);
  // Built from fields, TZDate goes through the process zone's Date setters, so near a DST change
  // it can be an hour off or pick the second of two midnights. Keep it only if dayKey agrees.
  const guess = new TZDate(y, m - 1, d, tz).getTime();
  const keyAt = (t: number) => dayKey(new Date(t), tz);
  if (keyAt(guess) === day && keyAt(guess - 1) !== day) return new Date(guess);
  // Otherwise binary-search the first millisecond whose day is `day` or later
  // (day keys compare chronologically as strings).
  let lo = guess - 3 * HOUR_MS;
  let hi = guess + 3 * HOUR_MS;
  if (keyAt(lo) >= day || keyAt(hi) < day) throw new Error(`dayStart could not find the start of ${day} in ${tz}`);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (keyAt(mid) >= day) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

/** Calendar arithmetic on day keys; no time zone is involved. */
export function addDays(day: string, n: number): string {
  const { y, m, d } = parseDay(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Seconds of each interval that fall on each local day, keyed by day. */
export function splitByDay(intervals: Interval[], tz: string): Map<string, number> {
  const ms = new Map<string, number>();
  for (const { start, end } of intervals) {
    let cursor = start;
    while (cursor < end) {
      const day = dayKey(cursor, tz);
      const next = dayStart(addDays(day, 1), tz);
      if (next <= cursor) throw new Error(`splitByDay made no progress at ${cursor.toISOString()} in ${tz}`);
      const segmentEnd = next < end ? next : end;
      ms.set(day, (ms.get(day) ?? 0) + (segmentEnd.getTime() - cursor.getTime()));
      cursor = segmentEnd;
    }
  }
  return new Map([...ms].map(([day, total]) => [day, Math.round(total / 1000)]));
}

/** The range containing `day`. Weeks run Monday to Sunday; `end` is exclusive. */
export function rangeBounds(range: Range, day: string, tz: string): { start: Date; end: Date; days: string[] } {
  const { y, m, d } = parseDay(day);
  let first: string;
  let after: string;
  if (range === 'day') {
    first = day;
    after = addDays(day, 1);
  } else if (range === 'week') {
    const sinceMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    first = addDays(day, -sinceMonday);
    after = addDays(first, 7);
  } else if (range === 'month') {
    first = formatDay(y, m, 1);
    after = m === 12 ? formatDay(y + 1, 1, 1) : formatDay(y, m + 1, 1);
  } else {
    first = formatDay(y, 1, 1);
    after = formatDay(y + 1, 1, 1);
  }
  const days: string[] = [];
  for (let d = first; d !== after; d = addDays(d, 1)) days.push(d);
  return { start: dayStart(first, tz), end: dayStart(after, tz), days };
}

/** The parts of each interval inside [start, end). Empty parts are dropped. */
export function clip(intervals: Interval[], start: Date, end: Date): Interval[] {
  const out: Interval[] = [];
  for (const i of intervals) {
    const s = i.start > start ? i.start : start;
    const e = i.end < end ? i.end : end;
    if (s < e) out.push({ start: s, end: e });
  }
  return out;
}

/** Heatmap cell level for a day's focus seconds: >0, ≥30 m, ≥1 h, ≥2 h, ≥4 h. */
export function heatmapLevel(seconds: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (seconds >= 14400) return 5;
  if (seconds >= 7200) return 4;
  if (seconds >= 3600) return 3;
  if (seconds >= 1800) return 2;
  if (seconds > 0) return 1;
  return 0;
}

/** Longest run of consecutive active days, and the run ending today (or yesterday if today is inactive). */
export function streaks(activeDays: Set<string>, today: string): { longest: number; current: number } {
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of [...activeDays].sort()) {
    run = prev !== null && addDays(prev, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }
  let current = 0;
  let cursor = activeDays.has(today) ? today : addDays(today, -1);
  while (activeDays.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { longest, current };
}

function parseDay(day: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match) {
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d) return { y, m, d };
  }
  throw new RangeError(`Invalid day key: ${day}`);
}

function formatDay(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
