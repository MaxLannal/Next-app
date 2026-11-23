import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FocusSession, HeatmapStats, SubjectStats } from '../../shared/types.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

async function addDone(name: string, subjectName: string | undefined, startedAt: string, endedAt: string): Promise<FocusSession> {
  const res = await t.req('POST', '/api/sessions/manual', { name, subjectName, startedAt, endedAt });
  expect(res.status).toBe(201);
  return (await res.json()) as FocusSession;
}

it('week by subject includes a live session', async () => {
  // 2026-11-17T15:00Z is 09:00 in Chicago, a Tuesday: inside the week of 16–22 Nov.
  await addDone('Linear maps', 'Algebra', '2026-11-17T15:00:00.000Z', '2026-11-17T16:00:00.000Z');
  t.setNow('2026-11-22T17:30:00.000Z');
  const started = await t.req('POST', '/api/sessions', { name: 'Mechanics', subjectName: 'Physics' });
  expect(started.status).toBe(201);
  t.setNow('2026-11-22T18:00:00.000Z');

  const res = await t.req('GET', '/api/stats/subjects?range=week&date=2026-11-18');
  expect(res.status).toBe(200);
  const body = (await res.json()) as SubjectStats;
  expect(body.days).toEqual([
    '2026-11-16',
    '2026-11-17',
    '2026-11-18',
    '2026-11-19',
    '2026-11-20',
    '2026-11-21',
    '2026-11-22',
  ]);
  expect(body.slices).toEqual([
    { subjectId: expect.any(Number), name: 'Algebra', seconds: 3600 },
    { subjectId: expect.any(Number), name: 'Physics', seconds: 1800 },
  ]);
});

it('a session crossing local midnight is split', async () => {
  // 04:00–05:00Z on 22 Nov is 23:00–00:00 Chicago on 21 Nov: it lands on the 21st only.
  await addDone('Late', undefined, '2026-11-22T04:30:00.000Z', '2026-11-22T05:30:00.000Z');
  const res = await t.req('GET', '/api/stats/subjects?range=day&date=2026-11-21');
  const body = (await res.json()) as SubjectStats;
  expect(body.slices).toEqual([{ subjectId: null, name: 'No subject', seconds: 3600 }]);
  const other = (await (await t.req('GET', '/api/stats/subjects?range=day&date=2026-11-22')).json()) as SubjectStats;
  expect(other.slices).toEqual([]);
});

it('rejects a bad range or date', async () => {
  expect((await t.req('GET', '/api/stats/subjects?range=decade')).status).toBe(400);
  expect((await t.req('GET', '/api/stats/subjects?date=2026-13-01')).status).toBe(400);
});

it('heatmap year', async () => {
  const hours = (h: number) => String(h).padStart(2, '0');
  // 2 h on 3 Nov (Chicago), 30 m on 4 Nov, 1 h on 5 Nov.
  await addDone('Two hours', 'Algebra', `2026-11-03T${hours(15)}:00:00.000Z`, `2026-11-03T${hours(17)}:00:00.000Z`);
  await addDone('Half hour', undefined, '2026-11-04T16:00:00.000Z', '2026-11-04T16:30:00.000Z');
  await addDone('One hour', 'Physics', '2026-11-05T16:00:00.000Z', '2026-11-05T17:00:00.000Z');

  const res = await t.req('GET', '/api/stats/heatmap?year=2026');
  expect(res.status).toBe(200);
  const body = (await res.json()) as HeatmapStats;
  expect(body.days).toHaveLength(365);
  expect(body.days[0].date).toBe('2026-01-01');
  expect(body.days[364].date).toBe('2026-12-31');

  const day = (date: string) => body.days.find((d) => d.date === date)!;
  expect(day('2026-11-03')).toEqual({
    date: '2026-11-03',
    seconds: 7200,
    level: 4,
    subjects: [{ subjectId: expect.any(Number), name: 'Algebra', seconds: 7200 }],
  });
  expect(day('2026-11-04').level).toBe(2);
  expect(day('2026-11-05').level).toBe(3);
  expect(body.days.filter((d) => d.level > 0)).toHaveLength(3);

  expect(body.totals).toEqual({ seconds: 7200 + 1800 + 3600, activeDays: 3, longestStreak: 3, currentStreak: 0 });
  expect(body.years).toEqual([2026]);
});
