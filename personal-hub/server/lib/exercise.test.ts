import { expect, it } from 'vitest';
import { dailyAverage, exerciseBuckets } from './exercise.ts';

// 08:15, 08:50 and 19:00 on Sunday 22 November in Chicago; the last one is Monday 23 there.
const ENTRIES = [
  { count: 10, loggedAt: '2026-11-22T14:15:00.000Z' },
  { count: 20, loggedAt: '2026-11-22T14:50:00.000Z' },
  { count: 15, loggedAt: '2026-11-23T01:00:00.000Z' },
];
const TZ = 'America/Chicago';

it('day buckets by hour', () => {
  const buckets = exerciseBuckets(ENTRIES, 'day', '2026-11-22', TZ);
  expect(buckets).toHaveLength(24);
  expect(buckets.map((b) => b.label)).toEqual(Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')));
  expect(buckets[8]).toEqual({ label: '08', value: 30 });
  expect(buckets[19]).toEqual({ label: '19', value: 15 });
  expect(buckets.reduce((sum, b) => sum + b.value, 0)).toBe(45);
});

it('week buckets', () => {
  const buckets = exerciseBuckets(ENTRIES, 'week', '2026-11-22', TZ);
  expect(buckets.map((b) => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  expect(buckets[6]).toEqual({ label: 'Sun', value: 45 });
  expect(buckets.slice(0, 6).every((b) => b.value === 0)).toBe(true);
});

it('year buckets', () => {
  const buckets = exerciseBuckets(ENTRIES, 'year', '2026-11-22', TZ);
  expect(buckets).toHaveLength(12);
  expect(buckets.map((b) => b.label)).toEqual([
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]);
  expect(buckets[10]).toEqual({ label: 'Nov', value: 45 });
  expect(buckets.filter((b) => b.value !== 0)).toHaveLength(1);
});

it('month buckets one per day', () => {
  const buckets = exerciseBuckets(ENTRIES, 'month', '2026-11-22', TZ);
  expect(buckets).toHaveLength(30);
  expect(buckets[0].label).toBe('1');
  expect(buckets[29].label).toBe('30');
  expect(buckets[21]).toEqual({ label: '22', value: 45 });
  const leap = exerciseBuckets([], 'month', '2028-02-10', TZ);
  expect(leap).toHaveLength(29);
  expect(leap[28].label).toBe('29');
});

it('ignores entries outside the range and handles none', () => {
  expect(exerciseBuckets([], 'day', '2026-11-22', TZ).every((b) => b.value === 0)).toBe(true);
  // 2026-11-22T05:30Z is 23:30 on 11-21 in Chicago
  const buckets = exerciseBuckets([{ count: 7, loggedAt: '2026-11-22T05:30:00.000Z' }], 'day', '2026-11-22', TZ);
  expect(buckets.every((b) => b.value === 0)).toBe(true);
});

it('average over elapsed days', () => {
  // Sunday closes the week, so all 7 days have elapsed.
  expect(dailyAverage(45, 'week', '2026-11-22', '2026-11-22', TZ)).toBe(45 / 7);
  // The 22nd is the 22nd day of November.
  expect(dailyAverage(45, 'month', '2026-11-22', '2026-11-22', TZ)).toBe(45 / 22);
  expect(dailyAverage(45, 'day', '2026-11-22', '2026-11-22', TZ)).toBe(45);
  expect(dailyAverage(10, 'week', '2026-11-22', '2026-11-18', TZ)).toBe(10 / 3);
  // A later day never inflates the divisor past the range.
  expect(dailyAverage(10, 'week', '2026-11-22', '2026-12-01', TZ)).toBe(10 / 7);
  // A day before the range counts as one day, never zero.
  expect(dailyAverage(10, 'week', '2026-11-22', '2026-11-01', TZ)).toBe(10 / 1);
  expect(dailyAverage(45, 'year', '2026-11-22', '2026-11-22', TZ)).toBe(45 / 326);
});
