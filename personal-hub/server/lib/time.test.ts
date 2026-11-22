import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../../shared/types.ts';
import {
  addDays,
  assertTimeZone,
  clip,
  dayKey,
  dayStart,
  focusIntervals,
  focusSeconds,
  heatmapLevel,
  rangeBounds,
  splitByDay,
  streaks,
} from './time.ts';

const TZ = 'America/Chicago';
const ev = (type: SessionEvent['type'], at: string): SessionEvent => ({ type, at });
const interval = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) });

/** Runs `fn` with the process time zone set to `tz`. Node applies a changed TZ immediately. */
function withProcessTZ(tz: string, fn: () => void) {
  const saved = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
}

describe('focus time', () => {
  it('pauses are excluded', () => {
    const events = [
      ev('start', '2026-11-22T15:00:00Z'),
      ev('pause', '2026-11-22T15:30:00Z'),
      ev('resume', '2026-11-22T15:40:00Z'),
      ev('stop', '2026-11-22T16:10:00Z'),
    ];
    expect(focusSeconds(events, new Date('2026-11-22T18:00:00Z'))).toBe(3600);
    expect(focusIntervals(events, new Date('2026-11-22T18:00:00Z'))).toEqual([
      interval('2026-11-22T15:00:00Z', '2026-11-22T15:30:00Z'),
      interval('2026-11-22T15:40:00Z', '2026-11-22T16:10:00Z'),
    ]);
  });

  it('running counts to now', () => {
    const events = [ev('start', '2026-11-22T17:35:00Z')];
    expect(focusSeconds(events, new Date('2026-11-22T18:00:00Z'))).toBe(1500);
  });

  it('paused counts to the pause', () => {
    const events = [ev('start', '2026-11-22T17:00:00Z'), ev('pause', '2026-11-22T17:20:00Z')];
    expect(focusSeconds(events, new Date('2026-11-22T18:00:00Z'))).toBe(1200);
  });

  it('stop is final', () => {
    const events = [
      ev('start', '2026-11-22T15:00:00Z'),
      ev('stop', '2026-11-22T16:00:00Z'),
      ev('resume', '2026-11-22T16:30:00Z'),
    ];
    expect(focusSeconds(events, new Date('2026-11-22T18:00:00Z'))).toBe(3600);
  });

  it('orders events by time before pairing them', () => {
    const events = [
      ev('stop', '2026-11-22T16:10:00Z'),
      ev('resume', '2026-11-22T15:40:00Z'),
      ev('start', '2026-11-22T15:00:00Z'),
      ev('pause', '2026-11-22T15:30:00Z'),
    ];
    expect(focusSeconds(events, new Date('2026-11-22T18:00:00Z'))).toBe(3600);
  });
});

