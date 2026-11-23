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

it('updates the time zone and sleep target', async () => {
  const phone = await loggedIn(t);
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
  const phone = await loggedIn(t);
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
