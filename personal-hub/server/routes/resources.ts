import { Hono, type Context } from 'hono';
import type { Resource, ResourceKind } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import { fetchMeta, parseHttpUrl, RESOURCE_KINDS } from '../lib/resources.ts';

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

/** Mounted at `/api/resources`. */
export function resourceRoutes(ctx: AppContext): Hono {
  const routes = new Hono();
  const byId = (id: number) => ctx.db.prepare('SELECT * FROM resources WHERE id = ?').get(id) as Row | undefined;

  routes.get('/', (c) => {
    const kind = c.req.query('kind') || undefined;
    if (kind !== undefined && !isKind(kind)) return c.json({ error: 'Kind must be pdf, video, course or link' }, 400);
    const rows = (
      kind === undefined
        ? ctx.db.prepare('SELECT * FROM resources ORDER BY id DESC').all()
        : ctx.db.prepare('SELECT * FROM resources WHERE kind = ? ORDER BY id DESC').all(kind)
    ) as Row[];
    return c.json(rows.map(toResource));
  });

  // Waits for the title (8 s at most), so the reply is the finished row.
  routes.post('/', async (c) => {
    const url = parseHttpUrl((await jsonBody(c)).url);
    if (!url) return c.json({ error: "That doesn't look like a link" }, 400);
    const meta = await fetchMeta(url.href);
    const { lastInsertRowid } = ctx.db
      .prepare('INSERT INTO resources (url, title, kind, domain, thumbnail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(url.href, meta.title, meta.kind, meta.domain, meta.thumbnail, ctx.now().toISOString());
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
