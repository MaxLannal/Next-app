import { existsSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { makeTestContext, type TestContext } from '../test/helpers.ts';

let t: TestContext;
beforeEach(() => {
  // No tailscale on the test Mac: the first non-internal IPv4 is the answer.
  t = makeTestContext({ run: async () => ({ code: 127, stdout: '', stderr: 'command not found' }) });
});
afterEach(() => {
  t.cleanup();
});

const REMOTE = { remote: '100.101.102.103' };
const REMOTE_HEADERS = { ...REMOTE, headers: { origin: 'http://100.101.102.103:4747', host: '100.101.102.103:4747' } };

/** The phone: logged in, so it may read settings (but still can't change the passcode). */
async function loggedIn(t: TestContext) {
  await t.req('PATCH', '/api/settings', { passcode: '123456' });
  const res = await t.req('POST', '/api/auth/login', { passcode: '123456' }, REMOTE_HEADERS);
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { ...REMOTE_HEADERS, headers: { ...REMOTE_HEADERS.headers, cookie } };
}

async function get(init?: Parameters<TestContext['req']>[3]) {
  const res = await t.req('GET', '/api/settings', undefined, init);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function login(passcode: string, init?: Parameters<TestContext['req']>[3]) {
  const res = await t.req('POST', '/api/auth/login', { passcode }, init);
  return res.status;
}

it('token only on loopback', async () => {
  const local = await get();
  expect(local.status).toBe(200);
  expect(local.body.hubToken).toBe(t.config.get().hubToken);

  const remote = await get(await loggedIn(t));
  expect(remote.status).toBe(200);
  expect(remote.body).not.toHaveProperty('hubToken');
});

it('passcode change is loopback only', async () => {
  const phone = await loggedIn(t);
  const refused = await t.req('PATCH', '/api/settings', { passcode: '123456' }, phone);
  expect(refused.status).toBe(403);
  // Still the passcode the phone logged in with; the refused change left it alone.
  expect(t.config.get().passcodeHash).not.toBeNull();
  expect(t.config.get().passcodeHash).not.toBe('123456');

  const short = await t.req('PATCH', '/api/settings', { passcode: '12345' });
  expect(short.status).toBe(400);

  const ok = await t.req('PATCH', '/api/settings', { passcode: '123456' });
  expect(ok.status).toBe(200);
  expect((await ok.json()) as Record<string, unknown>).toMatchObject({ hasPasscode: true });

  expect(await login('123456', REMOTE_HEADERS)).toBe(200);
});

it('keep-awake is loopback only', async () => {
  const phone = await loggedIn(t);
  const refused = await t.req('PATCH', '/api/settings', { keepAwake: true }, phone);
  expect(refused.status).toBe(403);
  expect(t.config.get().keepAwake).toBe(false);

  const ok = await t.req('PATCH', '/api/settings', { keepAwake: true });
  expect(ok.status).toBe(200);
  expect(t.config.get().keepAwake).toBe(true);
  expect(t.fakes.mac.calls.keepAwake).toEqual([[true]]);
});

it('remote reads see the rest of the settings', async () => {
  await t.git.connect('max/work-journal');
  t.config.update({ timeZone: 'America/Chicago', sleepTargetHours: 7.5 });
  const { body } = await get(await loggedIn(t));
  expect(body).toMatchObject({
    hasPasscode: true,
    keepAwake: false,
    timeZone: 'America/Chicago',
    sleepTargetHours: 7.5,
    dataDir: t.paths.dataDir,
    calendar: 'granted',
    media: 'ready',
    model: 'claude-opus-5-5',
    lastBackupAt: null,
  });
  expect(body.ingestUrl).toMatch(/^http:\/\/[.:0-9a-fA-F]+:4747\/api\/ingest\/sleep$/);
  expect(body.github).toMatchObject({ configured: true, repo: 'max/work-journal' });
});

it('a Mac that can’t start keep-awake says so, and the config keeps its real state', async () => {
  t.fakes.mac.keepAwake = () => {
    throw new Error('caffeinate didn’t start');
  };
  const res = await t.req('PATCH', '/api/settings', { keepAwake: true });
  expect(res.status).toBe(503);
  expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: expect.stringContaining('caffeinate') });
  expect(t.config.get().keepAwake).toBe(false);
  const view = await get();
  expect(view.body.keepAwake).toBe(false);
});

it('the phone may change the time zone and sleep target, but not the passcode or keep-awake', async () => {
  const phone = await loggedIn(t);

  const zone = await t.req('PATCH', '/api/settings', { timeZone: 'America/Chicago', sleepTargetHours: 7.5 }, phone);
  expect(zone.status).toBe(200);
  expect(t.config.get()).toMatchObject({ timeZone: 'America/Chicago', sleepTargetHours: 7.5 });

  for (const patch of [{ passcode: '654321' }, { keepAwake: true }, { timeZone: 'Europe/Berlin', passcode: '654321' }]) {
    const res = await t.req('PATCH', '/api/settings', patch, phone);
    expect(res.status).toBe(403);
  }
  expect(t.config.get()).toMatchObject({ passcodeHash: expect.any(String), keepAwake: false, timeZone: 'America/Chicago' });

  const local = await t.req('PATCH', '/api/settings', { passcode: '654321' });
  expect(local.status).toBe(200);
  expect(await login('654321', REMOTE_HEADERS)).toBe(200);
});

it('updates the time zone and sleep target', async () => {
  const bad = await t.req('PATCH', '/api/settings', { sleepTargetHours: 0 });
  expect(bad.status).toBe(400);
  const badZone = await t.req('PATCH', '/api/settings', { timeZone: 'Mars/Olympus' });
  expect(badZone.status).toBe(400);

  const ok = await t.req('PATCH', '/api/settings', { timeZone: 'Europe/Berlin', sleepTargetHours: 7.5 });
  expect(ok.status).toBe(200);
  const body = (await ok.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ timeZone: 'Europe/Berlin', sleepTargetHours: 7.5 });
  expect(t.config.get().timeZone).toBe('Europe/Berlin');
});