describe('days', () => {
  it('splits at local midnight', () => {
    const split = splitByDay([interval('2026-11-22T05:30:00Z', '2026-11-22T06:45:00Z')], TZ);
    expect(Object.fromEntries(split)).toEqual({ '2026-11-21': 1800, '2026-11-22': 2700 });
  });

  it('handles the DST fall-back day', () => {
    const split = splitByDay([interval('2026-11-01T05:30:00Z', '2026-11-01T08:30:00Z')], TZ);
    expect(Object.fromEntries(split)).toEqual({ '2026-11-01': 10800 });
  });

  it('a whole DST spring-forward day is 23 hours', () => {
    const split = splitByDay([{ start: dayStart('2026-03-08', TZ), end: dayStart('2026-03-09', TZ) }], TZ);
    expect(Object.fromEntries(split)).toEqual({ '2026-03-08': 82800 });
  });

  it('keys an instant by its local day', () => {
    expect(dayKey(new Date('2026-11-22T05:59:59Z'), TZ)).toBe('2026-11-21');
    expect(dayKey(new Date('2026-11-22T06:00:00Z'), TZ)).toBe('2026-11-22');
    expect(dayStart('2026-11-22', TZ).toISOString()).toBe('2026-11-22T06:00:00.000Z');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('rejects a malformed day key', () => {
    expect(() => dayStart('2026-11-31', TZ)).toThrow(RangeError);
    expect(() => addDays('22/11/2026', 1)).toThrow(RangeError);
  });

  it('a whole DST fall-back day is 25 hours', () => {
    const split = splitByDay([{ start: dayStart('2026-11-01', TZ), end: dayStart('2026-11-02', TZ) }], TZ);
    expect(Object.fromEntries(split)).toEqual({ '2026-11-01': 90000 });
  });

  it('rejects an unknown time zone', () => {
    expect(() => assertTimeZone('Not/AZone')).toThrow(RangeError);
    expect(() => dayKey(new Date('2026-11-22T18:00:00Z'), 'Not/AZone')).toThrow(RangeError);
    expect(() => dayStart('2026-11-22', 'Not/AZone')).toThrow(RangeError);
    expect(() => assertTimeZone(TZ)).not.toThrow();
  });
});

describe('days do not depend on the process time zone', () => {
  it('London spring-forward while the process runs in America/Godthab', () => {
    withProcessTZ('America/Godthab', () => {
      // London 2024-03-31: 00:00 GMT is 00:00Z; clocks jump 01:00 GMT → 02:00 BST.
      expect(dayStart('2024-03-31', 'Europe/London').toISOString()).toBe('2024-03-31T00:00:00.000Z');
      const split = splitByDay([interval('2024-03-30T22:00:00Z', '2024-03-31T02:00:00Z')], 'Europe/London');
      expect(Object.fromEntries(split)).toEqual({ '2024-03-30': 7200, '2024-03-31': 7200 });
    });
  });

  it('Santiago fall-back at midnight while the process runs in Australia/Sydney', () => {
    withProcessTZ('Australia/Sydney', () => {
      // Santiago 2024-04-07: at 03:00Z clocks fall back 24:00 (-03) → 23:00 (-04), so 6 April
      // runs 23:00–24:00 twice and 7 April begins at 00:00 -04 = 04:00Z.
      //   02:00Z–03:00Z  6 Apr 23:00–24:00 (-03)  3600 s
      //   03:00Z–04:00Z  6 Apr 23:00–24:00 (-04)  3600 s  → 6 Apr 7200
      //   04:00Z–06:00Z  7 Apr 00:00–02:00 (-04)  7200 s  → 7 Apr 7200
      expect(dayStart('2024-04-07', 'America/Santiago').toISOString()).toBe('2024-04-07T04:00:00.000Z');
      const split = splitByDay([interval('2024-04-07T02:00:00Z', '2024-04-07T06:00:00Z')], 'America/Santiago');
      expect(Object.fromEntries(split)).toEqual({ '2024-04-06': 7200, '2024-04-07': 7200 });
    });
  });

  it('a repeated midnight starts the day at the first one', () => {
    withProcessTZ('America/Chicago', () => {
      // Checked with Intl: Azores falls back 01:00 (+00) → 00:00 (-01) on 2026-10-25, so local
      // midnight is both 00:00Z and 01:00Z. Havana falls back 01:00 (-04) → 00:00 (-05) on
      // 2026-11-01, so local midnight is both 04:00Z and 05:00Z.
      expect(dayStart('2026-10-25', 'Atlantic/Azores').toISOString()).toBe('2026-10-25T00:00:00.000Z');
      expect(dayStart('2026-11-01', 'America/Havana').toISOString()).toBe('2026-11-01T04:00:00.000Z');
    });
  });
});

describe('ranges', () => {
  it('week bounds', () => {
    const week = rangeBounds('week', '2026-11-22', TZ);
    expect(week.start.toISOString()).toBe('2026-11-16T06:00:00.000Z');
    expect(week.end.toISOString()).toBe('2026-11-23T06:00:00.000Z');
    expect(week.days.length).toBe(7);
    expect(week.days[0]).toBe('2026-11-16');
  });

  it('year bounds', () => {
    expect(rangeBounds('year', '2026-11-22', TZ).days.length).toBe(365);
  });

  it('month bounds span the DST change', () => {
    const month = rangeBounds('month', '2026-11-22', TZ);
    expect(month.start.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(month.end.toISOString()).toBe('2026-12-01T06:00:00.000Z');
    expect(month.days.length).toBe(30);
    expect(month.days.at(-1)).toBe('2026-11-30');
  });

  it('day bounds', () => {
    const day = rangeBounds('day', '2026-11-22', TZ);
    expect(day.start.toISOString()).toBe('2026-11-22T06:00:00.000Z');
    expect(day.end.toISOString()).toBe('2026-11-23T06:00:00.000Z');
    expect(day.days).toEqual(['2026-11-22']);
  });

  it('clips intervals to a range', () => {
    const week = rangeBounds('week', '2026-11-22', TZ);
    const clipped = clip(
      [
        interval('2026-11-16T05:00:00Z', '2026-11-16T07:00:00Z'),
        interval('2026-11-20T12:00:00Z', '2026-11-20T13:00:00Z'),
        interval('2026-11-23T06:00:00Z', '2026-11-23T07:00:00Z'),
      ],
      week.start,
      week.end,
    );
    expect(clipped).toEqual([
      interval('2026-11-16T06:00:00Z', '2026-11-16T07:00:00Z'),
      interval('2026-11-20T12:00:00Z', '2026-11-20T13:00:00Z'),
    ]);
  });
});

describe('heatmap and streaks', () => {
  it('heatmapLevel thresholds', () => {
    const levels = [0, 1, 1799, 1800, 3600, 7200, 14400].map(heatmapLevel);
    expect(levels).toEqual([0, 1, 1, 2, 3, 4, 5]);
  });

  it('streaks', () => {
    const days = (...ds: number[]) => new Set(ds.map((d) => `2026-11-${d}`));
    expect(streaks(days(18, 19, 20, 22), '2026-11-22')).toEqual({ longest: 3, current: 1 });
    expect(streaks(days(20, 21), '2026-11-22')).toEqual({ longest: 2, current: 2 });
    expect(streaks(new Set(), '2026-11-22')).toEqual({ longest: 0, current: 0 });
  });

  it('streaks run across month and year ends', () => {
    const active = new Set(['2026-12-30', '2026-12-31', '2027-01-01']);
    expect(streaks(active, '2027-01-01')).toEqual({ longest: 3, current: 3 });
  });
});
