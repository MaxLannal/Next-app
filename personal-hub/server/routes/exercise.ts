import { Hono, type Context } from 'hono';
import type { ExerciseKind } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import { dailyAverage, exerciseBuckets, type ExerciseEntry } from '../lib/exercise.ts';
import { dayKey, dayStart, addDays, rangeBounds, type Range } from '../lib/time.ts';

const KINDS: ExerciseKind[] = ['pushups', 'squats'];
const RANGES: Range[] = ['day', 'week', 'month', 'year'];
const MAX_COUNT = 10000;

const isKind = (value: unknown): value is ExerciseKind =>
  typeof value === 'string' && (KINDS as readonly string[]).includes(value);

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

/** Mounted at `/api/exercise`. */
export function exerciseRoutes(ctx: AppContext): Hono {
  const routes = new Hono();
  const tz = () => ctx.timeZone();

  routes.post('/', async (c) => {
    const { kind, count } = await jsonBody(c);
    if (!isKind(kind)) return c.json({ error: 'Kind must be pushups or squats' }, 400);
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
      return c.json({ error: `Count must be a whole number from 1 to ${MAX_COUNT}` }, 400);
    }
    ctx.db
      .prepare('INSERT INTO exercise_log (kind, count, logged_at) VALUES (?, ?, ?)')
      .run(kind, count, ctx.now().toISOString());
    return c.json({ kind, count }, 201);
  });

  // Derived from the clock on purpose: an remembered `date` would undo on the wrong day.
  routes.delete('/last', (c) => {
    const kind = c.req.query('kind');
    if (!isKind(kind)) return c.json({ error: 'Kind must be pushups or squats' }, 400);
    const today = dayKey(ctx.now(), tz());
    const start = dayStart(today, tz());
    const end = dayStart(addDays(today, 1), tz());
    const row = ctx.db
      .prepare('SELECT id FROM exercise_log WHERE kind = ? AND logged_at >= ? AND logged_at < ? ORDER BY id DESC LIMIT 1')
      .get(kind, start.toISOString(), end.toISOString()) as { id: number } | undefined;
    if (!row) return c.json({ error: 'Nothing logged today' }, 404);
    ctx.db.prepare('DELETE FROM exercise_log WHERE id = ?').run(row.id);
    return c.body(null, 204);
  });

  routes.get('/', (c) => {
    const rangeRaw = c.req.query('range') ?? 'day';
    if (!(RANGES as string[]).includes(rangeRaw)) return c.json({ error: 'Range must be day, week, month or year' }, 400);
    const range = rangeRaw as Range;
    const today = dayKey(ctx.now(), tz());
    const date = c.req.query('date') || today;
    // A malformed or impossible day (2026-02-30) throws; answer 400.
    let bounds: ReturnType<typeof rangeBounds>;
    try {
      bounds = rangeBounds(range, date, tz());
    } catch {
      return c.json({ error: 'Date must be a real YYYY-MM-DD day' }, 400);
    }
    const kindRaw = c.req.query('kind');
    if (kindRaw !== undefined && !isKind(kindRaw)) return c.json({ error: 'Kind must be pushups or squats' }, 400);
    const kinds = kindRaw === undefined ? KINDS : [kindRaw];

    const rows = ctx.db
      .prepare('SELECT kind, count, logged_at FROM exercise_log WHERE logged_at >= ? AND logged_at < ?')
      .all(bounds.start.toISOString(), bounds.end.toISOString()) as { kind: ExerciseKind; count: number; logged_at: string }[];
    const entries: Record<ExerciseKind, ExerciseEntry[]> = { pushups: [], squats: [] };
    for (const r of rows) entries[r.kind].push({ count: r.count, loggedAt: r.logged_at });

    const start = dayStart(today, tz());
    const end = dayStart(addDays(today, 1), tz());
    const sumToday = ctx.db.prepare(
      'SELECT coalesce(sum(count), 0) AS total FROM exercise_log WHERE kind = ? AND logged_at >= ? AND logged_at < ?',
    );
    const todayOut = Object.fromEntries(
      KINDS.map((k) => [k, (sumToday.get(k, start.toISOString(), end.toISOString()) as { total: number }).total]),
    ) as Record<ExerciseKind, number>;
    const series = Object.fromEntries(
      kinds.map((k) => {
        const buckets = exerciseBuckets(entries[k], range, date, tz());
        const total = buckets.reduce((sum, b) => sum + b.value, 0);
        return [k, { buckets, total, dailyAverage: dailyAverage(total, range, date, today, tz()) }];
      }),
    );
    return c.json({ today: todayOut, series });
  });

  return routes;
}