it('backup makes a dated copy and reports it', async () => {
  t.setNow('2026-11-22T18:00:00.000Z');
  const res = await t.req('POST', '/api/settings/backup');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { file: string };
  expect(body.file).toBe(`${t.paths.backupsDir}/hub-2026-11-22.db`);
  expect(existsSync(body.file)).toBe(true);
  expect(readdirSync(t.paths.backupsDir)).toContain('hub-2026-11-22.db');

  const after = await get();
  expect(after.body.lastBackupAt).toBe('2026-11-22');
});

type WallpaperState = { url: string | null; current: string | null; photos: { file: string; url: string; thumb: string }[] };

const wallpaper = async () => (await (await t.req('GET', '/api/settings/wallpaper')).json()) as WallpaperState;

async function addPhotos(...names: string[]) {
  const form = new FormData();
  for (const name of names) form.append('files', new File(['image bytes'], name));
  return t.req('POST', '/api/settings/wallpaper/photos', form);
}

it('keeps a bank of photos to switch the wallpaper between', async () => {
  expect(await wallpaper()).toEqual({ url: null, current: null, photos: [] });
  const added = await addPhotos('forest.png', 'IMG_0001.HEIC');
  expect(added.status).toBe(200);
  const { photos } = (await added.json()) as WallpaperState;
  expect(photos).toHaveLength(2);
  // Kept as JPEGs no bigger than 3840 px, each with a small one for the bank's grid.
  expect(t.fakes.mac.calls.convertImage.map((call) => call[2])).toEqual([3840, 480, 3840, 480]);
  // Storing isn't choosing: the wallpaper is still the fog.
  expect((await wallpaper()).current).toBeNull();

  const pick = photos[1]!;
  const chosen = (await (await t.req('PUT', '/api/settings/wallpaper', { file: pick.file })).json()) as WallpaperState;
  expect(chosen.current).toBe(pick.file);
  expect(chosen.url).toBe(pick.url);
  expect((await t.req('GET', pick.url)).headers.get('content-type')).toBe('image/jpeg');
  expect((await t.req('GET', pick.thumb)).status).toBe(200);

  // Back to the fog keeps the photo in the bank.
  expect(((await (await t.req('PUT', '/api/settings/wallpaper', { file: null })).json()) as WallpaperState).current).toBeNull();
  expect((await wallpaper()).photos).toHaveLength(2);

  // Taking away the photo on the wall puts the fog back.
  await t.req('PUT', '/api/settings/wallpaper', { file: pick.file });
  const after = (await (await t.req('DELETE', `/api/settings/wallpaper/photos/${pick.file}`)).json()) as WallpaperState;
  expect(after.current).toBeNull();
  expect(after.photos.map((p) => p.file)).toEqual([photos[0]!.file]);
});

it('refuses a file that is not a photo, a photo not in the bank, and a way out of its folder', async () => {
  expect((await addPhotos('notes.txt')).status).toBe(400);
  expect((await t.req('PUT', '/api/settings/wallpaper', { file: '0123456789abcdef.jpg' })).status).toBe(400);
  expect((await t.req('GET', '/api/settings/wallpaper/image/..%2Fconfig.json')).status).toBe(404);
  expect((await t.req('DELETE', '/api/settings/wallpaper/photos/..%2Fconfig.json')).status).toBe(404);
});

const layoutOf = async (res: Response) =>
  ((await res.json()) as { layout: { version: number; pages: { name: string; panels: { id: string; x: number; y: number; w: number; h: number }[] }[] } }).layout;

it('keeps the dashboard layout arranged by hand, made safe to draw, and puts the first three back on null', async () => {
  const first = await layoutOf(await t.req('GET', '/api/settings/layout'));
  expect(first.pages.map((p) => p.name)).toEqual(['Today', 'Progress', 'Plans']);

  const sent = {
    version: 2,
    pages: [
      { name: '  Mornings ', panels: [{ id: 'sleep', x: 2, y: 3, w: 10, h: 20 }, { id: 'nope', x: 0, y: 0, w: 4, h: 4 }] },
      { name: '', panels: [{ id: 'sleep', x: 0, y: 0, w: 4, h: 4 }, { id: 'time', x: 20, y: 40, w: 99, h: 1 }] },
    ],
  };
  const saved = await layoutOf(await t.req('PUT', '/api/settings/layout', { layout: sent }));
  expect(saved).toEqual({
    version: 2,
    pages: [
      { name: 'Mornings', panels: [{ id: 'sleep', x: 2, y: 3, w: 10, h: 20 }] },
      { name: 'Page 2', panels: [{ id: 'time', x: 0, y: 40, w: 24, h: 6 }] },
    ],
  });
  expect(await layoutOf(await t.req('GET', '/api/settings/layout'))).toEqual(saved);

  // Fewer pages than before: the whole list is replaced, not merged into the old one.
  const one = await layoutOf(await t.req('PUT', '/api/settings/layout', { layout: { version: 2, pages: [{ name: 'Only', panels: [] }] } }));
  expect(one.pages).toEqual([{ name: 'Only', panels: [] }]);

  const reset = await layoutOf(await t.req('PUT', '/api/settings/layout', { layout: null }));
  expect(reset.pages.map((p) => p.name)).toEqual(['Today', 'Progress', 'Plans']);
  expect((await t.req('PUT', '/api/settings/layout', { pages: [] })).status).toBe(400);
});
