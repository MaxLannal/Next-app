import { Hono, type Context } from 'hono';
import type { AppContext } from '../context.ts';

const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** `GET /api/github/status`, `POST /api/github/connect {repo}`, `POST /api/github/sync`. */
export function githubRoutes(ctx: AppContext): Hono {
  const routes = new Hono();

  routes.get('/status', (c) => c.json(ctx.git.status()));

  routes.post('/connect', async (c: Context) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const repo = typeof body === 'object' && body !== null ? (body as { repo?: unknown }).repo : undefined;
    if (typeof repo !== 'string' || !REPO_NAME.test(repo.trim())) {
      return c.json({ error: 'A repository name looks like owner/name' }, 400);
    }
    const status = await ctx.git.connect(repo.trim());
    return c.json(status, status.lastError === null ? 200 : 502);
  });

  routes.post('/sync', async (c) => c.json(await ctx.git.pull()));

  return routes;
}
