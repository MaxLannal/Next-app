import { afterEach, beforeEach, expect, it } from 'vitest';
import { makeTestContext, type TestContext } from '../test/helpers.ts';

type Totals = { today: Record<string, number>; series: Record<string, { buckets: { label: string; value: number }[]; total: number; dailyAverage: number }> };

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

async function log(kind: string, count: unknown) {
  return t.req('POST', '/api/exercise', { kind, count });
}

async function get(query = ''): Promise<Totals> {
  const res = await t.req('GET', `/api/exercise${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Totals;
}

it('logs a set and totals today', async () => {
  const res = await log('pushups', 10);
  expect(res.status).toBe(201);
  await log('pushups', 5);
  await log('squats', 5);
  const body = await get();
  expect(body.today).toEqual({ pushups: 15, squats: 5 });
});

it('rejects bad counts', async () => {
  for (const count of [0, -5, 2.5, 20000, '10', null, undefined]) {
    const res = await log('pushups', count);
    expect(res.status).toBe(400);
  }
  expect((await log('pushups', 1)).status).toBe(201);
  expect((await log('pushups', 10000)).status).toBe(201);
  expect((await log('pushups', 10001)).status).toBe(400);
});

it('rejects a bad kind', async () => {
  const res = await log('burpees', 10);
  expect(res.status).toBe(400);
});

it('undo removes the last of today', async () => {
  const first = await log('pushups', 10);
  expect(first.status).toBe(201);
  await log('pushups', 20);
  expect((await get()).today.pushups).toBe(30);

  const undo = await t.req('DELETE', '/api/exercise/last?kind=pushups');
  expect(undo.status).toBe(204);
  expect((await get()).today.pushups).toBe(10);
});

it('undo leaves yesterday alone', async () => {
  // 2026-11-21T18:00Z is 12:00 on Saturday 21 in Chicago; 2026-11-22T18:00Z is today.
  t.setNow('2026-11-21T18:00:00.000Z');
  await log('squats', 10);
  t.setNow('2026-11-22T18:00:00.000Z');
  const undo = await t.req('DELETE', '/api/exercise/last?kind=squats');
  expect(undo.status).toBe(404);
  t.setNow('2026-11-21T18:00:00.000Z');
  expect((await get()).today.squats).toBe(10);
});

it('undo with nothing logged is 404', async () => {
  expect((await t.req('DELETE', '/api/exercise/last?kind=pushups')).status).toBe(404);
  expect((await t.req('DELETE', '/api/exercise/last?kind=nope')).status).toBe(400);
  expect((await t.req('DELETE', '/api/exercise/last')).status).toBe(400);
});

it('series for the requested range and date', async () => {
  await log('pushups', 10);
  await log('pushups', 35);
  await log('squats', 5);
  const body = await get('?range=day&date=2026-11-22');
  // TEST_NOW is 18:00Z, noon in Chicago.
  expect(body.series.pushups.buckets[12]).toEqual({ label: '12', value: 45 });
  expect(body.series.pushups.total).toBe(45);
  expect(body.series.pushups.dailyAverage).toBe(45);
  expect(body.series.squats.total).toBe(5);

  const week = await get('?range=week&date=2026-11-22');
  expect(week.series.pushups.buckets).toHaveLength(7);
  expect(week.series.pushups.total).toBe(45);
  expect(week.series.pushups.dailyAverage).toBe(45 / 7);

  const year = await get('?range=year');
  expect(year.series.squats.buckets[10]).toEqual({ label: 'Nov', value: 5 });
});

it('rejects a bad range, date or kind', async () => {
  expect((await t.req('GET', '/api/exercise?range=decade')).status).toBe(400);
  expect((await t.req('GET', '/api/exercise?date=22-11-2026')).status).toBe(400);
  expect((await t.req('GET', '/api/exercise?kind=burpees')).status).toBe(400);
});

it('requires auth from a remote origin', async () => {
  const remote = { remote: '203.0.113.9' };
  expect((await t.req('POST', '/api/exercise', { kind: 'pushups', count: 5 }, remote)).status).toBe(401);
  expect((await t.req('GET', '/api/exercise', undefined, remote)).status).toBe(401);
});
