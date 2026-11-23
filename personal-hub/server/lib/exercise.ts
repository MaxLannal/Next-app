// Exercise analytics: logged sets (count + instant) as bucket series and a daily average.
// Pure functions. Instants are on the wire as ISO strings; local days are day keys in the hub zone.

import { TZDate } from '@date-fns/tz';
import { rangeBounds, type Range } from './time.ts';

export type ExerciseEntry = { count: number; loggedAt: string };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Sets inside the range containing `day`, summed into its buckets: 24 hours for a day,
 * Mon–Sun for a week, one per calendar day for a month, Jan–Dec for a year.
 * Entries outside the range are ignored.
 */
export function exerciseBuckets(
  entries: ExerciseEntry[],
  range: Range,
  day: string,
  tz: string,
): { label: string; value: number }[] {
  const { start, end, days } = rangeBounds(range, day, tz);
  const values = Array.from({ length: range === 'day' ? 24 : days.length }, () => 0);
  for (const entry of entries) {
    const at = new Date(entry.loggedAt);
    if (Number.isNaN(at.getTime()) || at < start || at >= end) continue;
    const local = new TZDate(at.getTime(), tz);
    const index =
      range === 'day' ? local.getHours()
      : range === 'week' ? days.indexOf(localDayKey(local))
      : range === 'month' ? local.getDate() - 1
      : local.getMonth();
    if (index < 0) continue;
    values[index] += entry.count;
  }
  const labels =
    range === 'day' ? Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))
    : range === 'week' ? WEEKDAYS
    : range === 'month' ? days.map((key) => String(Number(key.slice(8))))
    : MONTHS;
  return labels.map((label, i) => ({ label, value: values[i] }));
}

/**
 * `total` spread over the days of the range that have elapsed by `today`, inclusive,
 * never fewer than one. A `today` outside the range gives the whole range's day count.
 */
export function dailyAverage(total: number, range: Range, day: string, today: string, tz: string): number {
  const { days } = rangeBounds(range, day, tz);
  const elapsed = days.filter((d) => d <= today).length;
  return total / Math.max(1, elapsed);
}

function localDayKey(local: TZDate): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
}
