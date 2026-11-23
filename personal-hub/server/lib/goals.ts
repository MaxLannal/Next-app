// Goal progress and estimate accuracy (spec §6.3). Pure functions over day keys;
// instants and durations arrive already summed in seconds.

import { addDays } from './time.ts';

export type GoalPlan = { deadline: string | null; plannedMinutes: number | null };

export type GoalProgress = {
  mode: 'hours' | 'deadline' | 'both' | 'none';
  /** 0..1: work done for an hours plan, time elapsed for a deadline-only plan. */
  fraction: number | null;
  fractionKind: 'work' | 'time' | null;
  /** The day key the pace projects a finish on; null with no plan, no recent pace, or nothing left. */
  projectedFinish: string | null;
  noRecentPace: boolean;
  atRisk: boolean;
};

export type GoalProgressInput = {
  plan: GoalPlan;
  createdDay: string;
  focusedSeconds: number;
  last14Seconds: number;
  today: string;
};

const DAY = 86_400_000;
const PACE_DAYS = 14; // the pace window

/** A day key as a whole day number (days since the epoch). */
const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00.000Z`) / DAY;

/** Days from a day key `a` to day key `b`; negative when `b` is earlier. */
function daysBetween(a: string, b: string): number {
  return Math.round(dayNumber(b) - dayNumber(a));
}

/** Whole days to wait; a float quotient that lands within a millionth of a whole day is that day. */
function daysToFinish(remainingSeconds: number, pacePerDay: number): number {
  return Math.ceil(remainingSeconds / pacePerDay - 1e-6);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * How far a goal is, and when it is likely to finish. An hours plan projects from the
 * focus of the last 14 days; a deadline-only plan never invents a percentage of work.
 */
export function goalProgress(i: GoalProgressInput): GoalProgress {
  const plannedSeconds = i.plan.plannedMinutes === null ? null : i.plan.plannedMinutes * 60;
  const mode: GoalProgress['mode'] =
    plannedSeconds === null
      ? i.plan.deadline === null
        ? 'none'
        : 'deadline'
      : i.plan.deadline === null
        ? 'hours'
        : 'both';

  if (mode === 'none') {
    return { mode, fraction: null, fractionKind: null, projectedFinish: null, noRecentPace: false, atRisk: false };
  }

  if (mode === 'deadline') {
    // The hub can't know how much work is left, so the bar only shows time elapsed.
    const deadline = i.plan.deadline as string;
    const span = daysBetween(i.createdDay, deadline);
    const elapsed = daysBetween(i.createdDay, i.today);
    return {
      mode,
      fraction: span > 0 ? clamp01(elapsed / span) : 1,
      fractionKind: 'time',
      projectedFinish: null,
      noRecentPace: false,
      atRisk: daysBetween(i.today, deadline) <= 3,
    };
  }

  const done = plannedSeconds ?? 0;
  const remaining = Math.max(0, done - i.focusedSeconds);
  const noRecentPace = i.last14Seconds === 0;
  const pace = i.last14Seconds / PACE_DAYS;
  const daysLeft = i.plan.deadline === null ? null : daysBetween(i.today, i.plan.deadline);

  // Nothing left means done today; no focus in 14 days means there is no pace to project from.
  const usefulPace = !noRecentPace && remaining > 0;
  const projectedFinish = remaining === 0 ? i.today : usefulPace ? addDays(i.today, daysToFinish(remaining, pace)) : null;

  // Both: at risk when the projection lands after the deadline, or there is no pace and
  // seven days or fewer are left.
  const atRisk =
    mode === 'both' &&
    ((projectedFinish !== null && daysBetween(projectedFinish, i.plan.deadline as string) < 0) ||
      (noRecentPace && (daysLeft as number) <= 7 && remaining > 0));

  return {
    mode,
    fraction: done > 0 ? clamp01(i.focusedSeconds / done) : null,
    fractionKind: 'work',
    projectedFinish,
    noRecentPace,
    atRisk,
  };
}

export type AccuracyGoal = { original: GoalPlan; createdDay: string; doneDay: string; actualSeconds: number };
export type EstimateAccuracy = { hours: number | null; dates: number | null; count: number };

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The median of actual ÷ planned, for hours and for dates, over done goals that had that
 * original plan. 1.0 is on plan. Always against the original plan: re-planning can't flatter it.
 */
export function estimateAccuracy(done: AccuracyGoal[]): EstimateAccuracy {
  const hours: number[] = [];
  const dates: number[] = [];
  for (const g of done) {
    if (g.original.plannedMinutes !== null && g.original.plannedMinutes > 0) {
      hours.push(g.actualSeconds / 60 / g.original.plannedMinutes);
    }
    const plannedDays = g.original.deadline === null ? 0 : daysBetween(g.createdDay, g.original.deadline);
    if (plannedDays > 0) dates.push(daysBetween(g.createdDay, g.doneDay) / plannedDays);
  }
  return { hours: median(hours), dates: median(dates), count: done.length };
}
