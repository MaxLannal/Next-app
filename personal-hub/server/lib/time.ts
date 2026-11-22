// Time analytics: focus time from timer events, local days, ranges, heatmap levels and streaks.
// Pure functions. Instants are Dates; local days are "YYYY-MM-DD" day keys in the hub time zone.

import { TZDate } from '@date-fns/tz';
import type { SessionEvent } from '../../shared/types.ts';

export type Interval = { start: Date; end: Date };

export type Range = 'day' | 'week' | 'month' | 'year';

/**
 * Focus intervals: each opens on start/resume and closes on pause/stop. An open one ends at `now`.
 * Stop is final: events after the first stop are ignored.
 */
export function focusIntervals(events: SessionEvent[], now: Date): Interval[] {
  const sorted = events
    .map((e) => ({ type: e.type, at: new Date(e.at) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: Interval[] = [];
  let open: Date | null = null;
  for (const e of sorted) {
    if (e.type === 'start' || e.type === 'resume') {
      open ??= e.at;
    } else if (open) {
      if (e.at > open) out.push({ start: open, end: e.at });
      open = null;
    }
    if (e.type === 'stop') break;
  }
  if (open && now > open) out.push({ start: open, end: now });
  return out;
}

export function focusSeconds(events: SessionEvent[], now: Date): number {
  const ms = focusIntervals(events, now).reduce((sum, i) => sum + (i.end.getTime() - i.start.getTime()), 0);
  return Math.round(ms / 1000);
}

/** The local day an instant falls on. */
export function dayKey(d: Date, tz: string): string {
  const local = new TZDate(d.getTime(), tz);
  return formatDay(local.getFullYear(), local.getMonth() + 1, local.getDate());
}

/** The instant a local day begins (local midnight, or the first instant after it if a DST jump skips it). */
export function dayStart(day: string, tz: string): Date {
  const { y, m, d } = parseDay(day);
  return new Date(new TZDate(y, m - 1, d, tz).getTime());
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
