import { instantAt, localDay } from '../../../lib/format.ts';

/** The day key `n` days on from `day`, by the local calendar (noon keeps a DST change out of it). */
function dayAfter(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y!, m! - 1, d! + n, 12).toISOString());
}

/**
 * A start typed as a time of day: the last moment before `end` whose clock reads `time`. So 23:00
 * typed against an end at 02:00 is the night before, and a start can't land after its end.
 * Null when `time` isn't a time.
 */
export function startBefore(time: string, end: Date): Date | null {
  const day = localDay(end.toISOString());
  for (const back of [0, 1]) {
    const at = instantAt(dayAfter(day, -back), time);
    if (at === null) return null;
    if (at.getTime() < end.getTime()) return at;
  }
  return null;
}

/**
 * An end typed as a time of day: the first moment after `start` whose clock reads `time`. So 02:00
 * typed after a start at 23:00 is the next morning, and an end can't land before its start.
 * Null when `time` isn't a time.
 */
export function endAfter(time: string, start: Date): Date | null {
  const day = localDay(start.toISOString());
  for (const ahead of [0, 1]) {
    const at = instantAt(dayAfter(day, ahead), time);
    if (at === null) return null;
    if (at.getTime() > start.getTime()) return at;
  }
  return null;
}
