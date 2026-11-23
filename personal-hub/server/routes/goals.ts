import { Hono, type Context } from 'hono';
import { isDayKey, type Goal } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import { estimateAccuracy } from '../lib/goals.ts';
import { dayKey } from '../lib/time.ts';
import {
  deleteGoal,
  doneGoalPlans,
  getGoal,
  insertGoal,
  listGoals,
  updateGoal,
  type GoalEdit,
  type GoalStatus,
} from '../repo/goals.ts';

const STATUSES: GoalStatus[] = ['open', 'done', 'archived'];

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

type Plan = { deadline: string | null; plannedMinutes: number | null };

/** Reads the plan fields present in `body`; a field set to null clears it. */
function readPlan(body: Record<string, unknown>): { error: string } | { plan: Partial<Plan> } {
  const plan: Partial<Plan> = {};
  if (body.deadline !== undefined) {
    if (body.deadline === null || body.deadline === '') plan.deadline = null;
    else if (isDayKey(body.deadline)) plan.deadline = body.deadline;
    else return { error: 'Deadline must be a real YYYY-MM-DD day' };
  }
  if (body.plannedMinutes !== undefined) {
    const n = body.plannedMinutes;
    if (n === null) plan.plannedMinutes = null;
    else if (typeof n === 'number' && Number.isInteger(n) && n > 0) plan.plannedMinutes = n;
    else return { error: 'How long must be a whole number of minutes' };
  }
  return { plan };
}

const isId = (raw: string): number | null => (/^[1-9][0-9]*$/.test(raw) ? Number(raw) : null);

/** Mounted at `/api/goals`. `today` is the hub's local day at the moment of the request. */
export function goalRoutes(ctx: AppContext): Hono {
  const routes = new Hono();
  const view = () => {
    const now = ctx.now();
    return { now, today: dayKey(now, ctx.timeZone()), tz: ctx.timeZone() };
  };

  routes.get('/', (c) => {
    const statusRaw = c.req.query('status') ?? 'open';
    if (!(STATUSES as string[]).includes(statusRaw)) return c.json({ error: 'Status must be open, done or archived' }, 400);
    const { now, today, tz } = view();
    return c.json(listGoals(ctx.db, statusRaw as GoalStatus, today, tz, now));
  });

  // Before `/:id` so the word is never read as an id.
  routes.get('/accuracy', (c) => c.json(estimateAccuracy(doneGoalPlans(ctx.db, ctx.timeZone()))));

  routes.post('/', async (c) => {
    const body = await jsonBody(c);
    if (typeof body.title !== 'string' || body.title.trim() === '') return c.json({ error: 'A goal needs a title' }, 400);
    const read = readPlan(body);
    if ('error' in read) return c.json({ error: read.error }, 400);
    const { now, today, tz } = view();
    const id = insertGoal(
      ctx.db,
      { title: body.title.trim(), deadline: read.plan.deadline ?? null, plannedMinutes: read.plan.plannedMinutes ?? null },
      now,
    );
    return c.json(getGoal(ctx.db, id, today, tz, now) as Goal, 201);
  });

  routes.patch('/:id', async (c) => {
    const id = isId(c.req.param('id'));
    if (id === null) return c.json({ error: 'Not found' }, 404);
    const body = await jsonBody(c);
    const edit: GoalEdit = {};
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim() === '') return c.json({ error: 'A goal needs a title' }, 400);
      edit.title = body.title.trim();
    }
    if (body.status !== undefined) {
      if (!(STATUSES as string[]).includes(body.status as string)) {
        return c.json({ error: 'Status must be open, done or archived' }, 400);
      }
      edit.status = body.status as GoalStatus;
    }
    const read = readPlan(body);
    if ('error' in read) return c.json({ error: read.error }, 400);
    if (read.plan.deadline !== undefined) edit.deadline = read.plan.deadline;
    if (read.plan.plannedMinutes !== undefined) edit.plannedMinutes = read.plan.plannedMinutes;

    const changed = updateGoal(ctx.db, id, edit, ctx.now());
    if (changed === null) return c.json({ error: 'Not found' }, 404);
    if (changed === 'done') return c.json({ error: 'This goal is done; its plan can no longer change' }, 409);
    const { now, today, tz } = view();
    return c.json(getGoal(ctx.db, id, today, tz, now));
  });

  routes.delete('/:id', (c) => {
    const id = isId(c.req.param('id'));
    if (id === null || !deleteGoal(ctx.db, id)) return c.json({ error: 'Not found' }, 404);
    return c.body(null, 204);
  });

  return routes;
}
