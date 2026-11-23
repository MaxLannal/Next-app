import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Trace } from '../../shared/types.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';

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

it('hands the globe its token from the config', async () => {
  expect(await (await t.req('GET', '/api/traces/map')).json()).toEqual({ token: null });
  t.config.update({ mapbox: { token: 'pk.test' } });
  expect(await (await t.req('GET', '/api/traces/map')).json()).toEqual({ token: 'pk.test' });
});
