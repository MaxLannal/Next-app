import { Hono } from 'hono';
import type { MediaStatus } from '../../shared/types.ts';
import { UnavailableError, type AppContext } from '../context.ts';

const KEYS = ['play', 'next', 'previous'] as const;
type MediaKey = (typeof KEYS)[number];
const isKey = (value: unknown): value is MediaKey => KEYS.includes(value as MediaKey);

const ALLOW_LINE = { error: 'Media controls need Accessibility access', fix: 'Allow Hub in System Settings → Privacy & Security → Accessibility to control music' };

/**
 * The experimental now-playing panel. `status` says whether the helper is built
 * and allowed; `now` is the track (null when there's no player, or MediaRemote
 * won't answer); `key` posts a media key, answering 204.
 */
export function mediaRoutes(ctx: AppContext): Hono {
  const routes = new Hono();

  routes.get('/status', async (c) => {
    const status: MediaStatus = await ctx.mac.mediaStatus();
    return c.json({ status });
  });

  // No player, or MediaRemote unavailable (the hub says null for both): the panel keeps its controls.
  routes.get('/now', async (c) => {
    try {
      return c.json(await ctx.mac.nowPlaying());
    } catch (err) {
      if (err instanceof UnavailableError) return c.json(null);
      throw err;
    }
  });

  routes.post('/key', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const key = (body as { key?: unknown } | null)?.key;
    if (!isKey(key)) return c.json({ error: 'key must be play, next or previous' }, 400);

    try {
      await ctx.mac.mediaKey(key);
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof UnavailableError) return c.json(ALLOW_LINE, 503);
      throw err;
    }
  });

  return routes;
}
