import { describe, expect, it } from 'vitest';
import type { SleepSample, SleepStage } from '../../shared/types.ts';
import { dedupeSamples, groupNights, parseShortcutPayload } from './sleep.ts';

const TZ = 'America/Chicago';
const TARGET = 8;
const MIN = 60_000;

/** A sample from local Chicago (CST, UTC−6) wall-clock times; 01:00 local is 07:00Z. Capped at 23:59:59. */
function sample(day: string, from: string, to: string, stage: SleepStage, source = 'Watch'): SleepSample {
  const at = (hms: string) => {
    const [h, m, s = '0'] = hms.split(':').map(Number);
    return new Date(`${day}T${String(h - 6).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`).toISOString();
  };
  return { start: at(from), end: at(to), stage, source };
}

/** Consecutive stage runs from 22:00 local on `day`, one sample per run (a run may cross midnight). */
function runs(day: string, list: [number, SleepStage][], source = 'Watch'): SleepSample[] {
  const d0 = Date.parse(`${day}T22:00:00-06:00`);
  let t = 0;
  return list.map(([minutes, stage]) => {
    const sample = {
      start: new Date(d0 + t * MIN).toISOString(),
      end: new Date(d0 + (t + minutes) * MIN).toISOString(),
      stage,
      source,
    };
    t += minutes;
    return sample;
  });
}

const secs = (n: number) => n * 3600;

describe('sleepScore', () => {
  it('scores a full night', () => {
    // 22:40 in bed alone, then asleep from 23:00 to 07:00: 7 h 30 m asleep in 8 h.
    const samples = [
      sample('2026-11-21', '22:40', '22:59', 'in_bed'),
      ...runs('2026-11-21', [
        [30, 'awake'],
        [240, 'core'],
        [90, 'deep'],
        [120, 'rem'],
      ]),
    ];
    const nights = groupNights(samples, TZ, TARGET);
    // The lone in-bed minute before 23:00 is 21 Nov's own night; the sleep below is the 22nd's.
    expect(nights.map((n) => n.night)).toEqual(['2026-11-21', '2026-11-22']);
    const n = nights[1];
    expect(n.asleepSeconds).toBe(27000);
    expect(n.inBedSeconds).toBe(28800);
    expect(n.score).toBe(96);
    // In bed carries no sleep, and the lone night is not scored as a night's sleep.
    expect(nights[0].asleepSeconds).toBe(0);
  });

  it('scores a night with no stage data from total sleep and efficiency only', () => {
    const [n] = groupNights([sample('2026-11-21', '23:00', '23:59', 'asleep')], TZ, TARGET);
    expect(n.asleepSeconds).toBe(59 * 60 + 0);
    expect(n.score).toBe(Math.round(100 * (0.5 * (n.asleepSeconds / secs(8)) + 0.2) / 0.7));
  });
});

