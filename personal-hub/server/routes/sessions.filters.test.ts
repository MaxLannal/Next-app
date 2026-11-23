import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FocusSession } from '../../shared/types.ts';
import { createAttachment } from '../repo/attachments.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

/** A finished session that started `hoursAgo` hours before the test clock, focused for 20 minutes. */
function insertSession(name: string, hoursAgo: number): number {
  const start = new Date(t.now().getTime() - hoursAgo * 3600_000);
  const end = new Date(start.getTime() + 20 * 60_000);
  const { lastInsertRowid } = t.db
    .prepare(
      `INSERT INTO focus_sessions (name, status, started_at, ended_at, focus_seconds, created_at)
       VALUES (?, 'done', ?, ?, ?, ?)`,
    )
    .run(name, start.toISOString(), end.toISOString(), 1200, start.toISOString());
  t.db
    .prepare("INSERT INTO session_events (session_id, type, at) VALUES (?, 'start', ?), (?, 'stop', ?)")
    .run(lastInsertRowid, start.toISOString(), lastInsertRowid, end.toISOString());
  return Number(lastInsertRowid);
}

function attach(sessionId: number, filename: string, text: string): number {
  return createAttachment(t, { sessionId, filename, bytes: Buffer.from(text, 'utf8') }).id;
}

async function list(query: string): Promise<FocusSession[]> {
  const res = await t.req('GET', `/api/sessions${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FocusSession[];
}

it('filters by file type', async () => {
  const withPdf = insertSession('Read the paper', 5);
  const withCode = insertSession('Lamport notes', 4);
  attach(withPdf, 'henderson-sellers.pdf', 'Agent UML');
  attach(withPdf, 'notes.txt', 'office hours');
  attach(withCode, 'hw.py', 'print(1)\n');

  expect((await list('?kind=pdf')).map((s) => s.id)).toEqual([withPdf]);
  expect((await list('?kind=code')).map((s) => s.id)).toEqual([withCode]);
  expect(await list('?kind=latex')).toEqual([]);
});

it('q matches attachment text', async () => {
  const withEigen = insertSession('Ch. 4 exercises', 5);
  const other = insertSession('Reading', 4);
  attach(withEigen, 'notes.txt', 'the eigenvalue decomposition');
  attach(other, 'hw.py', 'print("quadratic residues")\n');

  expect((await list('?q=eigen')).map((s) => s.id)).toEqual([withEigen]);
  expect((await list('?q=EIGENVALUE')).map((s) => s.id)).toEqual([withEigen]);
});

it('q matches session names, notes and essay titles, without repeats', async () => {
  const named = insertSession('Lamport clocks', 5);
  const noted = insertSession('Reading', 4);
  const hitTwice = insertSession('More clocks', 3);
  t.db.prepare("UPDATE focus_sessions SET notes = 'compare clocks between processes' WHERE id = ?").run(noted);
  attach(hitTwice, 'clocks.txt', 'clocks again');
  t.db
    .prepare(
      `INSERT INTO essays (column_key, title, content_json, plain_text, word_count, created_at, updated_at)
       VALUES ('insights', 'On clocks', '{}', '', 0, ?, ?)`,
    )
    .run(t.now().toISOString(), t.now().toISOString());
  t.db
    .prepare(`INSERT INTO search_index (kind, ref_id, title, body) VALUES ('session', ?, 'More clocks', 'clocks')`)
    .run(hitTwice);
  t.db
    .prepare(`INSERT INTO search_index (kind, ref_id, title, body) VALUES ('essay', 1, 'On clocks', 'clocks')`)
    .run();

  // An essay hit has no session of its own, so only the sessions are returned, each once.
  expect((await list('?q=clocks')).map((s) => s.id).sort()).toEqual([named, noted, hitTwice].sort());
});

it('maps an essay hit to the sessions on the day it was written', async () => {
  // The hub's day is America/Chicago: 02:00Z on the 22nd is still the evening of the 21st.
  const evening = insertSession('Evening session', 16);
  const caughtUp = insertSession('Catch-up', 15);
  const nextDay = insertSession('Next day', 3);
  t.db
    .prepare(
      `INSERT INTO essays (column_key, title, content_json, plain_text, word_count, created_at, updated_at)
       VALUES ('plans', 'Weekend plan', '{}', 'rest', 1, ?, ?)`,
    )
    .run('2026-11-22T02:00:00.000Z', '2026-11-22T02:00:00.000Z');
  t.db
    .prepare(`INSERT INTO search_index (kind, ref_id, title, body) VALUES ('essay', 1, 'Weekend plan', 'rest')`)
    .run();

  expect((await list('?q=plan')).map((s) => s.id).sort()).toEqual([evening, caughtUp].sort());
  expect((await list('?q=plan')).map((s) => s.id)).not.toContain(nextDay);
});

it('q tolerates FTS syntax and keeps the other filters', async () => {
  const a = insertSession('C++ practice', 5);
  const b = insertSession('Draft talk', 4);
  // Session rows aren't in the index; an attachment's text is how a session becomes findable.
  attach(a, 'hw.cpp', '#include <iostream>');
  attach(b, 'talk.md', 'a draft talk outline');
  t.db.prepare("INSERT INTO subjects (id, name, created_at) VALUES (1, 'Algebra', ?)").run(t.now().toISOString());
  t.db.prepare('UPDATE focus_sessions SET subject_id = 1 WHERE id = ?').run(a);
  // The route reads the raw query, so build it the way a client sends it: one encoded value.
  const q = (value: string) => `?q=${encodeURIComponent(value)}`;

  expect((await list(q('C++'))).map((s) => s.id)).toEqual([a]);
  expect(await list(q('"('))).toEqual([]);
  expect(await list(q('eigen*'))).toEqual([]);
  expect((await list(`?subjectId=1&q=${encodeURIComponent('C++')}`)).map((s) => s.id)).toEqual([a]);
  expect(await list(`?subjectId=1&q=${encodeURIComponent('Draft')}`)).toEqual([]);
  expect((await list(q('Draft'))).map((s) => s.id)).toEqual([b]);
});

it('filters by source', async () => {
  const synced = insertSession('From the Mac and GitHub', 5);
  const local = insertSession('Local only', 4);
  attach(synced, 'hw.py', 'x = 1\n');
  createAttachment(t, { sessionId: synced, filename: 'zzz.py', bytes: Buffer.from('y = 2\n'), source: 'github', repoPath: 'sessions/hw/zzz.py' });
  attach(local, 'hw2.py', 'z = 3\n');

  expect((await list('?source=github')).map((s) => s.id)).toEqual([synced]);
  // A session counts as uploaded when any of its files was.
  expect((await list('?source=upload')).map((s) => s.id).sort()).toEqual([synced, local].sort());
  expect(await list('?source=github&kind=pdf')).toEqual([]);
});

it('rejects a bad kind, source or date', async () => {
  for (const query of ['?kind=spreadsheet', '?source=icloud', '?from=yesterday']) {
    const res = await t.req('GET', `/api/sessions${query}`);
    expect(res.status).toBe(400);
  }
});
