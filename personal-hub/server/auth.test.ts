import { afterEach, beforeEach, expect, it } from 'vitest';
import { hashPasscode } from './auth.ts';
import { makeTestContext, type TestContext } from './test/helpers.ts';

const REMOTE = { remote: '100.101.1.2' };

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

it('loopback needs no login', async () => {
  const res = await t.req('GET', '/api/ping');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

it('remote without cookie is refused', async () => {
  const res = await t.req('GET', '/api/ping', undefined, REMOTE);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'login required' });
});

it('remote with session cookie passes', async () => {
  const cookie = `hub_session=${t.config.get().sessionSecret}`;
  const res = await t.req('GET', '/api/ping', undefined, { ...REMOTE, headers: { cookie } });
  expect(res.status).toBe(200);
});

it('remote with a wrong cookie is refused', async () => {
  const res = await t.req('GET', '/api/ping', undefined, { ...REMOTE, headers: { cookie: 'hub_session=nope' } });
  expect(res.status).toBe(401);
});

it('login sets cookie', async () => {
  t.config.update({ passcodeHash: hashPasscode('1234') });

  const ok = await t.req('POST', '/api/auth/login', { passcode: '1234' }, REMOTE);
  expect(ok.status).toBe(200);
  const setCookie = ok.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain('hub_session=');
  expect(setCookie).toContain('HttpOnly');

  const cookie = setCookie.split(';')[0];
  const ping = await t.req('GET', '/api/ping', undefined, { ...REMOTE, headers: { cookie } });
  expect(ping.status).toBe(200);

  const wrong = await t.req('POST', '/api/auth/login', { passcode: '4321' }, REMOTE);
  expect(wrong.status).toBe(401);
  expect(wrong.headers.get('set-cookie')).toBeNull();
});

it('login without a passcode configured', async () => {
  const res = await t.req('POST', '/api/auth/login', { passcode: '1234' }, REMOTE);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: 'Set a passcode on the Mac first' });
});

it('ingest accepts the hub token', async () => {
  const { hubToken } = t.config.get();
  const ok = await t.req('POST', '/api/ingest/sleep', { samples: [] }, {
    ...REMOTE,
    headers: { authorization: `Bearer ${hubToken}` },
  });
  expect(ok.status).not.toBe(401);

  const wrong = await t.req('POST', '/api/ingest/sleep', { samples: [] }, {
    ...REMOTE,
    headers: { authorization: 'Bearer not-the-token' },
  });
  expect(wrong.status).toBe(401);
});

it('the hub token opens only ingest paths', async () => {
  const { hubToken } = t.config.get();
  const res = await t.req('GET', '/api/ping', undefined, {
    ...REMOTE,
    headers: { authorization: `Bearer ${hubToken}` },
  });
  expect(res.status).toBe(401);
});

it('non-api paths are public', async () => {
  const res = await t.req('GET', '/', undefined, REMOTE);
  expect(res.status).not.toBe(401);
  expect(res.status).toBe(200);
});
