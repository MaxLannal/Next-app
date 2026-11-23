import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FocusSession, Subject } from '../../shared/types.ts';
import { goalFocusSeconds } from '../repo/sessions.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

async function start(body: Record<string, unknown> = {}): Promise<FocusSession> {
  const res = await t.req('POST', '/api/sessions', { name: 'Read Lamport', ...body });
  expect(res.status).toBe(201);
  return (await res.json()) as FocusSession;
}

async function act(id: number, action: 'pause' | 'resume' | 'stop'): Promise<FocusSession> {
  const res = await t.req('POST', `/api/sessions/${id}/${action}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FocusSession;
}

async function current(): Promise<FocusSession | null> {
  const res = await t.req('GET', '/api/sessions/current');
  expect(res.status).toBe(200);
  return (await res.json()) as FocusSession | null;
}

it('start, pause, resume, stop', async () => {
  t.setNow('2026-11-22T15:00:00.000Z');
  const started = await start({ subjectName: 'Algebra', tags: ['proof', 'lamport'] });
  expect(started.status).toBe('running');
  expect(started.startedAt).toBe('2026-11-22T15:00:00.000Z');
  expect(started.subject).toEqual({ id: expect.any(Number), name: 'Algebra' });
  expect(started.tags).toEqual(['lamport', 'proof']);

  t.setNow('2026-11-22T15:30:00.000Z');
  expect((await act(started.id, 'pause')).status).toBe('paused');

  t.setNow('2026-11-22T15:40:00.000Z');
  expect((await act(started.id, 'resume')).status).toBe('running');

  t.setNow('2026-11-22T16:10:00.000Z');
  const stopped = await act(started.id, 'stop');
  expect(stopped.status).toBe('done');
  expect(stopped.focusSeconds).toBe(3600);
  expect(stopped.endedAt).toBe('2026-11-22T16:10:00.000Z');
  expect(stopped.events.map((e) => e.type)).toEqual(['start', 'pause', 'resume', 'stop']);
});

it('stores the GitHub folder once at creation', async () => {
  const folder = (id: number) =>
    (t.db.prepare('SELECT repo_folder FROM focus_sessions WHERE id = ?').get(id) as { repo_folder: string | null })
      .repo_folder;

  const s = await start({ name: 'Ch. 4 exercises' });
  // The clock is 2026-11-22T18:00Z: 12:00 in Chicago.
  expect(folder(s.id)).toBe('sessions/2026-11-22_ch-4-exercises');

  await t.req('PATCH', `/api/sessions/${s.id}`, { name: 'Renamed after the fact' });
  expect(folder(s.id)).toBe('sessions/2026-11-22_ch-4-exercises');

  // A session made by hand gets its folder from the day it started.
  const manual = await t.req('POST', '/api/sessions/manual', {
    name: '微积分复习',
    startedAt: '2026-11-20T15:00:00.000Z',
    endedAt: '2026-11-20T16:00:00.000Z',
  });
  expect(manual.status).toBe(201);
  const made = (await manual.json()) as FocusSession;
  expect(folder(made.id)).toBe('sessions/2026-11-20_session');
});

it('only one open session', async () => {
  await start();
  const second = await t.req('POST', '/api/sessions', { name: 'Second' });
  expect(second.status).toBe(409);
  expect(await second.json()).toEqual({ error: 'A session is already running' });

  const paused = await act((await current())!.id, 'pause');
  expect(paused.status).toBe('paused');
  const third = await t.req('POST', '/api/sessions', { name: 'Third' });
  expect(third.status).toBe(409);
});

it('invalid transitions', async () => {
  const s = await start();
  await act(s.id, 'pause');

  const pauseAgain = await t.req('POST', `/api/sessions/${s.id}/pause`);
  expect(pauseAgain.status).toBe(409);

  await act(s.id, 'resume');
  const resumeRunning = await t.req('POST', `/api/sessions/${s.id}/resume`);
  expect(resumeRunning.status).toBe(409);

  await act(s.id, 'stop');
  for (const action of ['pause', 'resume', 'stop']) {
    const res = await t.req('POST', `/api/sessions/${s.id}/${action}`);
    expect(res.status).toBe(409);
  }
});

it('current is null after stop', async () => {
  const s = await start();
  expect((await current())?.id).toBe(s.id);
  await act(s.id, 'stop');
  expect(await current()).toBeNull();
});

it('subjects reuse case-insensitively', async () => {
  const a = await start({ subjectName: 'Algebra' });
  await act(a.id, 'stop');
  const b = await start({ subjectName: 'algebra' });
  expect(b.subject).toEqual(a.subject);

  // Already there under another case: the existing subject comes back, unchanged.
  const created = await t.req('POST', '/api/subjects', { name: ' ALGEBRA ' });
  expect(created.status).toBe(200);
  expect(await created.json()).toEqual({ id: a.subject!.id, name: 'Algebra' });

  // Only the case differs, so this is not a new subject either.
  const recase = await t.req('POST', '/api/subjects', { name: 'algEBra' });
  expect(recase.status).toBe(200);
  expect(await recase.json()).toEqual({ id: a.subject!.id, name: 'Algebra' });

  const list = await t.req('GET', '/api/subjects');
  expect(await list.json()).toEqual([{ id: a.subject!.id, name: 'Algebra' }]);
});

it('editing end time recomputes', async () => {
  t.setNow('2026-11-22T15:00:00.000Z');
  const s = await start();
  t.setNow('2026-11-22T15:40:00.000Z');
  await act(s.id, 'pause');
  t.setNow('2026-11-22T15:50:00.000Z');
  await act(s.id, 'resume');
  t.setNow('2026-11-22T16:10:00.000Z');
  const stopped = await act(s.id, 'stop');
  expect(stopped.focusSeconds).toBe(3600);

  const res = await t.req('PATCH', `/api/sessions/${s.id}`, { endedAt: '2026-11-22T15:50:00.000Z' });
  expect(res.status).toBe(200);
  const patched = (await res.json()) as FocusSession;
  expect(patched.focusSeconds).toBe(2400);
  expect(patched.endedAt).toBe('2026-11-22T15:50:00.000Z');
  expect(patched.events).toEqual([
    { type: 'start', at: '2026-11-22T15:00:00.000Z' },
    { type: 'pause', at: '2026-11-22T15:40:00.000Z' },
    { type: 'stop', at: '2026-11-22T15:50:00.000Z' },
  ]);
});

it('moving a paused session stays paused and closed', async () => {
  t.setNow('2026-11-22T15:00:00.000Z');
  const s = await start();
  t.setNow('2026-11-22T15:30:00.000Z');
  await act(s.id, 'pause');

  // Starting later would leave the pause outside the new bounds; it must not vanish.
  t.setNow('2026-11-22T16:00:00.000Z');
  const res = await t.req('PATCH', `/api/sessions/${s.id}`, { startedAt: '2026-11-22T15:40:00.000Z' });
  expect(res.status).toBe(200);
  const patched = (await res.json()) as FocusSession;
  expect(patched.status).toBe('paused');
  expect(patched.focusSeconds).toBe(0);
  expect(patched.startedAt).toBe('2026-11-22T15:40:00.000Z');
  expect(patched.events).toEqual([
    { type: 'start', at: '2026-11-22T15:40:00.000Z' },
    { type: 'pause', at: '2026-11-22T15:40:00.000Z' },
  ]);
});

it('ending a paused session with an edit keeps its focus time', async () => {
  t.setNow('2026-11-22T15:00:00.000Z');
  const s = await start();
  t.setNow('2026-11-22T15:30:00.000Z');
  await act(s.id, 'pause');
  t.setNow('2026-11-22T20:00:00.000Z');
  const res = await t.req('PATCH', `/api/sessions/${s.id}`, { endedAt: '2026-11-22T15:45:00.000Z' });
  expect(res.status).toBe(200);
  const patched = (await res.json()) as FocusSession;
  expect(patched.status).toBe('paused');
  expect(patched.focusSeconds).toBe(1800);
  expect(patched.endedAt).toBe('2026-11-22T15:45:00.000Z');
});

it('an auto-paused session keeps its pause when times are edited', async () => {
  t.setNow('2026-11-22T15:00:00.000Z');
  const s = await start();
  t.setNow('2026-11-22T15:30:00.000Z');
  await act(s.id, 'pause');
  t.db.prepare("UPDATE focus_sessions SET auto_paused_at = '2026-11-22T15:30:00.000Z' WHERE id = ?").run(s.id);

  t.setNow('2026-11-22T16:00:00.000Z');
  const res = await t.req('PATCH', `/api/sessions/${s.id}`, { name: 'Renamed', endedAt: '2026-11-22T15:20:00.000Z', startedAt: '2026-11-22T15:10:00.000Z' });
  expect(res.status).toBe(200);
  const patched = (await res.json()) as FocusSession;
  // The bounds say it ended at 15:20, although the pause was at 15:30.
  expect(patched.status).toBe('paused');
  expect(patched.autoPausedAt).toBe('2026-11-22T15:20:00.000Z');
  expect(patched.focusSeconds).toBe(600);
  expect(patched.events.at(-1)).toEqual({ type: 'pause', at: '2026-11-22T15:20:00.000Z' });
});

it('moving the start earlier moves the start, never adds a second', async () => {
  t.setNow('2026-11-23T05:49:00.000Z');
  const s = await start();
  t.setNow('2026-11-23T06:20:00.000Z');
  await act(s.id, 'pause');
  t.setNow('2026-11-23T07:00:00.000Z');
  await act(s.id, 'resume');
  t.setNow('2026-11-23T08:36:00.000Z');
  await act(s.id, 'stop');

  // A start typed twelve hours too early, then put back.
  const early = await t.req('PATCH', `/api/sessions/${s.id}`, { startedAt: '2026-11-22T17:49:00.000Z' });
  expect(((await early.json()) as FocusSession).events.filter((e) => e.type === 'start')).toEqual([
    { type: 'start', at: '2026-11-22T17:49:00.000Z' },
  ]);
  const back = await t.req('PATCH', `/api/sessions/${s.id}`, { startedAt: '2026-11-23T05:49:00.000Z' });
  const patched = (await back.json()) as FocusSession;
  expect(patched.events).toEqual([
    { type: 'start', at: '2026-11-23T05:49:00.000Z' },
    { type: 'pause', at: '2026-11-23T06:20:00.000Z' },
    { type: 'resume', at: '2026-11-23T07:00:00.000Z' },
    { type: 'stop', at: '2026-11-23T08:36:00.000Z' },
  ]);
  expect(patched.focusSeconds).toBe((31 + 96) * 60);
});

it('moving the end later moves the stop with it', async () => {
  t.setNow('2026-11-22T15:00:00.000Z');
  const s = await start();
  t.setNow('2026-11-22T15:30:00.000Z');
  await act(s.id, 'pause');
  t.setNow('2026-11-22T15:40:00.000Z');
  await act(s.id, 'resume');
  t.setNow('2026-11-22T16:00:00.000Z');
  await act(s.id, 'stop');

  const res = await t.req('PATCH', `/api/sessions/${s.id}`, { endedAt: '2026-11-22T16:20:00.000Z' });
  const patched = (await res.json()) as FocusSession;
  expect(patched.endedAt).toBe('2026-11-22T16:20:00.000Z');
  expect(patched.events).toEqual([
    { type: 'start', at: '2026-11-22T15:00:00.000Z' },
    { type: 'pause', at: '2026-11-22T15:30:00.000Z' },
    { type: 'resume', at: '2026-11-22T15:40:00.000Z' },
    { type: 'stop', at: '2026-11-22T16:20:00.000Z' },
  ]);
  expect(patched.focusSeconds).toBe(70 * 60);
});

it('end before start is refused', async () => {
  t.setNow('2026-11-22T15:00:00.000Z');
  const s = await start();
  t.setNow('2026-11-22T16:00:00.000Z');
  await act(s.id, 'stop');

  const res = await t.req('PATCH', `/api/sessions/${s.id}`, { endedAt: '2026-11-22T14:00:00.000Z' });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'End is before start' });
});

it('manual session', async () => {
  const res = await t.req('POST', '/api/sessions/manual', {
    name: 'Forgotten session',
    subjectName: 'Physics',
    startedAt: '2026-11-22T13:00:00.000Z',
    endedAt: '2026-11-22T14:30:00.000Z',
  });
  expect(res.status).toBe(201);
  const s = (await res.json()) as FocusSession;
  expect(s.status).toBe('done');
  expect(s.focusSeconds).toBe(5400);
  expect(await current()).toBeNull();
});

it('filters', async () => {
  // Two proof-tagged sessions this ISO week (Mon 16 → Sun 22 Nov), one in the previous week.
  t.setNow('2026-11-17T10:00:00.000Z');
  const a = await start({ name: 'A', tags: ['proof'] });
  await act(a.id, 'stop');
  t.setNow('2026-11-18T10:00:00.000Z');
  const b = await start({ name: 'B', tags: ['proof', 'reading'] });
  await act(b.id, 'stop');
  t.setNow('2026-11-12T10:00:00.000Z');
  const c = await start({ name: 'C', tags: ['proof'] });
  await act(c.id, 'stop');

  const res = await t.req('GET', '/api/sessions?tag=proof&from=2026-11-16&to=2026-11-23');
  expect(res.status).toBe(200);
  const ids = ((await res.json()) as FocusSession[]).map((s) => s.id);
  expect(new Set(ids)).toEqual(new Set([a.id, b.id]));

  // Newest start first.
  const all = (await (await t.req('GET', '/api/sessions')).json()) as FocusSession[];
  expect(all.map((s) => s.id)).toEqual([b.id, a.id, c.id]);

  const byTag = new Set(((await (await t.req('GET', '/api/tags')).json()) as string[]));
  expect(byTag).toEqual(new Set(['proof', 'reading']));
});

it('deletes a session', async () => {
  const s = await start();
  await act(s.id, 'stop');
  expect((await t.req('DELETE', `/api/sessions/${s.id}`)).status).toBe(204);
  expect((await t.req('GET', `/api/sessions/${s.id}`)).status).toBe(404);
  expect(await (await t.req('GET', '/api/sessions')).json()).toEqual([]);
});

it('rejects bad input', async () => {
  for (const body of [{}, { name: '   ' }, { name: 42 }]) {
    const res = await t.req('POST', '/api/sessions', body);
    expect(res.status).toBe(400);
  }
  const badManual = await t.req('POST', '/api/sessions/manual', {
    name: 'X',
    startedAt: '2026-11-22T13:00:00.000Z',
    endedAt: '2026-11-22T12:00:00.000Z',
  });
  expect(badManual.status).toBe(400);
  expect(await badManual.json()).toEqual({ error: 'End is before start' });
  expect((await t.req('GET', '/api/sessions/999')).status).toBe(404);
});

it('keeps subject and goal when a patch leaves them alone', async () => {
  const s = await start({ subjectName: 'Algebra', goalId: null });
  expect(s.goalId).toBeNull();
  const res = await t.req('PATCH', `/api/sessions/${s.id}`, { name: 'Renamed', notes: 'note' });
  expect(res.status).toBe(200);
  const patched = (await res.json()) as FocusSession;
  expect(patched.name).toBe('Renamed');
  expect(patched.notes).toBe('note');
  expect(patched.subject).toEqual(s.subject);
});

it('clears tags with an empty array', async () => {
  const s = await start({ tags: ['proof'] });
  const res = await t.req('PATCH', `/api/sessions/${s.id}`, { tags: [] });
  expect(((await res.json()) as FocusSession).tags).toEqual([]);
});

it('subjects reject blank names', async () => {
  const res = await t.req('POST', '/api/subjects', { name: '   ' });
  expect(res.status).toBe(400);
});

it('list filters by subjectId and limits', async () => {
  t.setNow('2026-11-17T10:00:00.000Z');
  const a = await start({ name: 'A', subjectName: 'Algebra' });
  await act(a.id, 'stop');
  t.setNow('2026-11-18T10:00:00.000Z');
  const b = await start({ name: 'B', subjectName: 'Physics' });
  await act(b.id, 'stop');

  const algebra = (await (await t.req('GET', `/api/sessions?subjectId=${a.subject!.id}`)).json()) as FocusSession[];
  expect(algebra.map((s) => s.id)).toEqual([a.id]);
  const limited = (await (await t.req('GET', '/api/sessions?limit=1')).json()) as FocusSession[];
  expect(limited.map((s) => s.id)).toEqual([b.id]);
});

it('counts focus for a goal, from a day when given', async () => {
  t.db.prepare("INSERT INTO goals (id, title, created_at) VALUES (7, 'Finish chapter 3', '2026-11-01T00:00:00.000Z')").run();
  const manual = await t.req('POST', '/api/sessions/manual', {
    name: 'Earlier',
    goalId: 7,
    startedAt: '2026-11-22T16:00:00.000Z',
    endedAt: '2026-11-22T16:30:00.000Z',
  });
  expect(manual.status).toBe(201);
  expect(goalFocusSeconds(t.db, 7, 'America/Chicago', t.now())).toBe(1800);
  expect(goalFocusSeconds(t.db, 7, 'America/Chicago', t.now(), '2026-11-23')).toBe(0);
  expect(goalFocusSeconds(t.db, 7, 'America/Chicago', t.now(), '2026-11-22')).toBe(1800);
});

it('refuses malformed times on a patch', async () => {
  const s = await start();
  const res = await t.req('PATCH', `/api/sessions/${s.id}`, { endedAt: 'yesterday' });
  expect(res.status).toBe(400);
  expect((await t.req('PATCH', `/api/sessions/${s.id}`, { startedAt: 'soon' })).status).toBe(400);
});

it('a session without a subject has none', async () => {
  const res = await t.req('POST', '/api/sessions', { name: 'X' });
  expect(((await res.json()) as FocusSession).subject).toBeNull();
  const subjects = (await (await t.req('GET', '/api/subjects')).json()) as Subject[];
  expect(subjects).toEqual([]);
});
