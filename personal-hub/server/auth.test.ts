import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPasscode } from './auth.ts';
import { makeTestContext, type TestContext } from './test/helpers.ts';

const REMOTE = { remote: '100.101.1.2' };

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
  // A cookie-protected POST route, so origin and cookie checks can be seen to pass.
  t.app.post('/api/test-echo', (c) => c.json({ ok: true }));
});
afterEach(() => {
  t.cleanup();
});

const sessionCookie = () => `hub_session=${t.config.get().sessionSecret}`;
const login = (passcode: string) => t.req('POST', '/api/auth/login', { passcode }, REMOTE);

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
  const res = await t.req('GET', '/api/ping', undefined, { ...REMOTE, headers: { cookie: sessionCookie() } });
  expect(res.status).toBe(200);
});

it('remote with a wrong cookie is refused', async () => {
  const res = await t.req('GET', '/api/ping', undefined, { ...REMOTE, headers: { cookie: 'hub_session=nope' } });
  expect(res.status).toBe(401);
});

it('login sets cookie', async () => {
  t.config.update({ passcodeHash: await hashPasscode('1234') });

  const ok = await login('1234');
  expect(ok.status).toBe(200);
  const setCookie = ok.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain('hub_session=');
  expect(setCookie).toContain('HttpOnly');

  const cookie = setCookie.split(';')[0];
  const ping = await t.req('GET', '/api/ping', undefined, { ...REMOTE, headers: { cookie } });
  expect(ping.status).toBe(200);

  const wrong = await login('4321');
  expect(wrong.status).toBe(401);
  expect(wrong.headers.get('set-cookie')).toBeNull();
});

it('login without a passcode configured', async () => {
  const res = await login('1234');
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

it('an empty or missing secret lets nothing through', async () => {
  const real = t.config.get();
  for (const secret of ['', null]) {
    const broken = { ...real, sessionSecret: secret, hubToken: secret } as unknown as typeof real;
    t.config = { get: () => broken, update: t.config.update };

    const bare = await t.req('GET', '/api/ping', undefined, REMOTE);
    expect(bare.status).toBe(401);
    const emptyCookie = await t.req('GET', '/api/ping', undefined, { ...REMOTE, headers: { cookie: 'hub_session=' } });
    expect(emptyCookie.status).toBe(401);
    const emptyToken = await t.req('POST', '/api/ingest/sleep', {}, { ...REMOTE, headers: { authorization: 'Bearer ' } });
    expect(emptyToken.status).toBe(401);
  }
});

describe('host and origin checks', () => {
  it('loopback with a foreign Host is treated as remote', async () => {
    const res = await t.req('GET', '/api/ping', undefined, { headers: { host: 'evil.example:4747' } });
    expect(res.status).toBe(401);
  });

  it('loopback by 127.0.0.1 or [::1] needs no login', async () => {
    for (const host of ['127.0.0.1:4747', '[::1]:4747']) {
      const res = await t.req('GET', '/api/ping', undefined, { headers: { host } });
      expect(res.status).toBe(200);
    }
  });

  it('a cross-site POST is refused, even from loopback', async () => {
    const res = await t.req('POST', '/api/auth/login', { passcode: '1234' }, { headers: { origin: 'http://evil.example' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Cross-site request refused' });

    const opaque = await t.req('POST', '/api/test-echo', {}, { headers: { origin: 'null' } });
    expect(opaque.status).toBe(403);
  });

  it('a same-origin POST from loopback passes', async () => {
    t.config.update({ passcodeHash: await hashPasscode('1234') });
    const res = await t.req('POST', '/api/auth/login', { passcode: '1234' }, {
      headers: { origin: 'http://localhost:4747', host: 'localhost:4747' },
    });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
  });

  it('a POST without Origin passes (curl, the iOS Shortcut)', async () => {
    const res = await t.req('POST', '/api/test-echo', {});
    expect(res.status).toBe(200);
  });

  it('remote with cookie and a matching Origin passes; a foreign Origin does not', async () => {
    const headers = { cookie: sessionCookie(), host: '100.64.0.1:4747' };
    const same = await t.req('POST', '/api/test-echo', {}, { ...REMOTE, headers: { ...headers, origin: 'http://100.64.0.1:4747' } });
    expect(same.status).toBe(200);
    const foreign = await t.req('POST', '/api/test-echo', {}, { ...REMOTE, headers: { ...headers, origin: 'http://evil.example' } });
    expect(foreign.status).toBe(403);
  });

  it('GET is not origin-checked', async () => {
    const res = await t.req('GET', '/api/ping', undefined, { headers: { origin: 'http://evil.example' } });
    expect(res.status).toBe(200);
  });
});

describe('login throttling', () => {
  it('locks logins for 15 minutes after 5 failures', async () => {
    t.config.update({ passcodeHash: await hashPasscode('1234') });

    for (let i = 0; i < 5; i++) expect((await login('0000')).status).toBe(401);

    const locked = await login('1234');
    expect(locked.status).toBe(429);
    expect(await locked.json()).toEqual({ error: 'Too many attempts — try again in 15 min' });
    expect(locked.headers.get('set-cookie')).toBeNull();

    t.setNow('2026-11-22T18:14:30.000Z');
    expect(await (await login('1234')).json()).toEqual({ error: 'Too many attempts — try again in 1 min' });

    t.setNow('2026-11-22T18:16:00.000Z');
    expect((await login('1234')).status).toBe(200);
  });

  it('parallel guesses cannot exceed the limit', async () => {
    t.config.update({ passcodeHash: await hashPasscode('1234') });

    const results = await Promise.all(Array.from({ length: 10 }, () => login('0000')));
    const statuses = results.map((r) => r.status);

    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });

  it('a successful login resets the count', async () => {
    t.config.update({ passcodeHash: await hashPasscode('1234') });

    for (let i = 0; i < 4; i++) expect((await login('0000')).status).toBe(401);
    expect((await login('1234')).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login('0000')).status).toBe(401);
    expect((await login('1234')).status).toBe(200);
  });

  it('refuses a login body over 4 KB', async () => {
    t.config.update({ passcodeHash: await hashPasscode('1234') });
    const res = await login('x'.repeat(5000));
    expect(res.status).toBe(413);
  });
});
