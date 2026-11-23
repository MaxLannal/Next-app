import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FocusSession } from '../../shared/types.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';
import { startHeartbeat } from './heartbeat.ts';

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

async function startSession(): Promise<FocusSession> {
  const res = await t.req('POST', '/api/sessions', { name: 'Read Lamport' });
  expect(res.status).toBe(201);
  return (await res.json()) as FocusSession;
}

async function get(id: number): Promise<FocusSession> {
  return (await (await t.req('GET', `/api/sessions/${id}`)).json()) as FocusSession;
}

const lastAlive = () =>
  (t.db.prepare("SELECT value FROM settings WHERE key = 'last_alive'").get() as { value: string } | undefined)?.value;

it('heartbeat auto-pauses after a gap', async () => {
  t.setNow('2026-11-22T16:50:00.000Z');
  const s = await startSession();

  t.setNow('2026-11-22T17:00:00.000Z');
  const hb = startHeartbeat(t, { intervalMs: 3_600_000 });
  hb.tick();
  expect(lastAlive()).toBe('2026-11-22T17:00:00.000Z');
  expect((await get(s.id)).status).toBe('running');

  // The Mac slept between the two ticks.
  t.setNow('2026-11-22T17:20:00.000Z');
  hb.tick();
  hb.stop();

  const paused = await get(s.id);
  expect(paused.status).toBe('paused');
  expect(paused.autoPausedAt).toBe('2026-11-22T17:00:00.000Z');
  expect(paused.focusSeconds).toBe(600); // 16:50 → 17:00 only
  expect(paused.events.at(-1)).toEqual({ type: 'pause', at: '2026-11-22T17:00:00.000Z' });
  expect(lastAlive()).toBe('2026-11-22T17:20:00.000Z');
});

it('no gap, no pause', async () => {
  t.setNow('2026-11-22T17:00:00.000Z');
  const s = await startSession();
  const hb = startHeartbeat(t, { intervalMs: 3_600_000, gapMs: 300_000 });
  hb.tick();
  t.setNow('2026-11-22T17:01:00.000Z');
  hb.tick();
  hb.stop();
  expect((await get(s.id)).status).toBe('running');
  expect((await get(s.id)).autoPausedAt).toBeNull();
});

it('a gap across local midnight still pauses at last_alive', async () => {
  // 05:50Z = 23:50 Chicago on 21 Nov.
  t.setNow('2026-11-22T05:50:00.000Z');
  const s = await startSession();
  t.setNow('2026-11-22T05:55:00.000Z');
  const hb = startHeartbeat(t, { intervalMs: 3_600_000 });
  hb.tick();
  t.setNow('2026-11-22T06:10:00.000Z'); // 00:10 Chicago on 22 Nov
  hb.tick();
  hb.stop();
  const paused = await get(s.id);
  expect(paused.status).toBe('paused');
  expect(paused.focusSeconds).toBe(300);
  const day = await t.req('GET', '/api/stats/subjects?range=day&date=2026-11-21');
  expect(((await day.json()) as { slices: { seconds: number }[] }).slices).toEqual([
    { subjectId: null, name: 'No subject', seconds: 300 },
  ]);
});

it('a resume clears autoPausedAt', async () => {
  t.setNow('2026-11-22T17:00:00.000Z');
  const s = await startSession();
  const hb = startHeartbeat(t, { intervalMs: 3_600_000 });
  hb.tick();
  t.setNow('2026-11-22T17:20:00.000Z');
  hb.tick();
  hb.stop();
  expect((await get(s.id)).autoPausedAt).toBe('2026-11-22T17:00:00.000Z');

  const resumed = await t.req('POST', `/api/sessions/${s.id}/resume`);
  expect(resumed.status).toBe(200);
  const body = (await resumed.json()) as FocusSession;
  expect(body.status).toBe('running');
  expect(body.autoPausedAt).toBeNull();
});

it('the first tick records last_alive', async () => {
  t.setNow('2026-11-22T17:00:00.000Z');
  const hb = startHeartbeat(t, { intervalMs: 3_600_000 });
  hb.tick();
  hb.stop();
  expect(lastAlive()).toBe('2026-11-22T17:00:00.000Z');
});

it('a running session is untouched when no last_alive exists yet', async () => {
  t.setNow('2026-11-22T17:00:00.000Z');
  const s = await startSession();
  t.setNow('2026-11-22T18:00:00.000Z');
  const hb = startHeartbeat(t, { intervalMs: 3_600_000 });
  hb.tick(); // no last_alive: nothing to compare against
  hb.stop();
  expect((await get(s.id)).status).toBe('running');
});
