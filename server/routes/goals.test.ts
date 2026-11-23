import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Goal } from '../../shared/types.ts';
import { appendEvent, recomputeFocus } from '../repo/sessions.ts';
import { TEST_NOW, makeTestContext, type TestContext } from '../test/helpers.ts';

type Accuracy = { hours: number | null; dates: number | null; count: number };
type GoalRow = { deadline: string | null; planned_minutes: number | null };

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

async function create(body: Record<string, unknown>): Promise<Goal> {
  const res = await t.req('POST', '/api/goals', body);
  expect(res.status).toBe(201);
  return (await res.json()) as Goal;
}

async function patch(id: number, body: Record<string, unknown>): Promise<Goal> {
  const res = await t.req('PATCH', `/api/goals/${id}`, body);
  expect(res.status).toBe(200);
  return (await res.json()) as Goal;
}

async function list(query = ''): Promise<Goal[]> {
  const res = await t.req('GET', `/api/goals${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Goal[];
}

async function accuracy(): Promise<Accuracy> {
  const res = await t.req('GET', '/api/goals/accuracy');
  expect(res.status).toBe(200);
  return (await res.json()) as Accuracy;
}

const history = () => t.db.prepare('SELECT * FROM goal_plan_history ORDER BY id').all() as GoalRow[];

/**
 * A done focus session on `goalId` with exactly one hour of focus, from `startedAtIso` (a whole
 * UTC instant) to an hour later.
 */
function seedHour(goalId: number, startedAtIso: string): void {
  const started = new Date(startedAtIso);
  const ended = new Date(started.getTime() + 3_600_000);
  const { lastInsertRowid } = t.db
    .prepare(
      `INSERT INTO focus_sessions (name, goal_id, status, started_at, ended_at, created_at)
       VALUES ('Chapter 4', ?, 'done', ?, ?, ?)`,
    )
    .run(goalId, started.toISOString(), ended.toISOString(), started.toISOString());
  const id = Number(lastInsertRowid);
  appendEvent(t.db, id, 'start', started);
  appendEvent(t.db, id, 'stop', ended);
  recomputeFocus(t.db, id, ended);
}

/** Yesterday and the day before in Chicago (the clock is noon there, 18:00Z). */
const YESTERDAY = '2026-11-22T16:00:00.000Z';
const TWO_DAYS_AGO = '2026-11-22T14:00:00.000Z';

it('creates a goal with no plan', async () => {
  const goal = await create({ title: '  Finish Ch. 4  ' });
  expect(goal).toMatchObject({
    title: 'Finish Ch. 4',
    createdAt: TEST_NOW,
    deadline: null,
    plannedMinutes: null,
    originalDeadline: null,
    originalPlannedMinutes: null,
    status: 'open',
    doneAt: null,
    focusedSeconds: 0,
    progress: { mode: 'none', fraction: null, fractionKind: null, projectedFinish: null, noRecentPace: false, atRisk: false },
  });
  expect(goal.id).toBeGreaterThan(0);
  expect(await list()).toHaveLength(1);
});

it('creates a goal with a plan, which is also its original', async () => {
  const goal = await create({ title: 'Finish Ch. 4', deadline: '2026-12-02', plannedMinutes: 600 });
  expect(goal).toMatchObject({ deadline: '2026-12-02', plannedMinutes: 600, originalDeadline: '2026-12-02', originalPlannedMinutes: 600 });
  expect(goal.progress.mode).toBe('both');
  expect(history()).toEqual([]);
});

it('rejects a goal without a title', async () => {
  for (const title of ['', '   ', 7, null, undefined]) {
    const res = await t.req('POST', '/api/goals', title === undefined ? {} : { title });
    expect(res.status).toBe(400);
  }
  expect(t.db.prepare('SELECT COUNT(*) AS n FROM goals').get()).toEqual({ n: 0 });
});

it('rejects plans that are not a real day or a whole number of minutes', async () => {
  for (const body of [
    { title: 'A', deadline: '2026-02-30' },
    { title: 'A', deadline: '2026-11-25T00:00:00Z' },
    { title: 'A', deadline: 20261125 },
    { title: 'A', plannedMinutes: 0 },
    { title: 'A', plannedMinutes: -60 },
    { title: 'A', plannedMinutes: 90.5 },
    { title: 'A', plannedMinutes: '600' },
  ]) {
    const res = await t.req('POST', '/api/goals', body);
    expect(res.status, JSON.stringify(body)).toBe(400);
  }
});

it('first plan sets the original, with no history', async () => {
  const goal = await create({ title: 'Finish Ch. 4' });
  const planned = await patch(goal.id, { plannedMinutes: 600 });
  expect(planned.plannedMinutes).toBe(600);
  expect(planned.originalPlannedMinutes).toBe(600);
  expect(planned.originalDeadline).toBeNull();
  expect(history()).toEqual([]);
  // A deadline added afterwards fills the other half of the original too, still without history.
  const dated = await patch(goal.id, { deadline: '2026-12-02' });
  expect(dated).toMatchObject({ deadline: '2026-12-02', originalDeadline: '2026-12-02', plannedMinutes: 600, originalPlannedMinutes: 600 });
  expect(history()).toEqual([]);
});

it('re-plan keeps the original and records the old plan once', async () => {
  const goal = await create({ title: 'Finish Ch. 4' });
  await patch(goal.id, { plannedMinutes: 600 });
  const replanned = await patch(goal.id, { plannedMinutes: 900 });
  expect(replanned.plannedMinutes).toBe(900);
  expect(replanned.originalPlannedMinutes).toBe(600);
  expect(history()).toHaveLength(1);
  expect(history()[0]).toMatchObject({ goal_id: goal.id, changed_at: TEST_NOW, deadline: null, planned_minutes: 600 });
  // Re-sending the plan on screen is not a change.
  expect((await patch(goal.id, { plannedMinutes: 900 })).plannedMinutes).toBe(900);
  expect(history()).toHaveLength(1);
});

it('re-planning a deadline records the old one', async () => {
  const goal = await create({ title: 'Finish Ch. 4', deadline: '2026-12-02' });
  t.setNow('2026-11-24T18:00:00.000Z');
  const replanned = await patch(goal.id, { deadline: '2026-12-10' });
  expect(replanned).toMatchObject({ deadline: '2026-12-10', originalDeadline: '2026-12-02' });
  expect(history()).toEqual([{ id: 1, goal_id: goal.id, changed_at: '2026-11-24T18:00:00.000Z', deadline: '2026-12-02', planned_minutes: null }]);
});

it('renames a goal', async () => {
  const goal = await create({ title: 'Finish Ch. 4' });
  expect((await patch(goal.id, { title: 'Finish Ch. 5' })).title).toBe('Finish Ch. 5');
  expect((await t.req('PATCH', `/api/goals/${goal.id}`, { title: ' ' })).status).toBe(400);
});

it('done records the finish time and the actual hours', async () => {
  const goal = await create({ title: 'Finish Ch. 4', plannedMinutes: 600 });
  seedHour(goal.id, TWO_DAYS_AGO);
  const done = await patch(goal.id, { status: 'done' });
  expect(done.doneAt).toBe(TEST_NOW);
  expect(done.focusedSeconds).toBe(3600);
  expect(done.title).toBe('Finish Ch. 4');

  const all = await list('?status=done');
  expect(all.map((g) => g.id)).toEqual([goal.id]);
  expect(all[0].doneAt).toBe(TEST_NOW);
  expect(await list('?status=open')).toEqual([]);

  expect(await accuracy()).toEqual({ hours: 0.1, dates: null, count: 1 });

  // The plan can't move once the goal is done; its accuracy would be rewritten after the fact.
  expect((await t.req('PATCH', `/api/goals/${goal.id}`, { plannedMinutes: 120 })).status).toBe(409);
  expect(history()).toEqual([]);
});

it('archives and reopens a goal', async () => {
  const goal = await create({ title: 'Finish Ch. 4' });
  expect((await patch(goal.id, { status: 'archived' })).status).toBe('archived');
  expect(await list()).toEqual([]);
  expect((await list('?status=archived')).map((g) => g.id)).toEqual([goal.id]);
  expect((await patch(goal.id, { status: 'open' })).status).toBe('open');
  expect((await t.req('PATCH', `/api/goals/${goal.id}`, { status: 'lost' })).status).toBe(400);
});

it('lists by status, newest first, and rejects an unknown status', async () => {
  const first = await create({ title: 'One' });
  const second = await create({ title: 'Two' });
  expect((await list('?status=open')).map((g) => g.id)).toEqual([second.id, first.id]);
  expect((await list()).map((g) => g.id)).toEqual([second.id, first.id]);
  expect((await t.req('GET', '/api/goals?status=someday')).status).toBe(400);
});

it('keeps the order goals are dragged into, with a new goal on top', async () => {
  const one = await create({ title: 'One' });
  const two = await create({ title: 'Two' });
  const three = await create({ title: 'Three' });
  const res = await t.req('PUT', '/api/goals/order', { ids: [one.id, three.id, two.id] });
  expect(res.status).toBe(200);
  expect(((await res.json()) as Goal[]).map((g) => g.title)).toEqual(['One', 'Three', 'Two']);
  expect((await list()).map((g) => g.title)).toEqual(['One', 'Three', 'Two']);

  await create({ title: 'Four' });
  expect((await list()).map((g) => g.title)).toEqual(['Four', 'One', 'Three', 'Two']);
});

it('refuses an order that is not the open goals’ ids', async () => {
  const one = await create({ title: 'One' });
  const two = await create({ title: 'Two' });
  for (const body of [{}, { ids: 'one' }, { ids: [one.id, one.id] }, { ids: [one.id, 0] }, { ids: [one.id, 999] }]) {
    expect((await t.req('PUT', '/api/goals/order', body)).status).toBe(400);
  }
  await patch(two.id, { status: 'done' });
  expect((await t.req('PUT', '/api/goals/order', { ids: [two.id, one.id] })).status).toBe(400);
  expect((await list()).map((g) => g.title)).toEqual(['One']);
});

it('deletes a goal and its history', async () => {
  const goal = await create({ title: 'Finish Ch. 4', plannedMinutes: 600 });
  await patch(goal.id, { plannedMinutes: 900 });
  expect(history()).toHaveLength(1);
  expect((await t.req('DELETE', `/api/goals/${goal.id}`)).status).toBe(204);
  expect(await list('?status=open')).toEqual([]);
  expect(t.db.prepare('SELECT COUNT(*) AS n FROM goal_plan_history').get()).toEqual({ n: 0 });
  expect((await t.req('DELETE', `/api/goals/${goal.id}`)).status).toBe(404);
});

it('unknown goals and bad ids are 404', async () => {
  expect((await t.req('PATCH', '/api/goals/999', { title: 'X' })).status).toBe(404);
  expect((await t.req('PATCH', '/api/goals/abc', { title: 'X' })).status).toBe(404);
  expect((await t.req('DELETE', '/api/goals/999')).status).toBe(404);
});

it('accuracy medians tell the truth about original plans', async () => {
  // Planned 10 h; took 1 h and finished the same day.
  const fast = await create({ title: 'Fast', plannedMinutes: 600 });
  seedHour(fast.id, YESTERDAY);
  await patch(fast.id, { status: 'done' });
  // Planned 2 h; re-planned to 40 h before finishing: accuracy reads the original 2 h.
  const slow = await create({ title: 'Slow', plannedMinutes: 120 });
  seedHour(slow.id, YESTERDAY);
  t.setNow('2026-11-30T18:00:00.000Z');
  await patch(slow.id, { plannedMinutes: 2400 });
  await patch(slow.id, { status: 'done' });

  // 1 h of 10 h, and 1 h of the original 2 h: the median of 0.1 and 0.5.
  expect(await accuracy()).toEqual({ hours: 0.3, dates: null, count: 2 });
  // No goal had a deadline, so there are no date figures.
  expect((await accuracy()).dates).toBeNull();
});

it('a goal’s progress uses live focus and the last 14 days for the pace', async () => {
  const goal = await create({ title: 'Finish Ch. 4', plannedMinutes: 600 });
  // Two hours on Sunday 15 November, both inside the window; a pace of 2 h a day. 8 h left at
  // 2 h a day is 28 days: 14 to 20 December, then 14 into January, 17 January.
  seedHour(goal.id, '2026-11-15T16:00:00.000Z');
  seedHour(goal.id, '2026-11-15T18:00:00.000Z');
  const [row] = await list();
  expect(row.focusedSeconds).toBe(2 * 3600);
  expect(row.progress).toMatchObject({
    mode: 'hours',
    fraction: 0.2,
    fractionKind: 'work',
    projectedFinish: '2027-01-17',
    noRecentPace: false,
    atRisk: false,
  });
});

it('a running session contributes its live time', async () => {
  const goal = await create({ title: 'Finish Ch. 4', plannedMinutes: 600 });
  // Started 90 minutes before the clock and still running: focus_seconds is still 0.
  const started = new Date(Date.parse(TEST_NOW) - 90 * 60_000);
  const { lastInsertRowid } = t.db
    .prepare(
      `INSERT INTO focus_sessions (name, goal_id, status, started_at, created_at)
       VALUES ('Chapter 4', ?, 'running', ?, ?)`,
    )
    .run(goal.id, started.toISOString(), started.toISOString());
  appendEvent(t.db, Number(lastInsertRowid), 'start', started);

  const [row] = await list();
  expect(row.focusedSeconds).toBe(90 * 60);
  // 1.5 h of 10 h; 8.5 h left at 1.5 h a day is 79.33 days, so 80 more: 8 to the end of
  // November, 31 for December, 31 for January, then 10 more, 10 February.
  expect(row.progress).toMatchObject({ fraction: 0.15, projectedFinish: '2027-02-10' });
});

it('editing a session’s start time moves the 14-day window', async () => {
  const goal = await create({ title: 'Finish Ch. 4', plannedMinutes: 600 });
  const started = new Date('2026-11-02T14:00:00.000Z');
  const ended = new Date('2026-11-02T15:00:00.000Z');
  const { lastInsertRowid } = t.db
    .prepare(
      `INSERT INTO focus_sessions (name, goal_id, status, started_at, ended_at, created_at)
       VALUES ('Chapter 4', ?, 'done', ?, ?, ?)`,
    )
    .run(goal.id, started.toISOString(), ended.toISOString(), started.toISOString());
  const id = Number(lastInsertRowid);
  appendEvent(t.db, id, 'start', started);
  appendEvent(t.db, id, 'stop', ended);
  recomputeFocus(t.db, id, ended);

  // 2 November is outside the window, so there is no recent pace.
  expect((await list())[0].progress.noRecentPace).toBe(true);

  // The session was really yesterday: its events move, and the pace appears without a recompute.
  const moved = new Date('2026-11-21T16:00:00.000Z');
  t.db.prepare('UPDATE session_events SET at = ? WHERE session_id = ? AND type = ?').run(moved.toISOString(), id, 'start');
  t.db.prepare('UPDATE session_events SET at = ? WHERE session_id = ? AND type = ?').run('2026-11-21T17:00:00.000Z', id, 'stop');
  const [row] = await list();
  expect(row.progress.noRecentPace).toBe(false);
  // 1 h of its 10 h done, at 1 h a day; 9 h left → 126 days: 8 to the end of November,
  // 31 + 31 + 28 for December to February, 28 more into March.
  expect(row.progress).toMatchObject({ fraction: 0.1, projectedFinish: '2027-03-28' });
});

it('a re-plan writes exactly one history row and updates the goal, atomically', async () => {
  const goal = await create({ title: 'Finish Ch. 4', plannedMinutes: 600 });
  await patch(goal.id, { plannedMinutes: 900 });
  const rows = t.db.prepare('SELECT * FROM goal_plan_history WHERE goal_id = ?').all(goal.id);
  expect(rows).toHaveLength(1);
  const stored = t.db.prepare('SELECT planned_minutes, original_planned_minutes FROM goals WHERE id = ?').get(goal.id);
  expect(stored).toEqual({ planned_minutes: 900, original_planned_minutes: 600 });
});
