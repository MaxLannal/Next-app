import { randomBytes } from 'node:crypto';
import { createReadStream, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { isDayKey, type Trace } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';

/** Photos a phone or camera sends; what isn't one of these is refused. */
const PHOTO_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};
const MAX_PHOTOS_BYTES = 200 * 1024 * 1024;
const ID = '/:id{[0-9]+}';

type TraceRow = { id: number; lng: number; lat: number; city: string; country: string; day: string | null; notes: string; created_at: string };
type PhotoRow = { id: number; trace_id: number; file: string; mime: string };
type Fields = { lng?: number; lat?: number; city?: string; country?: string; day?: string | null; notes?: string; essayIds?: number[] };

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v.trim() : null);

/** The fields present in `body`, checked; an error names the first bad one. */
function readFields(body: Record<string, unknown>, needPlace: boolean): { error: string } | { fields: Fields } {
  const fields: Fields = {};
  if (body.lng !== undefined || needPlace) {
    if (typeof body.lng !== 'number' || !(body.lng >= -180 && body.lng <= 180)) return { error: 'Longitude must be between -180 and 180' };
    fields.lng = body.lng;
  }
  if (body.lat !== undefined || needPlace) {
    if (typeof body.lat !== 'number' || !(body.lat >= -90 && body.lat <= 90)) return { error: 'Latitude must be between -90 and 90' };
    fields.lat = body.lat;
  }
  for (const key of ['city', 'country'] as const) {
    if (body[key] === undefined) continue;
    const value = text(body[key], 120);
    if (value === null) return { error: `The ${key} must be text, at most 120 characters` };
    fields[key] = value;
  }
  if (body.notes !== undefined) {
    const value = text(body.notes, 20_000);
    if (value === null) return { error: 'Notes must be text' };
    fields.notes = value;
  }
  if (body.day !== undefined) {
    if (body.day === null || body.day === '') fields.day = null;
    else if (isDayKey(body.day)) fields.day = body.day;
    else return { error: 'The date must be a real YYYY-MM-DD day' };
  }
  if (body.essayIds !== undefined) {
    const ids = body.essayIds;
    if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id) && id > 0)) return { error: 'Essays must be a list of essay ids' };
    fields.essayIds = [...new Set(ids as number[])];
  }
  return { fields };
}

