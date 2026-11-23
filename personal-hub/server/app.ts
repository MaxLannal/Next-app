import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type MiddlewareHandler } from 'hono';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authMiddleware, authRoutes, isApiPath } from './auth.ts';
import type { AppContext } from './context.ts';
import { resourceRoutes } from './routes/resources.ts';
import { attachmentRoutes } from './routes/attachments.ts';
import { searchRoutes } from './routes/search.ts';
import { mediaRoutes } from './routes/media.ts';
import { sleepIngestRoutes, sleepRoutes } from './routes/sleep.ts';

const WEB_DIST = fileURLToPath(new URL('../web/dist', import.meta.url));

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();
  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.use('*', authMiddleware(ctx));

  app.get('/api/ping', (c) => c.json({ ok: true }));
  app.route('/api/auth', authRoutes(ctx));
  app.route('/api/resources', resourceRoutes(ctx));
  app.route('/api/attachments', attachmentRoutes(ctx));
  app.route('/api/search', searchRoutes(ctx));
  app.route('/api/github', githubRoutes(ctx));
  app.route('/api/ingest', sleepIngestRoutes(ctx));
  app.route('/api/sleep', sleepRoutes(ctx));

  app.use('*', webApp(WEB_DIST));
  return app;
}

/** Serves the built web app for non-API GETs, with index.html for client-side routes. */
function webApp(distDir: string): MiddlewareHandler {
  const indexFile = join(distDir, 'index.html');
  let assets: MiddlewareHandler | undefined;

  return async (c, next) => {
    if (isApiPath(c.req.path) || (c.req.method !== 'GET' && c.req.method !== 'HEAD')) return next();
    if (!existsSync(indexFile)) return c.text('Hub web app not built yet — run npm run build');

    assets ??= serveStatic({
      root: distDir,
      rewriteRequestPath: (path) =>
        extname(path) === '' && !existsSync(join(distDir, path)) ? '/index.html' : path,
    });
    return assets(c, next);
  };
}