describe('groupNights', () => {
  it('groups by wake day', () => {
    const samples = [
      { start: '2026-11-22T05:40:00.000Z', end: '2026-11-22T07:00:00.000Z', stage: 'deep', source: 'Watch' } as SleepSample,
      { start: '2026-11-22T07:00:00.000Z', end: '2026-11-22T13:12:00.000Z', stage: 'core', source: 'Watch' } as SleepSample,
    ];
    const nights = groupNights(samples, TZ, TARGET);
    expect(nights.map((n) => n.night)).toEqual(['2026-11-22']);
    // Its night is the 22nd in Chicago (the sleep began at 23:40 on the 21st).
    expect(new Date(nights[0].bedtime).toISOString()).toBe('2026-11-22T05:40:00.000Z');
    expect(new Date(nights[0].wake).toISOString()).toBe('2026-11-22T13:12:00.000Z');
  });

  it('prefers the Watch source', () => {
    const watch = runs('2026-11-21', [[420, 'core']], "My Apple Watch");
    const phone = runs('2026-11-21', [[480, 'core']], 'iPhone');
    const nights = groupNights([...phone, ...watch], TZ, TARGET);
    expect(nights).toHaveLength(1);
    expect(nights[0].asleepSeconds).toBe(secs(7));
    expect(nights[0].source).toContain('Watch');
  });

  it('falls back to the most awake-for source when no Watch recorded the night', () => {
    const a = runs('2026-11-21', [[300, 'core']], 'Band');
    const b = runs('2026-11-21', [[300, 'core'], [60, 'rem']], 'iPhone');
    const [n] = groupNights([...a, ...b], TZ, TARGET);
    expect(n.asleepSeconds).toBe(secs(6));
    expect(n.source).toBe('iPhone');
  });

  it('takes in-bed as the larger of its summed runs and bedtime to wake', () => {
    const samples = [sample('2026-11-21', '22:00', '22:30', 'in_bed'), sample('2026-11-21', '23:30', '23:45', 'in_bed')];
    const [n] = groupNights(samples, TZ, TARGET);
    // Summed in-bed is 45 m, but the window is 22:00 → 23:45
    expect(n.inBedSeconds).toBe(105 * 60);
  });

  it('splits clusters at a gap of 3 h or more, and a nap stays off the night', () => {
    // 17:00–20:00 local, then a 4 h gap, then 00:00–07:00 local on the 23rd: two clusters.
    const nap = { start: '2026-11-22T23:00:00.000Z', end: '2026-11-23T02:00:00.000Z', stage: 'core' as SleepStage, source: 'Watch' };
    const night = { start: '2026-11-23T06:00:00.000Z', end: '2026-11-23T13:00:00.000Z', stage: 'core' as SleepStage, source: 'Watch' };
    const nights = groupNights([night, nap], TZ, TARGET);
    expect(nights.map((n) => n.night)).toEqual(['2026-11-22', '2026-11-23']);
    // The nap is 22 Nov (UTC−6 puts 01:00 on the 23rd) and the clean night is the 23rd.
    expect(nights[1].asleepSeconds).toBe(secs(7));
    // Under 3 h apart they are one cluster, named by its last end.
    const late = { start: '2026-11-22T23:00:00.000Z', end: '2026-11-23T01:59:00.000Z', stage: 'core' as SleepStage, source: 'Watch' };
    const joined = { start: '2026-11-23T04:58:00.000Z', end: '2026-11-23T13:00:00.000Z', stage: 'core' as SleepStage, source: 'Watch' };
    expect(groupNights([late, joined], TZ, TARGET).map((n) => n.night)).toEqual(['2026-11-23']);
  });

  it('keys two clusters ending on different days separately', () => {
    const first = [sample('2026-11-20', '22:00', '23:30', 'core')];
    const second = [{ start: '2026-11-21T05:00:00.000Z', end: '2026-11-21T13:00:00.000Z', stage: 'core', source: 'Watch' } as SleepSample];
    const nights = groupNights([...first, ...second], TZ, TARGET);
    expect(nights.map((n) => n.night)).toEqual(['2026-11-20', '2026-11-21']);
  });

  it('prefers a night that has stage detail over one without', () => {
    const watch = [{ start: '2026-11-21T05:00:00.000Z', end: '2026-11-21T13:00:00.000Z', stage: 'asleep', source: "My Apple Watch" } as SleepSample];
    const phone = [{ start: '2026-11-21T05:00:00.000Z', end: '2026-11-21T13:00:00.000Z', stage: 'core', source: 'iPhone' } as SleepSample];
    const [n] = groupNights([...phone, ...watch], TZ, TARGET);
    expect(n.source).toBe("My Apple Watch");
    expect(n.stages.unspecified).toBe(secs(8));
  });

  it('returns nights in date order', () => {
    const samples = [
      { start: '2026-11-21T05:00:00.000Z', end: '2026-11-21T13:00:00.000Z', stage: 'core', source: 'Watch' } as SleepSample,
      { start: '2026-11-19T05:00:00.000Z', end: '2026-11-19T13:00:00.000Z', stage: 'core', source: 'Watch' } as SleepSample,
    ];
    expect(groupNights(samples, TZ, TARGET).map((n) => n.night)).toEqual(['2026-11-19', '2026-11-21']);
  });

  it('returns nothing for no samples', () => {
    expect(groupNights([], TZ, TARGET)).toEqual([]);
  });
});

