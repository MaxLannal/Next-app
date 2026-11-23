import { Hono } from 'hono';
import type { HeatmapDay, HeatmapStats, SubjectSlice } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import { addDays, dayKey, heatmapLevel, rangeBounds, streaks, type Range } from '../lib/time.ts';
import { focusByDay } from '../repo/sessions.ts';

const RANGES: readonly Range[] = ['day', 'week', 'month', 'year'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const YEAR = /^\d{4}$/;

/** Slices largest first; the "No subject" slice sinks to the end. */
function sortedSlices(bySubject: Map<number | null, { name: string; seconds: number }>): SubjectSlice[] {
  return [...bySubject]
    .map(([subjectId, s]) => ({ subjectId, name: s.name, seconds: s.seconds }))
    .sort((a, b) => (a.subjectId === null ? 1 : 0) - (b.subjectId === null ? 1 : 0) || b.seconds - a.seconds);
}

/** Mounted at `/api/stats`. */
export function statsRoutes(ctx: AppContext): Hono {
  const routes = new Hono();
  const tz = ctx.timeZone();

  routes.get('/subjects', (c) => {
    const range = (c.req.query('range') ?? 'week') as Range;
    if (!RANGES.includes(range)) return c.json({ error: 'Range must be day, week, month or year' }, 400);
    const today = dayKey(ctx.now(), tz);
    const date = c.req.query('date') ?? today;
    if (!DAY.test(date)) return c.json({ error: 'Date must be YYYY-MM-DD' }, 400);
    let bounds: ReturnType<typeof rangeBounds>;
    try {
      bounds = rangeBounds(range, date, tz);
    } catch {
      return c.json({ error: 'Date must be YYYY-MM-DD' }, 400);
    }
    const after = addDays(bounds.days[bounds.days.length - 1], 1);
    const bySubject = new Map<number | null, { name: string; seconds: number }>();
    for (const day of focusByDay(ctx.db, bounds.days[0], after, tz, ctx.now()).values()) {
      for (const [subjectId, s] of day) {
        bySubject.set(subjectId, { name: s.name, seconds: (bySubject.get(subjectId)?.seconds ?? 0) + s.seconds });
      }
    }
    return c.json(sortedSlices(bySubject));
  });

  routes.get('/heatmap', (c) => {
    const today = dayKey(ctx.now(), tz);
    const raw = c.req.query('year') ?? today.slice(0, 4);
    if (!YEAR.test(raw)) return c.json({ error: 'Year must be YYYY' }, 400);
    const year = Number(raw);
    const first = `${raw}-01-01`;
    const after = `${year + 1}-01-01`;
    const byDay = focusByDay(ctx.db, first, after, tz, ctx.now());

    const days: HeatmapDay[] = [];
    const active = new Set<string>();
    for (let date = first; date < after; date = addDays(date, 1)) {
      const subjects = sortedSlices(byDay.get(date) ?? new Map());
      const seconds = subjects.reduce((sum, s) => sum + s.seconds, 0);
      if (seconds > 0) active.add(date);
      days.push({ date, seconds, level: heatmapLevel(seconds), subjects });
    }

    const { longest, current } = streaks(active, today);
    const body: HeatmapStats = {
      days,
      totals: { seconds: days.reduce((sum, d) => sum + d.seconds, 0), activeDays: active.size, longestStreak: longest, currentStreak: current },
      years: (ctx.db.prepare('SELECT DISTINCT substr(started_at, 1, 4) AS y FROM focus_sessions ORDER BY y').all() as { y: string }[])
        .map((r) => Number(r.y))
        .filter((y) => y >= 1000 && y <= 9999),
    };
    return c.json(body);
  });

  return routes;
}
