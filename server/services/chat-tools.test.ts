import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FocusSession, Goal } from '../../shared/types.ts';
import { createAttachment } from '../repo/attachments.ts';
import { createEssay, saveEssay } from '../repo/essays.ts';
import { storeSamples } from '../routes/sleep.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';
import { chatTools, compactJson, TOOL_OUTPUT_LIMIT } from './chat-tools.ts';

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

async function run(name: string, input: unknown): Promise<Record<string, unknown>> {
  const out = await chatTools(t).run(name, input);
  expect(out.length).toBeLessThanOrEqual(TOOL_OUTPUT_LIMIT);
  return JSON.parse(out) as Record<string, unknown>;
}

async function seedSession(body: Record<string, unknown> & { startedAt: string; hours: number }): Promise<FocusSession> {
  const { hours, ...rest } = body;
  const endedAt = new Date(Date.parse(body.startedAt) + hours * 3_600_000).toISOString();
  const res = await t.req('POST', '/api/sessions/manual', { ...rest, endedAt });
  expect(res.status).toBe(201);
  return (await res.json()) as FocusSession;
}

describe('definitions', () => {
  it('declares every tool strict, closed to extra keys, with the cache mark on the last', () => {
    const { definitions } = chatTools(t);
    expect(definitions.map((d) => d.name)).toEqual([
      'search',
      'list_sessions',
      'get_session',
      'get_essay',
      'goal_progress',
      'stats',
      'sleep',
      'exercise',
      'resources',
    ]);
    for (const d of definitions) {
      expect(d.strict).toBe(true);
      expect(d.input_schema.additionalProperties).toBe(false);
      expect(d.description?.length).toBeGreaterThan(20);
    }
    expect(definitions.at(-1)?.cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('run', () => {
  it('search tool returns hits', async () => {
    const session = await seedSession({ name: 'Linear algebra', notes: 'Eigenvalues of a rotation', startedAt: '2026-11-21T15:00:00.000Z', hours: 1 });
    const out = await run('search', { q: 'eigenval' });
    expect(out.hits).toEqual([expect.objectContaining({ kind: 'session', refId: session.id, title: 'Linear algebra' })]);
  });

  it('lists sessions by subject name over inclusive days', async () => {
    await seedSession({ name: 'Ch. 3', subjectName: 'Algebra', tags: ['exam'], startedAt: '2026-11-20T15:00:00.000Z', hours: 1 });
    await seedSession({ name: 'Ch. 4', subjectName: 'Algebra', startedAt: '2026-11-21T15:00:00.000Z', hours: 2 });
    await seedSession({ name: 'Optics', subjectName: 'Physics', startedAt: '2026-11-21T17:00:00.000Z', hours: 1 });

    const algebra = await run('list_sessions', { subject: 'algebra', from: '2026-11-21', to: '2026-11-21' });
    expect((algebra.sessions as { name: string; focus: string }[]).map((s) => [s.name, s.focus])).toEqual([['Ch. 4', '2 h 0 m']]);

    const tagged = await run('list_sessions', { tag: 'exam' });
    expect((tagged.sessions as { name: string }[]).map((s) => s.name)).toEqual(['Ch. 3']);

    const unknown = await run('list_sessions', { subject: 'Chemistry' });
    expect(unknown).toMatchObject({ sessions: [], note: 'No subject named Chemistry' });

    const limited = await run('list_sessions', { limit: 1 });
    expect((limited.sessions as unknown[]).length).toBe(1);
  });

  it("gets a session with its files' text", async () => {
    const session = await seedSession({ name: 'Ch. 4', notes: 'Lemma 2 is the hard part', startedAt: '2026-11-21T15:00:00.000Z', hours: 1 });
    createAttachment(t, { sessionId: session.id, filename: 'proof.txt', bytes: Buffer.from('Proof of lemma 2 by induction') });

    const out = await run('get_session', { id: session.id });
    expect(out).toMatchObject({ id: session.id, name: 'Ch. 4', notes: 'Lemma 2 is the hard part', focus: '1 h 0 m' });
    expect(out.attachments).toEqual([expect.objectContaining({ filename: 'proof.txt', extractedText: 'Proof of lemma 2 by induction' })]);
  });

  it('gets an essay as plain text', async () => {
    const essay = createEssay(t, 'insights');
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Attention is a muscle.' }] }] };
    saveEssay(t, essay.id, { title: 'On attention', contentJson: doc, baseUpdatedAt: essay.updatedAt });

    const out = await run('get_essay', { id: essay.id });
    expect(out).toMatchObject({ id: essay.id, title: 'On attention', column: 'insights', text: 'Attention is a muscle.' });
  });

  it('reports goal progress for all open goals or one', async () => {
    const res = await t.req('POST', '/api/goals', { title: 'Finish Ch. 4', plannedMinutes: 600 });
    const goal = (await res.json()) as Goal;
    await seedSession({ name: 'Ch. 4', goalId: goal.id, startedAt: '2026-11-21T15:00:00.000Z', hours: 6 });

    const all = await run('goal_progress', {});
    expect(all.goals).toEqual([expect.objectContaining({ id: goal.id, title: 'Finish Ch. 4', focused: '6 h', planned: '10 h', percentDone: 60 })]);
    expect(all.accuracy).toEqual({ hours: null, dates: null, count: 0 });

    const one = await run('goal_progress', { id: goal.id });
    expect(one.goals).toEqual([expect.objectContaining({ id: goal.id })]);

    await expect(chatTools(t).run('goal_progress', { id: 999 })).rejects.toThrow('No goal with id 999');
  });

  it('adds up focus by subject for a range', async () => {
    await seedSession({ name: 'Ch. 4', subjectName: 'Algebra', startedAt: '2026-11-21T15:00:00.000Z', hours: 2 });
    const out = await run('stats', { range: 'week', date: '2026-11-22' });
    expect(out).toMatchObject({ range: 'week', from: '2026-11-16', to: '2026-11-22', total: '2 h 0 m' });
    expect(out.subjects).toEqual([{ name: 'Algebra', seconds: 7200, time: '2 h 0 m' }]);
  });

  it('reads the latest nights of sleep', async () => {
    expect(await run('sleep', {})).toMatchObject({ nights: [], lastIngest: null });
    storeSamples(t, [{ start: '2026-11-22T05:00:00.000Z', end: '2026-11-22T12:00:00.000Z', stage: 'core', source: 'Apple Watch' }]);
    const out = await run('sleep', { nights: 3 });
    expect(out.nights).toEqual([expect.objectContaining({ night: '2026-11-22', asleep: '7 h 0 m', source: 'Apple Watch' })]);
  });

  it('reads exercise for a range', async () => {
    await t.req('POST', '/api/exercise', { kind: 'pushups', count: 20 });
    const out = await run('exercise', { range: 'day' });
    expect(out).toMatchObject({ today: { pushups: 20, squats: 0 } });
    expect((out.series as Record<string, { total: number }>).pushups.total).toBe(20);
  });

  it('lists resources, by kind when asked', async () => {
    const insert = t.db.prepare('INSERT INTO resources (url, title, kind, domain, done, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('https://youtu.be/x', 'Eigenvectors explained', 'video', 'youtu.be', 1, '2026-11-20T00:00:00.000Z');
    insert.run('https://example.org/a.pdf', 'Notes', 'pdf', 'example.org', 0, '2026-11-21T00:00:00.000Z');

    const all = await run('resources', {});
    expect(all.resources).toEqual([
      { title: 'Notes', url: 'https://example.org/a.pdf', kind: 'pdf', done: false },
      { title: 'Eigenvectors explained', url: 'https://youtu.be/x', kind: 'video', done: true },
    ]);
    const videos = await run('resources', { kind: 'video' });
    expect((videos.resources as unknown[]).length).toBe(1);
  });

  it('refuses bad input and unknown tools', async () => {
    const tools = chatTools(t);
    await expect(tools.run('get_session', { id: 'x' })).rejects.toThrow();
    await expect(tools.run('stats', { range: 'decade' })).rejects.toThrow();
    await expect(tools.run('list_sessions', { from: '2026-02-30' })).rejects.toThrow();
    await expect(tools.run('search', { q: 'a', extra: 1 })).rejects.toThrow();
    await expect(tools.run('drop_tables', {})).rejects.toThrow('No tool named drop_tables');
    await expect(tools.run('get_session', { id: 999 })).rejects.toThrow('No session with id 999');
  });

  it('truncates a long answer to 20 000 characters and says so', async () => {
    const session = await seedSession({ name: 'Long', startedAt: '2026-11-21T15:00:00.000Z', hours: 1 });
    createAttachment(t, { sessionId: session.id, filename: 'book.txt', bytes: Buffer.from('word '.repeat(10_000)) });
    const out = await run('get_session', { id: session.id });
    expect(out.truncated).toBe(true);
    expect(out.name).toBe('Long');
  });
});

describe('compactJson', () => {
  it('leaves a short value whole', () => {
    expect(compactJson({ a: [1, 2] })).toBe('{"a":[1,2]}');
  });

  it('shortens the longest part until the JSON fits', () => {
    const value = { title: 'Kept', rows: Array.from({ length: 5000 }, (_, i) => ({ i, text: 'x'.repeat(20) })) };
    const out = compactJson(value, 2000);
    expect(out.length).toBeLessThanOrEqual(2000);
    const parsed = JSON.parse(out) as { title: string; rows: unknown[]; truncated: boolean };
    expect(parsed).toMatchObject({ title: 'Kept', truncated: true });
    expect(parsed.rows.length).toBeGreaterThan(10);
  });
});
