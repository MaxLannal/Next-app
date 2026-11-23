import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Trace } from '../../shared/types.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';
import { convertStoredPhotos } from './traces.ts';

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

function essay(title: string): number {
  const { lastInsertRowid } = t.db
    .prepare(
      `INSERT INTO essays (column_key, title, content_json, plain_text, word_count, created_at, updated_at)
       VALUES ('meditations', ?, '{}', '', 0, '2026-11-20T10:00:00.000Z', '2026-11-20T10:00:00.000Z')`,
    )
    .run(title);
  return Number(lastInsertRowid);
}

it('pins a place with its day, what happened, photos and essays, and takes them away again', async () => {
  const essayId = essay('Rain in Gion');
  const res = await t.req('POST', '/api/traces', { lng: 135.77, lat: 35.01, city: 'Kyoto', country: 'Japan', day: '2026-04-02', notes: 'Temples at dawn', essayIds: [essayId] });
  expect(res.status).toBe(201);
  const trace = (await res.json()) as Trace;
  expect(trace).toMatchObject({ city: 'Kyoto', country: 'Japan', day: '2026-04-02', notes: 'Temples at dawn', photos: [], essays: [{ id: essayId, title: 'Rain in Gion' }] });

  const form = new FormData();
  form.append('files', new File(['jpeg bytes'], 'IMG_0001.JPG'));
  const withPhoto = (await (await t.req('POST', `/api/traces/${trace.id}/photos`, form)).json()) as Trace;
  expect(withPhoto.photos).toHaveLength(1);
  const photo = await t.req('GET', withPhoto.photos[0]!.url);
  expect(photo.status).toBe(200);
  expect(photo.headers.get('content-type')).toBe('image/jpeg');
  expect(await photo.text()).toBe('jpeg bytes');

  const edited = (await (await t.req('PATCH', `/api/traces/${trace.id}`, { notes: 'Temples at dawn, then rain', essayIds: [] })).json()) as Trace;
  expect(edited.notes).toBe('Temples at dawn, then rain');
  expect(edited.essays).toEqual([]);
  expect(((await (await t.req('GET', '/api/traces')).json()) as Trace[]).map((x) => x.city)).toEqual(['Kyoto']);

  expect((await t.req('DELETE', `/api/traces/${trace.id}`)).status).toBe(204);
  expect((await t.req('GET', withPhoto.photos[0]!.url)).status).toBe(404);
});

it('refuses a place off the globe, a made-up day, an unknown essay and a file that is not a photo', async () => {
  expect((await t.req('POST', '/api/traces', { lng: 200, lat: 0 })).status).toBe(400);
  expect((await t.req('POST', '/api/traces', { lng: 0, lat: 0, day: '2026-02-30' })).status).toBe(400);
  expect((await t.req('POST', '/api/traces', { lng: 0, lat: 0, essayIds: [99] })).status).toBe(400);
  const trace = (await (await t.req('POST', '/api/traces', { lng: 0, lat: 0 })).json()) as Trace;
  const form = new FormData();
  form.append('files', new File(['#!/bin/sh'], 'run.sh'));
  expect((await t.req('POST', `/api/traces/${trace.id}/photos`, form)).status).toBe(400);
});

async function upload(traceId: number, name: string, bytes = 'photo bytes'): Promise<Trace> {
  const form = new FormData();
  form.append('files', new File([bytes], name));
  const res = await t.req('POST', `/api/traces/${traceId}/photos`, form);
  expect(res.status).toBe(201);
  return (await res.json()) as Trace;
}

it('keeps an iPhone HEIC photo as a JPEG, at most 2560 px on its longest side', async () => {
  const trace = (await (await t.req('POST', '/api/traces', { lng: -87.63, lat: 41.88, city: 'Chicago' })).json()) as Trace;
  const after = await upload(trace.id, 'IMG_0002.HEIC');
  const [call] = t.fakes.mac.calls.convertImage;
  expect(call?.[0]).toMatch(/\.heic$/);
  expect(call?.[1]).toMatch(/\.jpg$/);
  expect(call?.[2]).toBe(2560);
  const photo = await t.req('GET', after.photos[0]!.url);
  expect(photo.headers.get('content-type')).toBe('image/jpeg');
});

it('keeps a HEIC photo as it came when the Mac can’t convert it', async () => {
  t.fakes.mac.convertImage = async () => {
    throw new Error('sips is not available on this machine');
  };
  const trace = (await (await t.req('POST', '/api/traces', { lng: 0, lat: 0 })).json()) as Trace;
  const after = await upload(trace.id, 'IMG_0003.heic', 'heic bytes');
  const photo = await t.req('GET', after.photos[0]!.url);
  expect(photo.headers.get('content-type')).toBe('image/heic');
  expect(await photo.text()).toBe('heic bytes');
});

it('converts photos already kept as HEIC, under a new address so no cache serves the old one', async () => {
  const convert = t.fakes.mac.convertImage;
  t.fakes.mac.convertImage = async () => {
    throw new Error('not now');
  };
  const trace = (await (await t.req('POST', '/api/traces', { lng: 0, lat: 0 })).json()) as Trace;
  const before = (await upload(trace.id, 'IMG_0004.HEIC')).photos[0]!;
  t.fakes.mac.convertImage = convert;

  expect(await convertStoredPhotos(t)).toBe(1);
  const after = ((await (await t.req('GET', '/api/traces')).json()) as Trace[])[0]!.photos[0]!;
  expect(after.id).toBe(before.id);
  expect(after.url).not.toBe(before.url);
  expect((await t.req('GET', after.url)).headers.get('content-type')).toBe('image/jpeg');
  expect(await convertStoredPhotos(t)).toBe(0);
});

it('hands the globe its token from the config', async () => {
  expect(await (await t.req('GET', '/api/traces/map')).json()).toEqual({ token: null });
  t.config.update({ mapbox: { token: 'pk.test' } });
  expect(await (await t.req('GET', '/api/traces/map')).json()).toEqual({ token: 'pk.test' });
});
