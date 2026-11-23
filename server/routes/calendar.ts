import { Hono } from 'hono';
import type { CalendarResponse } from '../../shared/types.ts';
import { UnavailableError, type AppContext } from '../context.ts';

const CACHE_MS = 5 * 60_000;
const NOT_GRANTED = { error: 'Calendar access not granted', fix: 'Run npm run setup in Terminal on the Mac' };

const parseInstant = (value: string | undefined) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

/**
 * `GET /api/calendar?from=<ISO>&to=<ISO>`: the events in a range, from the Mac's
 * calendars. Each range is read at most once every five minutes; a read in
 * flight is shared, and a refusal isn't kept, so a fresh grant shows at once.
 */
export function calendarRoutes(ctx: AppContext): Hono {
  const routes = new Hono();
  const cache = new Map<string, { at: number; result: Promise<CalendarResponse> }>();

  routes.get('/', async (c) => {
    const from = parseInstant(c.req.query('from'));
    const to = parseInstant(c.req.query('to'));
    if (!from || !to || to <= from) return c.json({ error: 'from and to must be ISO instants, from before to' }, 400);

    const now = ctx.now().getTime();
    for (const [key, entry] of cache) if (now - entry.at >= CACHE_MS) cache.delete(key);

    const key = `${from.toISOString()}/${to.toISOString()}`;
    let entry = cache.get(key);
    if (!entry) {
      const result = ctx.mac.calendarEvents(from, to);
      entry = { at: now, result };
      cache.set(key, entry);
      const stored = entry;
      result.catch(() => {
        if (cache.get(key) === stored) cache.delete(key);
      });
    }

    try {
      return c.json(await entry.result);
    } catch (err) {
      if (err instanceof UnavailableError) return c.json(NOT_GRANTED, 503);
      throw err;
    }
  });

  return routes;
}
