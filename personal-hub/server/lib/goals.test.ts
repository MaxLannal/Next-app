import { expect, it } from 'vitest';
import { addDays, dayKey } from './time.ts';
import { estimateAccuracy, goalProgress, type GoalPlan } from './goals.ts';

const TODAY = '2026-11-22';
const HOUR = 3600;

/** Progress for a goal created 30 days ago unless `createdDay` says otherwise. */
function progress(over: Partial<Parameters<typeof goalProgress>[0]> = {}) {
  return goalProgress({
    plan: { deadline: null, plannedMinutes: null },
    createdDay: '2026-10-23',
    focusedSeconds: 0,
    last14Seconds: 0,
    today: TODAY,
    ...over,
  });
}

it('hours only: the bar is work done over the plan, and the pace projects a finish', () => {
  const p = progress({ plan: { deadline: null, plannedMinutes: 600 }, focusedSeconds: 6 * HOUR, last14Seconds: 14 * HOUR });
  expect(p).toEqual({
    mode: 'hours',
    fraction: 0.6,
    fractionKind: 'work',
    projectedFinish: '2026-11-26',
    noRecentPace: false,
    atRisk: false,
  });
});

it('hours only: the fraction is capped at 1', () => {
  const p = progress({ plan: { deadline: null, plannedMinutes: 600 }, focusedSeconds: 12 * HOUR, last14Seconds: 0 });
  expect(p.fraction).toBe(1);
  expect(p.fractionKind).toBe('work');
});

it('no recent pace: no projection, and the row says so', () => {
  const p = progress({ plan: { deadline: null, plannedMinutes: 600 }, focusedSeconds: 6 * HOUR, last14Seconds: 0 });
  expect(p.noRecentPace).toBe(true);
  expect(p.projectedFinish).toBeNull();
  expect(p.fraction).toBe(0.6);
  expect(p.atRisk).toBe(false);
});

it('deadline only: the bar shows time elapsed and never a percentage of work', () => {
  const p = progress({ plan: { deadline: '2026-12-02', plannedMinutes: null }, createdDay: '2026-11-12' });
  expect(p.mode).toBe('deadline');
  expect(p.fraction).toBe(0.5);
  expect(p.fractionKind).toBe('time');
  expect(p.projectedFinish).toBeNull();
  expect(p.noRecentPace).toBe(false);
  expect(p.atRisk).toBe(false);
  // Three days before the deadline it turns at risk.
  expect(progress({ plan: { deadline: '2026-12-02', plannedMinutes: null }, createdDay: '2026-11-12', today: '2026-11-29' }).atRisk).toBe(true);
  expect(progress({ plan: { deadline: '2026-12-02', plannedMinutes: null }, createdDay: '2026-11-12', today: '2026-11-28' }).atRisk).toBe(false);
});

it('deadline only: the elapsed fraction clamps to 0 and 1', () => {
  const plan: GoalPlan = { deadline: '2026-12-02', plannedMinutes: null };
  expect(progress({ plan, createdDay: '2026-12-01' }).fraction).toBe(0);
  expect(progress({ plan, createdDay: '2026-11-12', today: '2026-12-20' }).fraction).toBe(1);
});

it('both, late: a projection after the deadline is at risk', () => {
  const p = progress({
    plan: { deadline: '2026-11-25', plannedMinutes: 600 },
    focusedSeconds: 6 * HOUR,
    last14Seconds: 14 * HOUR,
  });
  expect(p.mode).toBe('both');
  expect(p.fraction).toBe(0.6);
  expect(p.fractionKind).toBe('work');
  expect(p.projectedFinish).toBe('2026-11-26');
  expect(p.atRisk).toBe(true);
});

it('both, on time: a projection on the deadline is not at risk', () => {
  const p = progress({
    plan: { deadline: '2026-11-26', plannedMinutes: 600 },
    focusedSeconds: 6 * HOUR,
    last14Seconds: 14 * HOUR,
  });
  expect(p.atRisk).toBe(false);
});

