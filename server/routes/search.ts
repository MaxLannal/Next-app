import { Hono } from 'hono';
import type { AppContext } from '../context.ts';
import { search } from '../lib/search.ts';

/** Mounted at `/api/search`. `GET /?q=` → `SearchHit[]`. */
export function searchRoutes(ctx: AppContext): Hono {
  const routes = new Hono();
  routes.get('/', (c) => c.json(search(ctx.db, c.req.query('q') ?? '')));
  return routes;
}
