import { afterEach, beforeEach, expect, it } from 'vitest';
import { makeTestContext, type TestContext } from '../test/helpers.ts';
import { indexDoc, removeDoc, search } from './search.ts';

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

it('finds by prefix', () => {
  indexDoc(t.db, 'attachment', 7, 'nt.tex', 'quadratic residues');
  indexDoc(t.db, 'essay', 1, 'On attention', 'stoic practice');

  const hits = search(t.db, 'quadr');
  expect(hits).toHaveLength(1);
  expect(hits[0]).toEqual({ kind: 'attachment', refId: 7, title: 'nt.tex', snippet: 'quadratic residues' });
});

it('search tolerates FTS syntax', () => {
  indexDoc(t.db, 'attachment', 1, 'hw.py', 'C++ draft (final) AND notes');
  const nasty = [
    'C++',
    '"',
    '-draft',
    '*',
    '(',
    'AND',
    'NEAR(',
    'title:hw',
    '^x',
    "'",
    '\\',
    '""',
    'a OR',
    ')',
    '{x}',
    '🙂',
    '\u0000',
    'a\u0000b',
    'draft\u0007\u001b',
  ];
  for (const q of nasty) {
    const hits = search(t.db, q);
    expect(Array.isArray(hits), q).toBe(true);
  }
  // Operators and punctuation are plain words, not syntax.
  expect(search(t.db, 'AND')).toHaveLength(1);
  expect(search(t.db, '-draft')).toHaveLength(1);
  // Control characters separate words.
  expect(search(t.db, 'draft\u0000notes')).toHaveLength(1);
  expect(search(t.db, '\u0000')).toEqual([]);
});

it('matches every token', () => {
  indexDoc(t.db, 'session', 1, 'Ch. 4 exercises', 'eigenvalue decomposition');
  indexDoc(t.db, 'session', 2, 'Ch. 5 exercises', 'eigenvalue bounds');

  expect(search(t.db, 'eigen decomp').map((h) => h.refId)).toEqual([1]);
  expect(search(t.db, 'exerc')).toHaveLength(2);
});

it('matches CJK text', () => {
  indexDoc(t.db, 'attachment', 3, '微积分 作业.pdf', '');
  expect(search(t.db, '微积')).toHaveLength(1);
});

it('an empty query returns nothing', () => {
  indexDoc(t.db, 'essay', 1, 'Plans', 'anything');
  expect(search(t.db, '')).toEqual([]);
  expect(search(t.db, '   ')).toEqual([]);
});

it('indexing again replaces the row', () => {
  indexDoc(t.db, 'essay', 1, 'Draft', 'first words');
  indexDoc(t.db, 'essay', 1, 'Draft', 'second thoughts');

  expect(search(t.db, 'first')).toEqual([]);
  expect(search(t.db, 'second')).toHaveLength(1);
});

it('the same ref id under another kind is a separate row', () => {
  indexDoc(t.db, 'essay', 1, 'Essay', 'shared word');
  indexDoc(t.db, 'session', 1, 'Session', 'shared word');
  removeDoc(t.db, 'essay', 1);

  expect(search(t.db, 'shared')).toEqual([{ kind: 'session', refId: 1, title: 'Session', snippet: 'shared word' }]);
});

it('respects the limit', () => {
  for (let i = 1; i <= 5; i++) indexDoc(t.db, 'session', i, `Session ${i}`, 'calculus');
  expect(search(t.db, 'calculus', 3)).toHaveLength(3);
});

it('serves hits over HTTP', async () => {
  indexDoc(t.db, 'attachment', 9, 'hw.py', 'quadratic residues');

  const res = await t.req('GET', `/api/search?q=${encodeURIComponent('quadr')}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([{ kind: 'attachment', refId: 9, title: 'hw.py', snippet: 'quadratic residues' }]);

  const odd = await t.req('GET', `/api/search?q=${encodeURIComponent('C++ "(')}`);
  expect(odd.status).toBe(200);
  expect(Array.isArray(await odd.json())).toBe(true);

  const nul = await t.req('GET', '/api/search?q=a%00b');
  expect(nul.status).toBe(200);
  expect(Array.isArray(await nul.json())).toBe(true);

  const none = await t.req('GET', '/api/search');
  expect(await none.json()).toEqual([]);
});