describe('dedupeSamples', () => {
  it('keeps one copy of a re-sent sample', () => {
    const s = sample('2026-11-21', '23:00', '23:30', 'core');
    expect(dedupeSamples([s, { ...s }, { ...s }])).toHaveLength(1);
  });

  it('keeps the same window from two sources', () => {
    const a = sample('2026-11-21', '23:00', '23:30', 'core', 'iPhone');
    const b = sample('2026-11-21', '23:00', '23:30', 'core', 'Watch');
    expect(dedupeSamples([a, b])).toHaveLength(2);
  });
});

describe('parseShortcutPayload', () => {
  const night = runs('2026-11-21', [
    [480, 'in_bed'],
    [420, 'core'],
  ]);

  it('reads a JSON body of samples', () => {
    const samples = parseShortcutPayload(JSON.stringify({ samples: night }), 'application/json');
    expect(samples).toEqual(night);
  });

  it('reads a bare JSON array with any-case stages', () => {
    const bare = [{ start: '2026-11-22T05:14:05.000Z', end: '2026-11-22T06:40:00.000Z', stage: 'CORE', source: 'Watch' }];
    expect(parseShortcutPayload(JSON.stringify(bare), 'application/json')).toEqual([{ ...bare[0], stage: 'core' }]);
  });

  it('rejects a JSON sample with an unknown stage', () => {
    const bad = JSON.stringify({ samples: [{ start: night[0].start, end: night[0].end, stage: 'nap', source: 'Watch' }] });
    expect(() => parseShortcutPayload(bad, 'application/json')).toThrow(/nap/);
  });

  it('reads a text payload', () => {
    const text = [
      '2026-11-21T23:14:05-06:00;2026-11-22T00:40:00-06:00;Core;My Apple Watch',
      '2026-11-22T00:40:00-06:00;2026-11-22T02:10:00-06:00;REM;My Apple Watch',
    ].join('\n');
    const samples = parseShortcutPayload(text, 'text/plain');
    expect(samples.map((s) => s.stage)).toEqual(['core', 'rem']);
    expect(samples[0].start).toBe('2026-11-22T05:14:05.000Z');
    expect(samples[1].end).toBe('2026-11-22T08:10:00.000Z');
    expect(samples[0].source).toBe('My Apple Watch');
  });

  it('maps parenthesised values, Awake, and In Bed', () => {
    const text = [
      '2026-11-21T23:14:05-06:00;2026-11-22T00:40:00-06:00;Asleep (Core);Watch',
      '2026-11-21T23:14:05-06:00;2026-11-22T00:40:00-06:00;In Bed;iPhone',
      '2026-11-21T23:14:05-06:00;2026-11-22T00:40:00-06:00;Awake;iPhone',
    ].join('\n');
    expect(parseShortcutPayload(text, 'text/plain').map((s) => s.stage)).toEqual(['core', 'in_bed', 'awake']);
  });

  it('skips blank lines and a header line', () => {
    const text = ['start;end;value;source', '', '2026-11-21T23:14:05-06:00;2026-11-22T00:40:00-06:00;Deep;iPhone', ''].join('\n');
    expect(parseShortcutPayload(text, 'text/plain')).toHaveLength(1);
  });

  it('rejects an unknown text stage and a bad time', () => {
    expect(() => parseShortcutPayload('2026-11-21T23:14:05-06:00;2026-11-22T00:40:00-06:00;Nap;Watch', 'text/plain')).toThrow(/Nap/);
    expect(() => parseShortcutPayload('yesterday;today;Core;Watch', 'text/plain')).toThrow(/time/i);
  });

  it('rejects a sample that ends before it starts', () => {
    expect(() => parseShortcutPayload('2026-11-22T00:40:00-06:00;2026-11-21T23:14:05-06:00;Core;Watch', 'text/plain')).toThrow(/end/i);
  });
});
