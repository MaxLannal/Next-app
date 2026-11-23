// Sleep in and out: the iPhone Shortcut's POST, a one-off Health export, and the dashboard's read.
// Mounted at `/api/ingest` (the two writes) and at `/api/sleep` (the read).

import { Hono, type Context } from 'hono';
import busboy from 'busboy';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import yauzl from 'yauzl';
import type { SleepNight, SleepSample } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import { parseHealthExport } from '../lib/health-export.ts';
import { groupNights, parseShortcutPayload } from '../lib/sleep.ts';

const DEFAULT_NIGHTS = 14;
const MAX_NIGHTS = 366;
/** A Health export is large; 2 GB leaves room for one and refuses the next. */
const MAX_EXPORT_BYTES = 2 * 1024 * 1024 * 1024;

/** The score's target. The panel's "8 h" and this agree until a setting changes the target. */
const TARGET_HOURS = 8;


/** Stores samples once each; the table's UNIQUE (start, end, stage, source) makes a repeat a no-op. */
export function storeSamples(ctx: AppContext, samples: SleepSample[]): number {
  const insert = ctx.db.prepare('INSERT OR IGNORE INTO sleep_samples (start, end, stage, source) VALUES (?, ?, ?, ?)');
  let inserted = 0;
  ctx.db.exec('BEGIN');
  try {
    for (const s of samples) inserted += Number(insert.run(s.start, s.end, s.stage, s.source).changes);
    ctx.db.exec('COMMIT');
  } catch (err) {
    ctx.db.exec('ROLLBACK');
    throw err;
  }
  return inserted;
}

/** Every stored sample, oldest first. */
export function allSamples(db: AppContext['db']): SleepSample[] {
  return db.prepare('SELECT start, end, stage, source FROM sleep_samples ORDER BY start, end').all() as SleepSample[];
}

/** Nights from the stored samples, newest last. */
export function nightsFrom(ctx: AppContext): SleepNight[] {
  return groupNights(allSamples(ctx.db), ctx.timeZone(), TARGET_HOURS);
}

/** The first `apple_health_export/export.xml` inside a zip, streamed out by `yauzl`. */
function openExportFromZip(path: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(new Error('This zip could not be opened'));
        return;
      }
      const done = (error: Error | null, stream: Readable | null) => {
        zip.close();
        if (error || !stream) reject(error ?? new Error('No apple_health_export/export.xml in this zip'));
        else resolve(stream);
      };
      zip.on('entry', (entry: yauzl.Entry) => {
        if (/\/export\.xml$/i.test(entry.fileName) && /(^|\/)apple_health_export\//i.test(entry.fileName)) {
          zip.openReadStream(entry, (openErr, stream) => done(openErr ? new Error('Could not read export.xml') : null, stream ?? null));
          return;
        }
        zip.readEntry();
      });
      zip.on('end', () => done(null, null));
      zip.on('error', () => done(new Error('This zip could not be opened'), null));
      zip.readEntry();
    });
  });
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * One uploaded file to disk, under `dir`. busboy streams the parts; the file's bytes go straight
 * into a write stream, and its `close` event means the whole body was read.
 */
async function receiveUpload(c: Context, dir: string): Promise<{ path: string; name: string } | { error: string; status: 400 | 413 }> {
  const contentType = c.req.header('content-type') ?? '';
  if (!/multipart\/form-data/i.test(contentType)) return { error: 'Expected multipart form data', status: 400 };
  if (!c.req.raw.body) return { error: 'No file', status: 400 };

  const stream = Readable.fromWeb(c.req.raw.body as Parameters<typeof Readable.fromWeb>[0]);
  const form = busboy({ headers: { 'content-type': contentType }, limits: { fileSize: MAX_EXPORT_BYTES, files: 1 } });
  const closed = new Promise<void>((resolve) => form.on('close', () => resolve()));

  let path: string | null = null;
  let name = '';
  let saved: Promise<{ error: string } | null> = Promise.resolve(null);
  form.on('file', (_field, file, info) => {
    path = join(dir, `export${extname(info.filename ?? '') || '.xml'}`);
    name = info.filename ?? 'export.xml';
    const dest = createWriteStream(path);
    saved = new Promise((resolve) => {
      let tooBig = false;
      file.on('limit', () => {
        tooBig = true;
      });
      file.pipe(dest);
      dest.on('finish', () => resolve(tooBig ? { error: 'That file is too large — 2 GB max' } : null));
      dest.on('error', () => resolve({ error: 'Could not save the upload' }));
    });
  });
  const failure = new Promise<{ error: string }>((resolve) => form.on('error', (err: Error) => resolve({ error: err.message })));
  stream.pipe(form);
  const first = await Promise.race([closed, failure]);
  if (first) return { error: `Could not read the upload: ${first.error}`, status: 400 };
  if (path === null) return { error: 'No file', status: 400 };
  const problem = await saved;
  if (problem) return { error: problem.error, status: problem.error.includes('too large') ? 413 : 400 };
  return { path: path as string, name };
}