/** Mounted at `/api/traces`. Photos live under the data folder's `files/traces`. */
export function traceRoutes(ctx: AppContext): Hono {
  const routes = new Hono();
  const photoDir = () => join(ctx.paths.filesDir, 'traces');

  const toTrace = (row: TraceRow): Trace => ({
    id: row.id,
    lng: row.lng,
    lat: row.lat,
    city: row.city,
    country: row.country,
    day: row.day,
    notes: row.notes,
    createdAt: row.created_at,
    photos: (ctx.db.prepare('SELECT id FROM trace_photos WHERE trace_id = ? ORDER BY id').all(row.id) as { id: number }[]).map((p) => ({
      id: p.id,
      url: `/api/traces/photos/${p.id}`,
    })),
    essays: ctx.db
      .prepare('SELECT e.id, e.title FROM trace_essays t JOIN essays e ON e.id = t.essay_id WHERE t.trace_id = ? ORDER BY e.updated_at DESC')
      .all(row.id) as { id: number; title: string }[],
  });

  const find = (id: number) => {
    const row = ctx.db.prepare('SELECT * FROM traces WHERE id = ?').get(id) as TraceRow | undefined;
    return row ? toTrace(row) : null;
  };

  /** Links exactly these essays; false, changing nothing, if any isn't an essay. */
  const linkEssays = (id: number, essayIds: number[]): boolean => {
    for (const essayId of essayIds) if (!ctx.db.prepare('SELECT 1 FROM essays WHERE id = ?').get(essayId)) return false;
    ctx.db.prepare('DELETE FROM trace_essays WHERE trace_id = ?').run(id);
    for (const essayId of essayIds) ctx.db.prepare('INSERT INTO trace_essays (trace_id, essay_id) VALUES (?, ?)').run(id, essayId);
    return true;
  };

  const removeFile = (file: string) => rmSync(join(photoDir(), file), { force: true });

  // The token the globe draws with, from config.json; null until one is set.
  routes.get('/map', (c) => c.json({ token: ctx.config.get().mapbox?.token ?? null }));

  routes.get('/', (c) => {
    const rows = ctx.db.prepare('SELECT * FROM traces ORDER BY COALESCE(day, substr(created_at, 1, 10)) DESC, id DESC').all() as TraceRow[];
    return c.json(rows.map(toTrace));
  });

  routes.post('/', async (c) => {
    const read = readFields(await jsonBody(c), true);
    if ('error' in read) return c.json({ error: read.error }, 400);
    const f = read.fields;
    ctx.db.exec('BEGIN');
    try {
      const { lastInsertRowid } = ctx.db
        .prepare('INSERT INTO traces (lng, lat, city, country, day, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(f.lng!, f.lat!, f.city ?? '', f.country ?? '', f.day ?? null, f.notes ?? '', ctx.now().toISOString());
      const id = Number(lastInsertRowid);
      if (f.essayIds !== undefined && !linkEssays(id, f.essayIds)) {
        ctx.db.exec('ROLLBACK');
        return c.json({ error: 'No such essay' }, 400);
      }
      ctx.db.exec('COMMIT');
      return c.json(find(id), 201);
    } catch (err) {
      ctx.db.exec('ROLLBACK');
      throw err;
    }
  });

  routes.patch(ID, async (c) => {
    const id = Number(c.req.param('id'));
    if (find(id) === null) return c.json({ error: 'Not found' }, 404);
    const read = readFields(await jsonBody(c), false);
    if ('error' in read) return c.json({ error: read.error }, 400);
    const { essayIds, ...columns } = read.fields;
    ctx.db.exec('BEGIN');
    try {
      for (const [key, value] of Object.entries(columns)) ctx.db.prepare(`UPDATE traces SET ${key} = ? WHERE id = ?`).run(value, id);
      if (essayIds !== undefined && !linkEssays(id, essayIds)) {
        ctx.db.exec('ROLLBACK');
        return c.json({ error: 'No such essay' }, 400);
      }
      ctx.db.exec('COMMIT');
    } catch (err) {
      ctx.db.exec('ROLLBACK');
      throw err;
    }
    return c.json(find(id));
  });

  routes.delete(ID, (c) => {
    const id = Number(c.req.param('id'));
    const photos = ctx.db.prepare('SELECT file FROM trace_photos WHERE trace_id = ?').all(id) as { file: string }[];
    const { changes } = ctx.db.prepare('DELETE FROM traces WHERE id = ?').run(id);
    if (Number(changes) === 0) return c.json({ error: 'Not found' }, 404);
    for (const p of photos) removeFile(p.file);
    return c.body(null, 204);
  });

  routes.post(
    `${ID}/photos`,
    bodyLimit({ maxSize: MAX_PHOTOS_BYTES, onError: (c) => c.json({ error: 'Too much at once — 200 MB max' }, 413) }),
    async (c) => {
      const id = Number(c.req.param('id'));
      if (find(id) === null) return c.json({ error: 'Not found' }, 404);
      const body = await c.req.parseBody({ all: true }).catch(() => null);
      const files = [body?.files ?? []].flat().filter((f): f is File => f instanceof File);
      if (files.length === 0) return c.json({ error: 'No photos' }, 400);
      if (files.some((f) => PHOTO_TYPES[extname(f.name).toLowerCase()] === undefined)) {
        return c.json({ error: 'Photos only: JPEG, PNG, HEIC, WebP or GIF' }, 400);
      }
      mkdirSync(photoDir(), { recursive: true });
      for (const f of files) {
        const ext = extname(f.name).toLowerCase();
        const file = `${id}-${randomBytes(8).toString('hex')}${ext}`;
        writeFileSync(join(photoDir(), file), Buffer.from(await f.arrayBuffer()));
        ctx.db
          .prepare('INSERT INTO trace_photos (trace_id, file, mime, created_at) VALUES (?, ?, ?, ?)')
          .run(id, file, PHOTO_TYPES[ext]!, ctx.now().toISOString());
      }
      return c.json(find(id), 201);
    },
  );

  routes.get(`/photos${ID}`, (c) => {
    const row = ctx.db.prepare('SELECT * FROM trace_photos WHERE id = ?').get(Number(c.req.param('id'))) as PhotoRow | undefined;
    if (!row) return c.json({ error: 'Not found' }, 404);
    const path = join(photoDir(), row.file);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return c.json({ error: 'Photo missing' }, 404);
    }
    c.header('Content-Type', row.mime);
    c.header('Content-Length', String(size));
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream);
  });

  routes.delete(`/photos${ID}`, (c) => {
    const id = Number(c.req.param('id'));
    const row = ctx.db.prepare('SELECT * FROM trace_photos WHERE id = ?').get(id) as PhotoRow | undefined;
    if (!row) return c.json({ error: 'Not found' }, 404);
    ctx.db.prepare('DELETE FROM trace_photos WHERE id = ?').run(id);
    removeFile(row.file);
    return c.json(find(row.trace_id));
  });

  return routes;
}
