import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import type { Resource, ResourceKind } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import { fetchMeta, fetchSiteIcon, ICON_TYPES, parseHttpUrl, RESOURCE_KINDS } from '../lib/resources.ts';

/** A site found to have no icon is asked again after this long. */
const NO_ICON_RETRY_MS = 7 * 24 * 3600 * 1000;
const ICON_FILES: [ext: string, type: string][] = [
  ['png', 'image/png'],
  ['ico', 'image/x-icon'],
  ['jpg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
];
const HOST = /^[a-z0-9.-]{1,253}$/;

type Row = {
  id: number;
  url: string;
  title: string;
  kind: ResourceKind;
  domain: string;
  thumbnail: string | null;
  note: string;
  done: number;
  created_at: string;
};

const toResource = (r: Row): Resource => ({
  id: r.id,
  url: r.url,
  title: r.title,
  kind: r.kind,
  domain: r.domain,
  thumbnail: r.thumbnail,
  note: r.note,
  done: r.done === 1,
  createdAt: r.created_at,
});

const isKind = (value: unknown): value is ResourceKind =>
  typeof value === 'string' && (RESOURCE_KINDS as readonly string[]).includes(value);

/** A path id as a number; 0 (which matches no row) when it isn't one. */
const idParam = (raw: string) => (/^\d{1,15}$/.test(raw) ? Number(raw) : 0);

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

/** Every resource, newest first; only those of `kind` when given. */
export function listResources(db: AppContext['db'], kind?: ResourceKind): Resource[] {
  const rows = (
    kind === undefined
      ? db.prepare('SELECT * FROM resources ORDER BY id DESC').all()
      : db.prepare('SELECT * FROM resources WHERE kind = ? ORDER BY id DESC').all(kind)
  ) as Row[];
  return rows.map(toResource);
}

/** Mounted at `/api/resources`. */
export function resourceRoutes(ctx: AppContext): Hono {
  const routes = new Hono();
  const byId = (id: number) => ctx.db.prepare('SELECT * FROM resources WHERE id = ?').get(id) as Row | undefined;

  // Each site's own icon, kept once per host in files/site-icons (YouTube's red one for every video
  // there). A host is asked once at a time, however many rows want it.
  const iconDir = () => join(ctx.paths.filesDir, 'site-icons');
  const hostOf = (url: string) => {
    const host = parseHttpUrl(url)?.hostname.toLowerCase() ?? '';
    return HOST.test(host) ? host : null;
  };
  const keptIcon = (host: string) =>
    ICON_FILES.map(([ext, type]) => ({ path: join(iconDir(), `${host}.${ext}`), type })).find((f) => existsSync(f.path));
  const asking = new Map<string, Promise<void>>();
  const ensureIcon = (host: string, url: string): Promise<void> => {
    if (keptIcon(host)) return Promise.resolve();
    const none = join(iconDir(), `${host}.none`);
    if (existsSync(none) && Date.now() - statSync(none).mtimeMs < NO_ICON_RETRY_MS) return Promise.resolve();
    let job = asking.get(host);
    if (!job) {
      job = (async () => {
        const icon = await fetchSiteIcon(url);
        mkdirSync(iconDir(), { recursive: true });
        if (icon) writeFileSync(join(iconDir(), `${host}.${ICON_TYPES[icon.type]}`), icon.bytes);
        else writeFileSync(none, '');
      })()
        .catch(() => {})
        .finally(() => asking.delete(host));
      asking.set(host, job);
    }
    return job;
  };

  routes.get('/:id/icon', async (c) => {
    const row = byId(idParam(c.req.param('id')));
    const host = row ? hostOf(row.url) : null;
    if (!row || !host) return c.json({ error: 'Not found' }, 404);
    await ensureIcon(host, row.url);
    const icon = keptIcon(host);
    if (!icon) return c.json({ error: 'No icon for this site' }, 404);
    // An icon is someone else's file: it's shown as an image and never runs as a page here.
    return new Response(readFileSync(icon.path), {
      headers: {
        'content-type': icon.type,
        'cache-control': 'private, max-age=604800',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  });

  routes.get('/', (c) => {
    const kind = c.req.query('kind') || undefined;
    if (kind !== undefined && !isKind(kind)) return c.json({ error: 'Kind must be pdf, video, course or link' }, 400);
    return c.json(listResources(ctx.db, kind));
  });

  // Waits for the title (8 s at most), so the reply is the finished row.
  routes.post('/', async (c) => {
    const url = parseHttpUrl((await jsonBody(c)).url);
    if (!url) return c.json({ error: "That doesn't look like a link" }, 400);
    const meta = await fetchMeta(url.href);
    const { lastInsertRowid } = ctx.db
      .prepare('INSERT INTO resources (url, title, kind, domain, thumbnail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(url.href, meta.title, meta.kind, meta.domain, meta.thumbnail, ctx.now().toISOString());
    // Start on the site's icon now, so it's there when the row asks for it.
    const host = hostOf(url.href);
    if (host) void ensureIcon(host, url.href);
    return c.json(toResource(byId(Number(lastInsertRowid)) as Row), 201);
  });

  routes.patch('/:id', async (c) => {
    const row = byId(idParam(c.req.param('id')));
    if (!row) return c.json({ error: 'Not found' }, 404);
    const { title, kind, note, done } = await jsonBody(c);

    if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
      return c.json({ error: "A title can't be empty" }, 400);
    }
    if (kind !== undefined && !isKind(kind)) return c.json({ error: 'Kind must be pdf, video, course or link' }, 400);
    if (note !== undefined && typeof note !== 'string') return c.json({ error: 'A note must be text' }, 400);
    if (done !== undefined && typeof done !== 'boolean') return c.json({ error: 'Done must be true or false' }, 400);

    ctx.db
      .prepare(
        `UPDATE resources SET title = coalesce(?, title), kind = coalesce(?, kind),
           note = coalesce(?, note), done = coalesce(?, done) WHERE id = ?`,
      )
      .run(
        typeof title === 'string' ? title.trim() : null,
        kind ?? null,
        typeof note === 'string' ? note.trim() : null,
        done === undefined ? null : done ? 1 : 0,
        row.id,
      );
    return c.json(toResource(byId(row.id) as Row));
  });

  routes.delete('/:id', (c) => {
    const { changes } = ctx.db.prepare('DELETE FROM resources WHERE id = ?').run(idParam(c.req.param('id')));
    return Number(changes) > 0 ? c.body(null, 204) : c.json({ error: 'Not found' }, 404);
  });

  return routes;
}