it('both, no pace, close deadline: at risk within 7 days', () => {
  const base = { plan: { deadline: '2026-11-28', plannedMinutes: 600 }, focusedSeconds: 6 * HOUR, last14Seconds: 0 };
  expect(progress(base).atRisk).toBe(true);
  // Seven days left still counts as close; eight does not.
  expect(progress({ ...base, plan: { deadline: '2026-11-29', plannedMinutes: 600 } }).atRisk).toBe(true);
  expect(progress({ ...base, plan: { deadline: '2026-11-30', plannedMinutes: 600 } }).atRisk).toBe(false);
});

it('no plan: nothing to measure', () => {
  expect(progress()).toEqual({
    mode: 'none',
    fraction: null,
    fractionKind: null,
    projectedFinish: null,
    noRecentPace: false,
    atRisk: false,
  });
});

it('accuracy: hours and dates are medians over the goals with that original plan', () => {
  const goals = [
    // planned 10 h, took 14 h → 1.4
    { original: { deadline: null, plannedMinutes: 600 }, createdDay: '2026-11-01', doneDay: '2026-11-05', actualSeconds: 14 * HOUR },
    // planned 5 h, took 5 h → 1.0
    { original: { deadline: null, plannedMinutes: 300 }, createdDay: '2026-11-02', doneDay: '2026-11-03', actualSeconds: 5 * HOUR },
    // planned 2 h, took 2.8 h → 1.4; two of 1.4 make the median even
    { original: { deadline: null, plannedMinutes: 120 }, createdDay: '2026-11-02', doneDay: '2026-11-04', actualSeconds: 2.8 * HOUR },
    // created 11-01, planned 10 days, took 14 → 1.4; planned 20 h, took 30 → 1.5
    { original: { deadline: '2026-11-11', plannedMinutes: 1200 }, createdDay: '2026-11-01', doneDay: '2026-11-15', actualSeconds: 30 * HOUR },
  ];
  expect(estimateAccuracy(goals)).toEqual({ hours: 1.4, dates: 1.4, count: 4 });
});

it('accuracy: one date goal alone reads 1.4', () => {
  const dates = estimateAccuracy([
    { original: { deadline: '2026-11-11', plannedMinutes: null }, createdDay: '2026-11-01', doneDay: '2026-11-15', actualSeconds: 0 },
  ]);
  expect(dates).toEqual({ hours: null, dates: 1.4, count: 1 });
});

it('accuracy: nothing to measure is null, not a guess', () => {
  expect(estimateAccuracy([])).toEqual({ hours: null, dates: null, count: 0 });
  const unplanned = estimateAccuracy([
    { original: { deadline: null, plannedMinutes: null }, createdDay: '2026-11-01', doneDay: '2026-11-02', actualSeconds: HOUR },
  ]);
  expect(unplanned).toEqual({ hours: null, dates: null, count: 1 });
});

it('a projection lands the right calendar day', () => {
  // Day keys must agree with real calendar dates for any pace, which means crossing months and years.
  // 22 November 2026 plus 8 days is 30 November, then December, January (2027 with 31 days)…
  const cases: [number, string][] = [
    [4, '2026-11-26'],
    [8, '2026-11-30'],
    [9, '2026-12-01'],
    [40, '2027-01-01'],
    [56, '2027-01-17'],
    [111, '2027-03-13'],
  ];
  for (const [days, finish] of cases) {
    // A pace of 1 h a day with whole hours elapsed leaves exactly `days` hours to go.
    const p = progress({
      plan: { deadline: null, plannedMinutes: 600 + days * 60 },
      focusedSeconds: 600 * 60,
      last14Seconds: 14 * HOUR,
    });
    expect(p.projectedFinish, String(days)).toBe(finish);
  }
});

it('day arithmetic keeps the hub time zone in mind', () => {
  // 05:30Z on 11-23 is still Sunday 11-22 in Chicago.
  expect(dayKey(new Date('2026-11-23T05:30:00.000Z'), 'America/Chicago')).toBe(TODAY);
  expect(addDays(TODAY, 4)).toBe('2026-11-26');
  expect(progress({ plan: { deadline: null, plannedMinutes: 600 }, focusedSeconds: 6 * HOUR, last14Seconds: 14 * HOUR }).projectedFinish).toBe(addDays(TODAY, 4));
});
