import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Skill, SkillBoard, SkillLink, SkillNode } from '../../shared/types.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => t.cleanup());

const json = async <T>(res: Response) => (await res.json()) as T;
const post = (path: string, body: unknown) => t.req('POST', path, body);

/** A finished focus session to stand behind an experience. */
function session(name = 'Qiskit tutorial'): number {
  const at = '2026-11-20T15:00:00.000Z';
  const { lastInsertRowid } = t.db
    .prepare("INSERT INTO focus_sessions (name, status, started_at, ended_at, focus_seconds, created_at) VALUES (?, 'done', ?, ?, 3600, ?)")
    .run(name, at, '2026-11-20T16:00:00.000Z', at);
  return Number(lastInsertRowid);
}

async function skill(name = 'Quantum Computing'): Promise<Skill> {
  const res = await post('/api/skills', { name });
  expect(res.status).toBe(201);
  return json<Skill>(res);
}

describe('skills', () => {
  it('creates and lists a skill with one empty stage', async () => {
    const created = await skill();
    expect(created).toMatchObject({ name: 'Quantum Computing', steps: 0, experiences: 0, stages: 1, layerSteps: [] });
    const list = await json<Skill[]>(await t.req('GET', '/api/skills'));
    expect(list.map((s) => s.name)).toEqual(['Quantum Computing']);
  });

  it('refuses a blank name', async () => {
    expect((await post('/api/skills', { name: '   ' })).status).toBe(400);
  });

  it('keeps an empty stage on top as steps fill the stages below', async () => {
    const s = await skill();
    await post(`/api/skills/${s.id}/nodes`, { kind: 'step', title: 'Qubits', layer: 0, x: 10, y: -100 });
    let board = await json<SkillBoard>(await t.req('GET', `/api/skills/${s.id}`));
    expect(board.skill).toMatchObject({ steps: 1, stages: 2, layerSteps: [1] });
    const step = board.nodes[0];
    // Dragged up a stage: now stage 2 is used and a third, empty one waits on top.
    const moved = await t.req('PATCH', `/api/skills/nodes/${step.id}`, { layer: 1, y: 60 });
    expect(await json<SkillNode>(moved)).toMatchObject({ layer: 1, y: 60, title: 'Qubits' });
    board = await json<SkillBoard>(await t.req('GET', `/api/skills/${s.id}`));
    expect(board.skill).toMatchObject({ stages: 3, layerSteps: [0, 1] });
  });

  it('links experiences to a step, once each, and shows their sessions', async () => {
    const s = await skill();
    const step = await json<SkillNode>(await post(`/api/skills/${s.id}/nodes`, { kind: 'step', title: 'Gates' }));
    const a = await json<SkillNode>(await post(`/api/skills/${s.id}/nodes`, { kind: 'experience', sessionId: session('Qiskit tutorial') }));
    const b = await json<SkillNode>(await post(`/api/skills/${s.id}/nodes`, { kind: 'experience', sessionId: session('Bell states') }));
    expect(a.session).toMatchObject({ name: 'Qiskit tutorial', focusSeconds: 3600 });

    const first = await json<SkillLink>(await post('/api/skills/links', { stepId: step.id, experienceId: a.id }));
    const again = await json<SkillLink>(await post('/api/skills/links', { stepId: step.id, experienceId: a.id }));
    expect(again.id).toBe(first.id);
    await post('/api/skills/links', { stepId: step.id, experienceId: b.id });

    const board = await json<SkillBoard>(await t.req('GET', `/api/skills/${s.id}`));
    expect(board.links.map((l) => l.experienceId).sort()).toEqual([a.id, b.id].sort());
    expect(board.skill).toMatchObject({ steps: 1, experiences: 2 });
  });

  it('refuses links that are not experience-to-step within one skill', async () => {
    const s = await skill();
    const other = await skill('Python');
    const step = await json<SkillNode>(await post(`/api/skills/${s.id}/nodes`, { kind: 'step' }));
    const step2 = await json<SkillNode>(await post(`/api/skills/${s.id}/nodes`, { kind: 'step' }));
    const foreign = await json<SkillNode>(await post(`/api/skills/${other.id}/nodes`, { kind: 'experience', sessionId: session() }));
    expect((await post('/api/skills/links', { stepId: step.id, experienceId: step2.id })).status).toBe(400);
    expect((await post('/api/skills/links', { stepId: step.id, experienceId: foreign.id })).status).toBe(400);
  });

  it('needs a real session for an experience, and a sane position', async () => {
    const s = await skill();
    expect((await post(`/api/skills/${s.id}/nodes`, { kind: 'experience' })).status).toBe(400);
    expect((await post(`/api/skills/${s.id}/nodes`, { kind: 'experience', sessionId: 999 })).status).toBe(400);
    expect((await post(`/api/skills/${s.id}/nodes`, { kind: 'step', layer: -1 })).status).toBe(400);
    expect((await post(`/api/skills/${s.id}/nodes`, { kind: 'step', x: 'left' })).status).toBe(400);
  });

  it('deleting a node drops its links; deleting a skill takes everything', async () => {
    const s = await skill();
    const step = await json<SkillNode>(await post(`/api/skills/${s.id}/nodes`, { kind: 'step' }));
    const exp = await json<SkillNode>(await post(`/api/skills/${s.id}/nodes`, { kind: 'experience', sessionId: session() }));
    await post('/api/skills/links', { stepId: step.id, experienceId: exp.id });
    expect((await t.req('DELETE', `/api/skills/nodes/${exp.id}`)).status).toBe(204);
    expect((await json<SkillBoard>(await t.req('GET', `/api/skills/${s.id}`))).links).toEqual([]);
    expect((await t.req('DELETE', `/api/skills/${s.id}`)).status).toBe(204);
    expect((await t.req('GET', `/api/skills/${s.id}`)).status).toBe(404);
    expect((t.db.prepare('SELECT COUNT(*) AS n FROM skill_nodes').get() as { n: number }).n).toBe(0);
  });

  it('dates a step the day it is made, or the day given, and lets the day change', async () => {
    const s = await skill();
    const today = await json<SkillNode>(await post(`/api/skills/${s.id}/nodes`, { kind: 'step' }));
    expect(today.completedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const given = await json<SkillNode>(await post(`/api/skills/${s.id}/nodes`, { kind: 'step', completedOn: '2026-11-20' }));
    expect(given.completedOn).toBe('2026-11-20');
    const moved = await json<SkillNode>(await t.req('PATCH', `/api/skills/nodes/${given.id}`, { completedOn: '2026-10-01' }));
    expect(moved.completedOn).toBe('2026-10-01');
    expect((await t.req('PATCH', `/api/skills/nodes/${given.id}`, { completedOn: 'yesterday' })).status).toBe(400);
    const exp = await json<SkillNode>(await post(`/api/skills/${s.id}/nodes`, { kind: 'experience', sessionId: session(), completedOn: '2026-11-20' }));
    expect(exp.completedOn).toBeNull();
  });

  it('names stages only when asked, and a blank name clears one', async () => {
    const s = await skill();
    expect(s.stageNames).toEqual({});
    const named = await json<Skill>(await t.req('PUT', `/api/skills/${s.id}/stages/0`, { name: '  Foundations ' }));
    expect(named.stageNames).toEqual({ 0: 'Foundations' });
    await t.req('PUT', `/api/skills/${s.id}/stages/1`, { name: 'Circuits' });
    const board = await json<SkillBoard>(await t.req('GET', `/api/skills/${s.id}`));
    expect(board.skill.stageNames).toEqual({ 0: 'Foundations', 1: 'Circuits' });
    const cleared = await json<Skill>(await t.req('PUT', `/api/skills/${s.id}/stages/0`, { name: '' }));
    expect(cleared.stageNames).toEqual({ 1: 'Circuits' });
    expect((await t.req('PUT', `/api/skills/${s.id}/stages/0`, { name: 'x'.repeat(61) })).status).toBe(400);
    expect((await t.req('PUT', '/api/skills/999/stages/0', { name: 'Nope' })).status).toBe(404);
  });

  it('shows an experience with the top-level files from its session', async () => {
    const s = await skill();
    const sid = session();
    const add = (filename: string, kind: string, mime: string, parent: number | null = null) =>
      Number(
        t.db
          .prepare(
            `INSERT INTO attachments (session_id, parent_id, kind, filename, mime, size, path, sha256, created_at)
             VALUES (?, ?, ?, ?, ?, 1, 'x', 'x', '2026-11-20T15:00:00.000Z')`,
          )
          .run(sid, parent, kind, filename, mime).lastInsertRowid,
      );
    const pdf = add('notes.pdf', 'pdf', 'application/pdf');
    add('page-1.png', 'image', 'image/png', pdf);
    add('bell.py', 'code', 'text/x-python');
    const exp = await json<SkillNode>(await post(`/api/skills/${s.id}/nodes`, { kind: 'experience', sessionId: sid }));
    expect(exp.session?.files.map((f) => f.filename)).toEqual(['notes.pdf', 'bell.py']);
    expect(exp.session?.files[0]).toMatchObject({ kind: 'pdf', url: `/api/attachments/${pdf}/file` });
    const board = await json<SkillBoard>(await t.req('GET', `/api/skills/${s.id}`));
    expect(board.nodes[0].session?.files).toHaveLength(2);
  });
});