/** The rows already stored, for a read at the end of the request. */
const countSamples = (db: AppContext['db']) => (db.prepare('SELECT COUNT(*) AS n FROM sleep_samples').get() as { n: number }).n;

/** The two writes, mounted at `/api/ingest`. Both answer `{ inserted }`, plus `nights` on the Shortcut's. */
export function sleepIngestRoutes(ctx: AppContext): Hono {
  const routes = new Hono();

  // The iPhone Shortcut: `{samples}` as JSON, or `start;end;value;source` lines. A re-sent 7-day
  // window inserts nothing new.
  routes.post('/sleep', async (c) => {
    const body = await c.req.text();
    let samples: SleepSample[];
    try {
      samples = parseShortcutPayload(body, c.req.header('content-type') ?? '');
    } catch (err) {
      return c.json({ error: `Could not read the sleep data: ${messageOf(err)}` }, 400);
    }
    if (samples.length === 0) return c.json({ error: 'No sleep samples in the body' }, 400);
    const inserted = storeSamples(ctx, samples);
    return c.json({ inserted, nights: nightsFrom(ctx).length });
  });

  // A one-off Health export: an .xml, or a .zip holding apple_health_export/export.xml.
  routes.post('/health-export', async (c) => {
    const dir = await mkdtemp(join(ctx.paths.tmpDir, 'export-'));
    try {
      const upload = await receiveUpload(c, dir);
      if ('error' in upload) return c.json({ error: upload.error }, upload.status);
      const ext = extname(upload.name).toLowerCase();
      let stream: Readable;
      if (ext === '.zip') stream = await openExportFromZip(upload.path);
      else if (ext === '.xml') stream = createReadStream(upload.path);
      else return c.json({ error: 'Send the export as .xml, or the .zip Health made' }, 400);

      const before = countSamples(ctx.db);
      const batch: SleepSample[] = [];
      let failure: Error | null = null;
      try {
        for await (const sample of parseHealthExport(stream)) {
          batch.push(sample);
          if (batch.length >= 5000) storeSamples(ctx, batch.splice(0));
        }
        if (batch.length > 0) storeSamples(ctx, batch);
      } catch (err) {
        failure = err instanceof Error ? err : new Error(String(err));
      }
      if (failure) return c.json({ error: `Could not read the export: ${failure.message}` }, 400);
      return c.json({ inserted: countSamples(ctx.db) - before });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  return routes;
}

/** The read, mounted at `/api/sleep`: the last `nights` nights, the latest, and when data last came. */
export function sleepRoutes(ctx: AppContext): Hono {
  const routes = new Hono();

  routes.get('/', (c) => {
    const raw = c.req.query('nights');
    let count = DEFAULT_NIGHTS;
    if (raw !== undefined) {
      if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1 || Number(raw) > MAX_NIGHTS) {
        return c.json({ error: `nights must be 1–${MAX_NIGHTS}` }, 400);
      }
      count = Number(raw);
    }
    const all = nightsFrom(ctx);
    const nights = all.slice(-count);
    const lastNight: SleepNight | null = all.at(-1) ?? null;
    const last = ctx.db.prepare("SELECT MAX(end) AS at FROM sleep_samples").get() as { at: string | null };
    return c.json({ nights, lastNight, lastSyncAt: last.at });
  });

  return routes;
}
