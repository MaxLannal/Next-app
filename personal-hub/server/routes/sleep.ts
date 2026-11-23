// Sleep in and out: the iPhone Shortcut's POST, a one-off Health export, and the dashboard's read.
// Mounted at `/api/ingest` (the two writes) and at `/api/sleep` (the read).

import { Hono, type Context } from 'hono';
import busboy from 'busboy';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import yauzl from 'yauzl';
import type { SleepIngestStatus, SleepNight, SleepSample } from '../../shared/types.ts';
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

const LAST_INGEST_KEY = 'sleep_last_ingest';

/** Remembers how the latest iPhone upload went, so a refused one shows in the app, not just on the phone. */
function rememberIngest(ctx: AppContext, status: SleepIngestStatus): void {
  ctx.db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(LAST_INGEST_KEY, JSON.stringify(status));
}

/** The latest iPhone upload's outcome, or null before the first one. */
export function lastIngest(db: AppContext['db']): SleepIngestStatus | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(LAST_INGEST_KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SleepIngestStatus;
  } catch {
    return null;
  }
}

/** Every stored sample, oldest first. */
export function allSamples(db: AppContext['db']): SleepSample[] {
  return db.prepare('SELECT start, end, stage, source FROM sleep_samples ORDER BY start, end').all() as SleepSample[];
}

/**
 * Grouping every stored night costs a pass over the table, so the result is kept until new data
 * lands. The newest sample's end identifies the stored set: samples are only ever added, and the
 * night a sample belongs to ends at or after it, so a newer end always means new grouping.
 */
const nightCache = new WeakMap<AppContext['db'], { newest: string | null; timeZone: string; nights: SleepNight[] }>();

/** The newest sample's end: the whole table's version as far as nights are concerned. */
function newestSample(db: AppContext['db']): string | null {
  return (db.prepare('SELECT MAX(end) AS at FROM sleep_samples').get() as { at: string | null }).at;
}

/** Nights from the stored samples, newest last. */
export function nightsFrom(ctx: AppContext): SleepNight[] {
  const newest = newestSample(ctx.db);
  const timeZone = ctx.timeZone();
  const cached = nightCache.get(ctx.db);
  if (cached && cached.newest === newest && cached.timeZone === timeZone) return cached.nights;
  const nights = groupNights(allSamples(ctx.db), timeZone, TARGET_HOURS);
  nightCache.set(ctx.db, { newest, timeZone, nights });
  return nights;
}

/**
 * The export's main XML: directly inside `apple_health_export/`, and not the clinical-document
 * file. Health names it after the phone's language (`export.xml`, `导出.xml`, `書き出す.xml`…), with
 * the clinical documents in `<same>_cda.xml`.
 */
export const isMainExportXml = (name: string) => /(^|\/)apple_health_export\/[^/]+\.xml$/i.test(name) && !/_cda\.xml$/i.test(name);

/** The export's main XML inside the zip Health makes, streamed out by `yauzl`. */
function openExportFromZip(path: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(new Error('This zip could not be opened'));
        return;
      }
      const done = (error: Error | null, stream: Readable | null) => {
        zip.close();
        if (error || !stream) reject(error ?? new Error('No Health export XML in this zip'));
        else resolve(stream);
      };
      zip.on('entry', (entry: yauzl.Entry) => {
        if (isMainExportXml(entry.fileName)) {
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
    const at = ctx.now().toISOString();
    const refuse = (error: string) => {
      // The Shortcut doesn't show an error reply, so the log and the app have to.
      console.error(`Sleep upload refused: ${error}`);
      rememberIngest(ctx, { ok: false, at, inserted: null, error });
      return c.json({ error }, 400);
    };
    let samples: SleepSample[];
    try {
      samples = parseShortcutPayload(body, c.req.header('content-type') ?? '', ctx.timeZone());
    } catch (err) {
      return refuse(`Could not read the sleep data: ${messageOf(err)}`);
    }
    if (samples.length === 0) return refuse('No sleep samples in the body');
    const inserted = storeSamples(ctx, samples);
    rememberIngest(ctx, { ok: true, at, inserted, error: null });
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
      if (ext === '.zip') {
        try {
          stream = await openExportFromZip(upload.path);
        } catch (err) {
          return c.json({ error: `Could not read the export: ${messageOf(err)}` }, 400);
        }
      }
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
    return c.json({ nights, lastNight, lastSyncAt: newestSample(ctx.db), lastIngest: lastIngest(ctx.db) });
  });

  return routes;
}
