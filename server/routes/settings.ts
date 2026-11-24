import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { SettingsView } from '../../shared/types.ts';
import { hashPasscode, isLoopback } from '../auth.ts';
import { hubTimeZone } from '../config.ts';
import type { AppContext } from '../context.ts';
import { backupNow, lastBackupDay } from '../services/backup.ts';
import { execFileRun } from '../services/mac.ts';
import { ingestHost, tailscaleIp } from '../services/network.ts';

/** Task 1's login takes any passcode; the hub requires six characters or more. */
const MIN_PASSCODE = 6;
const DEFAULT_PORT = 4747;

const WALLPAPER_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};
/** A wallpaper's longest side once kept: sharp on a 5K display, far smaller than a camera original. */
const WALLPAPER_MAX_PX = 3840;
const WALLPAPER_MAX_BYTES = 60 * 1024 * 1024;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * `GET /api/settings` (the hub token only from this Mac), `PATCH /api/settings`
 * and `POST /api/settings/backup`. Changing the passcode or keep-awake is only
 * allowed from this Mac, so a logged-in phone can't lock its owner out.
 */
export function settingsRoutes(ctx: AppContext): Hono {
  const routes = new Hono();
  const port = ctx.config.get().port || DEFAULT_PORT;
  const run = ctx.run ?? execFileRun;

  const view = async (): Promise<Omit<SettingsView, 'hubToken'>> => {
    const cfg = ctx.config.get();
    const host = await ingestHost(run);
    return {
      hasPasscode: cfg.passcodeHash !== null,
      keepAwake: cfg.keepAwake,
      timeZone: hubTimeZone(cfg),
      sleepTargetHours: cfg.sleepTargetHours,
      dataDir: ctx.paths.dataDir,
      ingestUrl: host === null ? '' : `http://${host}:${port}/api/ingest/sleep`,
      ingestHost: host,
      tailscale: (await tailscaleIp(run)) !== null,
      github: ctx.git.status(),
      calendar: await ctx.mac.calendarStatus(),
      media: await ctx.mac.mediaStatus(),
      model: cfg.anthropic.model,
      lastBackupAt: lastBackupDay(ctx.paths.backupsDir),
    };
  };

  routes.get('/', async (c) => {
    const body = await view();
    return c.json(isLoopback(ctx, c) ? { ...body, hubToken: ctx.config.get().hubToken } : body);
  });

  routes.patch(
    '/',
    bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ error: 'Request too large' }, 413) }),
    async (c: Context) => {
      const body: unknown = await c.req.json().catch(() => null);
      if (!isRecord(body)) return c.json({ error: 'Send {"passcode": …, "keepAwake": …} as JSON' }, 400);

      const { passcode, keepAwake, timeZone, sleepTargetHours } = body;
      const wantsPasscode = passcode !== undefined;
      const wantsKeepAwake = keepAwake !== undefined;

      if (passcode !== undefined) {
        if (typeof passcode !== 'string' || passcode.length < MIN_PASSCODE) {
          return c.json({ error: `A passcode needs ${MIN_PASSCODE} characters or more` }, 400);
        }
        if (passcode.length > 128) return c.json({ error: 'That passcode is too long' }, 400);
      }
      if (keepAwake !== undefined && typeof keepAwake !== 'boolean') {
        return c.json({ error: 'keepAwake is true or false' }, 400);
      }
      if (timeZone !== undefined && (typeof timeZone !== 'string' || !isTimeZone(timeZone))) {
        return c.json({ error: 'That time zone isn’t one this Mac knows' }, 400);
      }
      if (sleepTargetHours !== undefined) {
        if (typeof sleepTargetHours !== 'number' || !Number.isFinite(sleepTargetHours) || sleepTargetHours < 4 || sleepTargetHours > 12) {
          return c.json({ error: 'A sleep target is between 4 and 12 hours' }, 400);
        }
      }

      if ((wantsPasscode || wantsKeepAwake) && !isLoopback(ctx, c)) {
        return c.json({ error: 'Change the passcode and keep-awake on the Mac itself' }, 403);
      }

      if (wantsPasscode) ctx.config.update({ passcodeHash: await hashPasscode(passcode as string) });
      if (wantsKeepAwake) {
        // Start caffeinate first: a Mac that can't start it keeps its real state in the config, not a hopeful one.
        const was = ctx.config.get().keepAwake;
        try {
          ctx.mac.keepAwake(keepAwake as boolean);
        } catch (err) {
          ctx.config.update({ keepAwake: was });
          return c.json({ error: `Couldn’t ${keepAwake === true ? 'keep' : 'stop keeping'} the Mac awake: ${(err as Error).message}` }, 503);
        }
        ctx.config.update({ keepAwake: keepAwake as boolean });
      }
      if (timeZone !== undefined || sleepTargetHours !== undefined) {
        ctx.config.update({
          ...(timeZone !== undefined ? { timeZone: timeZone as string } : {}),
          ...(sleepTargetHours !== undefined ? { sleepTargetHours: sleepTargetHours as number } : {}),
        });
      }

      const next = await view();
      return c.json(isLoopback(ctx, c) ? { ...next, hubToken: ctx.config.get().hubToken } : next);
    },
  );

  routes.post('/backup', (c) => c.json({ file: backupNow(ctx) }));

  // The dashboard's wallpaper: a photo of one's own in place of the fog. It is kept as a JPEG at
  // most 3840 px on its longest side (sips on the Mac), which also turns an iPhone's HEIC into
  // something every browser shows; without the Mac the original is kept.
  const wallpaperDir = () => join(ctx.paths.filesDir, 'wallpaper');
  const wallpaperFile = () => ctx.config.get().wallpaper?.file ?? null;
  const wallpaperUrl = (file: string | null) => (file === null ? null : `/api/settings/wallpaper/image?v=${encodeURIComponent(file)}`);
  const dropWallpaper = (file: string | null) => {
    if (file !== null) rmSync(join(wallpaperDir(), file), { force: true });
  };

  routes.get('/wallpaper', (c) => c.json({ url: wallpaperUrl(wallpaperFile()) }));

  routes.get('/wallpaper/image', (c) => {
    const file = wallpaperFile();
    const path = file === null ? null : join(wallpaperDir(), file);
    if (path === null || !existsSync(path)) return c.json({ error: 'No wallpaper' }, 404);
    c.header('Content-Type', WALLPAPER_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream');
    c.header('Content-Length', String(statSync(path).size));
    c.header('X-Content-Type-Options', 'nosniff');
    // Its address names the file, so a new wallpaper is a new address and this one can keep.
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream);
  });

  routes.put(
    '/wallpaper',
    bodyLimit({ maxSize: WALLPAPER_MAX_BYTES, onError: (c) => c.json({ error: 'That photo is too large — 60 MB max' }, 413) }),
    async (c) => {
      const body = await c.req.parseBody().catch(() => null);
      const upload = body?.file;
      if (!(upload instanceof File)) return c.json({ error: 'Choose a photo' }, 400);
      const ext = extname(upload.name).toLowerCase();
      if (WALLPAPER_TYPES[ext] === undefined) return c.json({ error: 'A photo, please: JPEG, PNG, WebP or HEIC' }, 400);

      mkdirSync(wallpaperDir(), { recursive: true });
      const base = randomBytes(8).toString('hex');
      const original = `${base}-original${ext}`;
      writeFileSync(join(wallpaperDir(), original), Buffer.from(await upload.arrayBuffer()));
      let file = original;
      try {
        await ctx.mac.convertImage(join(wallpaperDir(), original), join(wallpaperDir(), `${base}.jpg`), WALLPAPER_MAX_PX);
        rmSync(join(wallpaperDir(), original), { force: true });
        file = `${base}.jpg`;
      } catch {
        rmSync(join(wallpaperDir(), `${base}.jpg`), { force: true });
      }
      const previous = wallpaperFile();
      ctx.config.update({ wallpaper: { file } });
      dropWallpaper(previous);
      return c.json({ url: wallpaperUrl(file) });
    },
  );

  routes.delete('/wallpaper', (c) => {
    dropWallpaper(wallpaperFile());
    ctx.config.update({ wallpaper: { file: null } });
    return c.json({ url: null });
  });

  return routes;
}
