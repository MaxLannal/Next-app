import type { DatabaseSync } from 'node:sqlite';
import type { Goal } from '../../shared/types.ts';
import { goalProgress, type GoalPlan } from '../lib/goals.ts';
import { addDays, dayKey, dayStart } from '../lib/time.ts';

export type GoalStatus = Goal['status'];

type GoalRow = {
  id: number;
  title: string;
  created_at: string;
  deadline: string | null;
  planned_minutes: number | null;
  original_deadline: string | null;
  original_planned_minutes: number | null;
  status: GoalStatus;
  done_at: string | null;
};

/** The edit a PATCH asks for; absent keys leave the field alone (a plan key may clear it with null). */
export type GoalEdit = { title?: string; deadline?: string | null; plannedMinutes?: number | null; status?: GoalStatus };

const planOf = (deadline: string | null, plannedMinutes: number | null): GoalPlan => ({ deadline, plannedMinutes });

/**
 * All focus on one goal, and the share of it that started in the last 14 calendar days
 * (today included). A session that crosses midnight counts by its whole stored focus.
 */
function goalSeconds(db: DatabaseSync, goalId: number, last14From: Date): { total: number; recent: number } {
  const rows = db
    .prepare('SELECT focus_seconds, started_at FROM focus_sessions WHERE goal_id = ?')
    .all(goalId) as { focus_seconds: number; started_at: string }[];
  let total = 0;
  let recent = 0;
  for (const r of rows) {
    total += r.focus_seconds;
    if (Date.parse(r.started_at) >= last14From.getTime()) recent += r.focus_seconds;
  }
  return { total, recent };
}

function toGoal(db: DatabaseSync, row: GoalRow, today: string, tz: string, last14From: Date): Goal {
  const { total, recent } = goalSeconds(db, row.id, last14From);
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    deadline: row.deadline,
    plannedMinutes: row.planned_minutes,
    originalDeadline: row.original_deadline,
    originalPlannedMinutes: row.original_planned_minutes,
    status: row.status,
    doneAt: row.done_at,
    focusedSeconds: total,
    progress: goalProgress({
      plan: planOf(row.deadline, row.planned_minutes),
      createdDay: dayKey(new Date(row.created_at), tz),
      focusedSeconds: total,
      last14Seconds: recent,
      today,
    }),
  };
}

/** The first instant of the first of the last 14 local days, today included. */
const last14FromDay = (today: string, tz: string) => dayStart(addDays(today, -13), tz);

/** The goal with that id, or null. */
export function getGoal(db: DatabaseSync, id: number, today: string, tz: string): Goal | null {
  const row = db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as GoalRow | undefined;
  return row ? toGoal(db, row, today, tz, last14FromDay(today, tz)) : null;
}

/** Open goals newest first; done and archived newest first by the day they got there. */
export function listGoals(db: DatabaseSync, status: GoalStatus, today: string, tz: string): Goal[] {
  const order = status === 'done' ? 'done_at DESC, id DESC' : 'created_at DESC, id DESC';
  const rows = db.prepare(`SELECT * FROM goals WHERE status = ? ORDER BY ${order}`).all(status) as GoalRow[];
  const from = last14FromDay(today, tz);
  return rows.map((row) => toGoal(db, row, today, tz, from));
}

export function insertGoal(
  db: DatabaseSync,
  g: { title: string; deadline: string | null; plannedMinutes: number | null },
  now: Date,
): number {
  // A plan given at creation is the original, so accuracy starts from it.
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO goals (title, created_at, deadline, planned_minutes, original_deadline, original_planned_minutes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(g.title, now.toISOString(), g.deadline, g.plannedMinutes, g.deadline, g.plannedMinutes);
  return Number(lastInsertRowid);
}

/**
 * Applies an edit. Until the original plan covers every part now set, a change fills the
 * original silently; after that, changing the plan records the old one in `goal_plan_history`
 * and the original never moves. A done goal's plan is fixed, so its accuracy can't be rewritten
 * after the fact. Returns the number of history rows added, `'done'` for that refusal, or null
 * when the goal does not exist.
 */
export function updateGoal(db: DatabaseSync, id: number, edit: GoalEdit, now: Date): number | 'done' | null {
  const row = db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as GoalRow | undefined;
  if (!row) return null;
  if (row.status === 'done' && (edit.deadline !== undefined || edit.plannedMinutes !== undefined)) return 'done';

  const deadline = edit.deadline === undefined ? row.deadline : edit.deadline;
  const plannedMinutes = edit.plannedMinutes === undefined ? row.planned_minutes : edit.plannedMinutes;
  const title = edit.title === undefined ? row.title : edit.title;
  const planChanged = deadline !== row.deadline || plannedMinutes !== row.planned_minutes;
  const hasPlan = deadline !== null || plannedMinutes !== null;
  // The original can take history only once it is whole for the parts now planned.
  const originalCovers =
    (deadline === null || row.original_deadline !== null) &&
    (plannedMinutes === null || row.original_planned_minutes !== null);
  // A change of the plan is a re-plan once something had been planned at the current goal's
  // own level; until then it only fills the original, silently.
  const rePlan = planChanged && (row.deadline !== null || row.planned_minutes !== null) && hasPlan;
  const fillsOriginal = planChanged && !(rePlan && originalCovers);
  const recordHistory = rePlan && originalCovers;

  if (recordHistory) {
    db.prepare('INSERT INTO goal_plan_history (goal_id, changed_at, deadline, planned_minutes) VALUES (?, ?, ?, ?)').run(
      id,
      now.toISOString(),
      row.deadline,
      row.planned_minutes,
    );
  }

  const status = edit.status === undefined ? row.status : edit.status;
  const doneAt = status === 'done' ? (row.done_at ?? now.toISOString()) : null;
  db.prepare(
    `UPDATE goals SET title = ?, deadline = ?, planned_minutes = ?, original_deadline = ?,
       original_planned_minutes = ?, status = ?, done_at = ? WHERE id = ?`,
  ).run(
    title,
    deadline,
    plannedMinutes,
    fillsOriginal ? deadline : row.original_deadline,
    fillsOriginal ? plannedMinutes : row.original_planned_minutes,
    status,
    doneAt,
    id,
  );
  return recordHistory ? 1 : 0;
}

export function deleteGoal(db: DatabaseSync, id: number): boolean {
  return db.prepare('DELETE FROM goals WHERE id = ?').run(id).changes > 0;
}

/** Done goals with their original plan and the day they finished, for the accuracy figures. */
export function doneGoalPlans(
  db: DatabaseSync,
  tz: string,
): { original: GoalPlan; createdDay: string; doneDay: string; actualSeconds: number }[] {
  const rows = db
    .prepare(
      `SELECT g.id, g.created_at, g.done_at, g.original_deadline, g.original_planned_minutes,
         (SELECT coalesce(sum(s.focus_seconds), 0) FROM focus_sessions s WHERE s.goal_id = g.id) AS actual_seconds
       FROM goals g WHERE g.status = 'done' AND g.done_at IS NOT NULL`,
    )
    .all() as {
    id: number;
    created_at: string;
    done_at: string;
    original_deadline: string | null;
    original_planned_minutes: number | null;
    actual_seconds: number;
  }[];
  return rows.map((r) => ({
    original: planOf(r.original_deadline, r.original_planned_minutes),
    createdDay: dayKey(new Date(r.created_at), tz),
    doneDay: dayKey(new Date(r.done_at), tz),
    actualSeconds: r.actual_seconds,
  }));
}
