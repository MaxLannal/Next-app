import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { Attachment } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import { servedAs } from '../lib/files.ts';
import {
  attachmentFiles,
  createAttachment,
  deleteAttachment,
  getAttachment,
  listAttachments,
  sessionExists,
  updateAttachment,
  type AttachmentFilter,
} from '../repo/attachments.ts';

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const ID = '/:id{[0-9]+}';

const parseId = (value: string): number | null => (/^[1-9][0-9]*$/.test(value) ? Number(value) : null);

/** RFC 5987 encoding for `filename*=`: encodeURIComponent leaves `'()*` bare, which it must not. */
const encodeFilename = (name: string) =>
  encodeURIComponent(name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

/** Streams a stored file. Types outside our own list go out as downloads, so nothing runs on this origin. */
function sendFile(c: Context, path: string, filename: string, mime: string): Response {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return c.json({ error: 'File missing' }, 404);
  }
  const { type, inline } = servedAs(mime);
  c.header('Content-Type', type);
  c.header('Content-Length', String(size));
  c.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeFilename(filename)}`);
  c.header('X-Content-Type-Options', 'nosniff');
  // Another site can't embed it either (loopback requests need no login).
  c.header('Cross-Origin-Resource-Policy', 'same-origin');
  return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream);
}

/** Mounted at `/api/attachments`. */
export function attachmentRoutes(ctx: AppContext): Hono {
  const routes = new Hono();

  routes.post(
    '/',
    bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: (c) => c.json({ error: 'Upload too large — 500 MB max' }, 413) }),
    async (c) => {
      const body = await c.req.parseBody({ all: true }).catch(() => null);
      if (!body) return c.json({ error: 'Expected multipart form data' }, 400);
      const files = [body.files ?? []].flat().filter((f): f is File => f instanceof File);
      if (files.length === 0) return c.json({ error: 'No files' }, 400);

      let sessionId: number | null = null;
      if (body.sessionId !== undefined && body.sessionId !== '') {
        sessionId = typeof body.sessionId === 'string' ? parseId(body.sessionId) : null;
        if (sessionId === null || !sessionExists(ctx.db, sessionId)) return c.json({ error: 'No such session' }, 400);
      }

      const created: Attachment[] = [];
      for (const file of files) {
        const bytes = Buffer.from(await file.arrayBuffer());
        created.push(createAttachment(ctx, { sessionId, filename: file.name, bytes }));
      }
      return c.json(created, 201);
    },
  );

  routes.get('/', (c) => {
    const { sessionId, unfiled, source } = c.req.query();
    const filter: AttachmentFilter = { unfiled: unfiled === '1' };
    if (sessionId !== undefined) {
      const id = parseId(sessionId);
      if (id === null) return c.json({ error: 'Bad sessionId' }, 400);
      filter.sessionId = id;
    }
    if (source !== undefined) {
      if (source !== 'upload' && source !== 'github') return c.json({ error: 'Bad source' }, 400);
      filter.source = source;
    }
    return c.json(listAttachments(ctx, filter));
  });

  routes.get(ID, (c) => {
    const attachment = getAttachment(ctx, Number(c.req.param('id')));
    return attachment ? c.json(attachment) : c.json({ error: 'Not found' }, 404);
  });

  routes.get(`${ID}/file`, (c) => {
    const found = attachmentFiles(ctx, Number(c.req.param('id')));
    if (!found) return c.json({ error: 'Not found' }, 404);
    return sendFile(c, found.file, found.attachment.filename, found.attachment.mime);
  });

  routes.get(`${ID}/preview`, (c) => {
    const found = attachmentFiles(ctx, Number(c.req.param('id')));
    if (!found?.preview) return c.json({ error: 'No preview' }, 404);
    const name = `${found.attachment.filename.replace(/\.[^.]*$/, '')}.jpg`;
    return sendFile(c, found.preview, name, 'image/jpeg');
  });

  routes.patch(ID, async (c) => {
    const id = Number(c.req.param('id'));
    if (!getAttachment(ctx, id)) return c.json({ error: 'Not found' }, 404);

    const body: unknown = await c.req.json().catch(() => null);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return c.json({ error: 'Expected a JSON object' }, 400);
    }
    const { extractedText, sessionId } = body as { extractedText?: unknown; sessionId?: unknown };
    if (extractedText !== undefined && typeof extractedText !== 'string') {
      return c.json({ error: 'extractedText must be text' }, 400);
    }
    if (sessionId !== undefined && sessionId !== null) {
      if (typeof sessionId !== 'number' || !Number.isInteger(sessionId) || !sessionExists(ctx.db, sessionId)) {
        return c.json({ error: 'No such session' }, 400);
      }
    }
    return c.json(updateAttachment(ctx, id, { extractedText, sessionId }));
  });

  routes.delete(ID, (c) => {
    if (!deleteAttachment(ctx, Number(c.req.param('id')))) return c.json({ error: 'Not found' }, 404);
    return c.body(null, 204);
  });

  return routes;
}
