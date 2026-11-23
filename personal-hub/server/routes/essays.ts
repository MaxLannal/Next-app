import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { EssayColumn } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import {
  createEssay,
  deleteEssay,
  ESSAY_COLUMNS,
  getEssay,
  listEssays,
  listSnapshots,
  restoreSnapshot,
  saveEssay,
  StaleSaveError,
  type EssaySave,
} from '../repo/essays.ts';
import { essayImageName, MAX_ESSAY_IMAGE_BYTES, readEssayImage, storeEssayImage } from '../repo/essayImages.ts';

const MAX_CONTENT_BYTES = 4 * 1024 * 1024;
const ID = '/:id{[0-9]+}';

/** A path id as a number; 0 (which matches no row) when it isn't one. */
const idParam = (raw: string) => (/^\d{1,15}$/.test(raw) ? Number(raw) : 0);

const isColumn = (value: unknown): value is EssayColumn =>
  typeof value === 'string' && (ESSAY_COLUMNS as readonly string[]).includes(value);

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** The save in a PUT body, or a message saying what's wrong with it. */
function parseSave(body: Record<string, unknown>): EssaySave | string {
  const { title, contentJson, plainText, wordCount, column, baseUpdatedAt } = body;
  if (typeof baseUpdatedAt !== 'string' || baseUpdatedAt === '') return 'Send the version you started from';
  if (title !== undefined && (typeof title !== 'string' || title.length > 10_000)) return 'A title is text';
  if (contentJson !== undefined && (typeof contentJson !== 'object' || contentJson === null)) {
    return 'contentJson must be a document';
  }
  if (plainText !== undefined && typeof plainText !== 'string') return 'plainText must be text';
  if (wordCount !== undefined && (typeof wordCount !== 'number' || !Number.isInteger(wordCount) || wordCount < 0)) {
    return 'wordCount must be a whole number of words';
  }
  if (column !== undefined && !isColumn(column)) return 'Column must be meditations, plans or insights';
  // plainText and wordCount pass the type check but go no further: the document is the source of truth.
  return { title: typeof title === 'string' ? title.trim() : undefined, contentJson, column, baseUpdatedAt };
}

/** Mounted at `/api/essays`. */
export function essayRoutes(ctx: AppContext): Hono {
  const routes = new Hono();

  routes.get('/', (c) => c.json(listEssays(ctx)));

  routes.post('/', async (c) => {
    const { column } = await jsonBody(c);
    if (!isColumn(column)) return c.json({ error: 'Column must be meditations, plans or insights' }, 400);
    return c.json(createEssay(ctx, column), 201);
  });

  routes.get(ID, (c) => {
    const essay = getEssay(ctx, idParam(c.req.param('id')));
    return essay ? c.json(essay) : c.json({ error: 'Not found' }, 404);
  });

  routes.put(
    ID,
    bodyLimit({ maxSize: MAX_CONTENT_BYTES, onError: (c) => c.json({ error: 'That essay is too long to save' }, 413) }),
    async (c) => {
      const id = idParam(c.req.param('id'));
      const save = parseSave(await jsonBody(c));
      if (typeof save === 'string') return c.json({ error: save }, 400);
      if (!getEssay(ctx, id)) return c.json({ error: 'Not found' }, 404);
      try {
        return c.json({ updatedAt: saveEssay(ctx, id, save) });
      } catch (err) {
        if (err instanceof StaleSaveError) return c.json({ error: 'Changed elsewhere', current: err.current }, 409);
        throw err;
      }
    },
  );

  routes.delete(ID, (c) => {
    if (!deleteEssay(ctx, idParam(c.req.param('id')))) return c.json({ error: 'Not found' }, 404);
    return c.body(null, 204);
  });

  routes.get(`${ID}/snapshots`, (c) => {
    const id = idParam(c.req.param('id'));
    return getEssay(ctx, id) ? c.json(listSnapshots(ctx, id)) : c.json({ error: 'Not found' }, 404);
  });

  routes.post(`${ID}/snapshots/:sid{[0-9]+}/restore`, (c) => {
    const id = idParam(c.req.param('id'));
    if (!getEssay(ctx, id)) return c.json({ error: 'Not found' }, 404);
    try {
      return c.json(restoreSnapshot(ctx, id, Number(c.req.param('sid'))));
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  });

  return routes;
}

/** Mounted at `/api/essay-images`. */
export function essayImageRoutes(ctx: AppContext): Hono {
  const routes = new Hono();

  routes.post(
    '/',
    bodyLimit({ maxSize: MAX_ESSAY_IMAGE_BYTES, onError: (c) => c.json({ error: 'Image too large — 20 MB max' }, 413) }),
    async (c) => {
      const body = await c.req.parseBody().catch(() => null);
      const file = body?.file;
      if (!(file instanceof File)) return c.json({ error: 'Expected an image in `file`' }, 400);
      const name = essayImageName(file.type);
      if (!name) return c.json({ error: 'Images must be JPEG, PNG, GIF or WebP' }, 400);
      return c.json({ url: storeEssayImage(ctx, name, Buffer.from(await file.arrayBuffer())) }, 201);
    },
  );

  // Only names this module made (`<uuid>.<ext>`) resolve; anything else, a path included, is a 404.
  routes.get('/:name', (c) => {
    const image = readEssayImage(ctx, c.req.param('name'));
    if (!image) return c.json({ error: 'Not found' }, 404);
    c.header('Content-Type', image.mime);
    c.header('Content-Length', String(image.bytes.length));
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Disposition', 'inline');
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(new Uint8Array(image.bytes));
  });

  return routes;
}
