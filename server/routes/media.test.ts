import { afterEach, beforeEach, expect, it } from 'vitest';
import type { NowPlaying } from '../../shared/types.ts';
import { UnavailableError } from '../context.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

it('status maps to ready / no-accessibility / missing', async () => {
  for (const status of ['ready', 'no-accessibility', 'missing'] as const) {
    t.fakes.mac.mediaStatus = async () => status;
    const res = await t.req('GET', '/api/media/status');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status });
  }
});

it('now returns the track', async () => {
  const track: NowPlaying = { title: 'Pink + White', artist: 'Frank Ocean', album: 'Blonde', artwork: null, playing: true };
  t.fakes.mac.nowPlaying = async () => track;

  const res = await t.req('GET', '/api/media/now');

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(track);
});

it('now unavailable returns null', async () => {
  t.fakes.mac.nowPlaying = async () => {
    throw new UnavailableError('MediaRemote is not available');
  };

  const res = await t.req('GET', '/api/media/now');

  expect(res.status).toBe(200);
  expect(await res.json()).toBeNull();
});

it('now null stays null', async () => {
  const res = await t.req('GET', '/api/media/now');

  expect(res.status).toBe(200);
  expect(await res.json()).toBeNull();
});

it('key posts the right arg', async () => {
  for (const key of ['play', 'next', 'previous'] as const) {
    const res = await t.req('POST', '/api/media/key', { key });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(t.fakes.mac.calls.mediaKey.at(-1)).toEqual([key]);
  }
  expect(t.fakes.mac.calls.mediaKey).toHaveLength(3);
});

it('rejects an unknown or missing key', async () => {
  expect((await t.req('POST', '/api/media/key', { key: 'volume' })).status).toBe(400);
  expect((await t.req('POST', '/api/media/key', {})).status).toBe(400);
  expect((await t.req('POST', '/api/media/key', 'play')).status).toBe(400);
  expect(t.fakes.mac.calls.mediaKey).toHaveLength(0);
});

it('a key that fails is 503 with the fix', async () => {
  t.fakes.mac.mediaKey = async () => {
    throw new UnavailableError('Media controls need Accessibility access');
  };

  const res = await t.req('POST', '/api/media/key', { key: 'play' });

  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({
    error: 'Media controls need Accessibility access',
    fix: 'Allow Hub in System Settings → Privacy & Security → Accessibility to control music',
  });
});
