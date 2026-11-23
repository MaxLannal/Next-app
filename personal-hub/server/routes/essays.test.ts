import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Essay, EssaySummary } from '../../shared/types.ts';
import { search } from '../lib/search.ts';
import { makeTestContext, TEST_NOW, type TestContext } from '../test/helpers.ts';

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

const MINUTE = 60_000;

/** Moves the clock `minutes` past the test's fixed start. */
const at = (minutes: number) => t.setNow(new Date(Date.parse(TEST_NOW) + minutes * MINUTE).toISOString());

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (text: string) => ({ type: 'doc', content: [para(text)] });
const twoParagraphs = (first: string, second: string) => ({ type: 'doc', content: [para(first), para(second)] });

async function create(column = 'meditations', title = ''): Promise<Essay> {
  const res = await t.req('POST', '/api/essays', { column });
  expect(res.status).toBe(201);
  const essay = (await res.json()) as Essay;
  if (title !== '') {
    const saved = await save(essay.id, { title, baseUpdatedAt: essay.updatedAt });
    expect(saved.status).toBe(200);
    const again = await t.req('GET', `/api/essays/${essay.id}`);
    return (await again.json()) as Essay;
  }
  return essay;
}

function save(id: number, body: Record<string, unknown>) {
  return t.req('PUT', `/api/essays/${id}`, {
    title: '',
    contentJson: doc('A line'),
    plainText: 'A line',
    wordCount: 2,
    ...body,
  });
}

async function list(): Promise<EssaySummary[]> {
  const res = await t.req('GET', '/api/essays');
  expect(res.status).toBe(200);
  return (await res.json()) as EssaySummary[];
}

async function snapshots(id: number): Promise<{ id: number; createdAt: string }[]> {
  const res = await t.req('GET', `/api/essays/${id}/snapshots`);
  expect(res.status).toBe(200);
  return (await res.json()) as { id: number; createdAt: string }[];
}

it('creates in a column', async () => {
  const created = await create('plans');

  expect(created).toEqual({
    id: expect.any(Number),
    column: 'plans',
    title: '',
    firstLine: '',
    wordCount: 0,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    contentJson: { type: 'doc', content: [] },
  });
  const summaries = await list();
  const { contentJson: _doc, ...summary } = created;
  expect(summaries).toEqual([summary]);

  for (const column of ['meditations', 'insights']) {
    expect((await create(column)).column).toBe(column);
  }
  const bad = await t.req('POST', '/api/essays', { column: 'journal' });
  expect(bad.status).toBe(400);
  expect((await t.req('POST', '/api/essays', {})).status).toBe(400);

  const got = await t.req('GET', `/api/essays/${created.id}`);
  expect(got.status).toBe(200);
  expect(await got.json()).toEqual(created);
  expect((await t.req('GET', '/api/essays/999')).status).toBe(404);
  expect((await t.req('GET', '/api/essays/abc')).status).toBe(404);
});

it('saves with the current base', async () => {
  const created = await create('insights');
  at(5);

  const res = await save(created.id, {
    title: '  On attention  ',
    contentJson: doc('Stoic attention'),
    plainText: 'Stoic attention\nMore of it',
    wordCount: 5,
    baseUpdatedAt: created.updatedAt,
  });
  expect(res.status).toBe(200);
  const { updatedAt } = (await res.json()) as { updatedAt: string };
  expect(updatedAt).toBe(new Date(Date.parse(TEST_NOW) + 5 * MINUTE).toISOString());
  expect(updatedAt).not.toBe(created.updatedAt);

  // The first line and count come from the document; the wire's plainText and wordCount don't matter.
  const essay = (await (await t.req('GET', `/api/essays/${created.id}`)).json()) as Essay;
  expect(essay).toMatchObject({
    title: 'On attention',
    contentJson: doc('Stoic attention'),
    firstLine: 'Stoic attention',
    wordCount: 2,
    createdAt: TEST_NOW,
    updatedAt,
  });

  const [summary] = await list();
  expect(summary).toMatchObject({ id: created.id, title: 'On attention', firstLine: 'Stoic attention', wordCount: 2 });
  expect(summary).not.toHaveProperty('contentJson');

  // Moves columns without touching the content; the list puts the newest change first.
  at(10);
  const moved = await t.req('PUT', `/api/essays/${created.id}`, { column: 'plans', baseUpdatedAt: updatedAt });
  expect(moved.status).toBe(200);
  expect((await (await t.req('GET', `/api/essays/${created.id}`)).json()) as Essay).toMatchObject({
    column: 'plans',
    title: 'On attention',
    contentJson: doc('Stoic attention'),
  });

  const other = await create('plans');
  at(15);
  await save(other.id, { title: 'Newer', baseUpdatedAt: other.updatedAt });
  expect((await list()).map((e) => e.id)).toEqual([other.id, created.id]);

  for (const body of [{ title: 7 }, { wordCount: -1 }, { contentJson: 'nope' }, { plainText: 3 }, { column: 'x' }]) {
    const res2 = await save(created.id, body);
    expect(res2.status).toBe(400);
  }
  expect((await save(created.id, {})).status).toBe(400); // no base
  expect((await t.req('PUT', '/api/essays/999', { baseUpdatedAt: TEST_NOW })).status).toBe(404);
});

it('rejects a stale save', async () => {
  const created = await create('meditations');
  at(2);
  const first = await save(created.id, { title: 'First save', baseUpdatedAt: created.updatedAt });
  expect(first.status).toBe(200);

  at(4);
  const second = await save(created.id, { title: 'Second save', baseUpdatedAt: created.updatedAt });
  expect(second.status).toBe(409);
  const body = (await second.json()) as { error: string; current: Essay };
  expect(body.error).toBe('Changed elsewhere');
  expect(body.current.title).toBe('First save');
  expect(body.current).toMatchObject({ id: created.id, column: 'meditations' });
  expect(body.current).toHaveProperty('contentJson');

  // Nothing from the stale save landed.
  const essay = (await (await t.req('GET', `/api/essays/${created.id}`)).json()) as Essay;
  expect(essay.title).toBe('First save');

  // Reloading and saving against the fresh base works.
  const retry = await save(created.id, { title: 'Second save', baseUpdatedAt: body.current.updatedAt });
  expect(retry.status).toBe(200);
});

it('snapshots at most every five minutes', async () => {
  const created = await create();

  const counts: number[] = [];
  let base = created.updatedAt;
  for (const minute of [0, 2, 6, 8]) {
    at(minute);
    const res = await save(created.id, { title: `Draft at ${minute}m`, baseUpdatedAt: base });
    expect(res.status).toBe(200);
    base = ((await res.json()) as { updatedAt: string }).updatedAt;
    counts.push((await snapshots(created.id)).length);
  }

  expect(counts).toEqual([0, 1, 1, 2]);
  // Newest first; each taken at the save whose stored content it holds.
  const mins = (ms: number) => new Date(Date.parse(TEST_NOW) + ms * MINUTE).toISOString();
  expect(await snapshots(created.id)).toEqual([
    { id: expect.any(Number), createdAt: mins(8) },
    { id: expect.any(Number), createdAt: mins(2) },
  ]);

  // A save that clears the content never snapshots an empty doc, and 5 minutes
  // after the last snapshot one is due again.
  // At 14 min it is due again (6 minutes on), so the text being cleared is kept.
  at(14);
  expect((await save(created.id, { contentJson: { type: 'doc', content: [] }, plainText: '', wordCount: 0, baseUpdatedAt: base })).status).toBe(200);
  expect((await snapshots(created.id))[0]).toEqual({ id: expect.any(Number), createdAt: mins(14) });
  // At 20 min the stored doc is empty, so nothing is snapped.
  at(20);
  expect((await save(created.id, { title: 'Back', baseUpdatedAt: mins(14) })).status).toBe(200);
  expect((await snapshots(created.id))[0]?.createdAt).toBe(mins(14));
});

it('keeps thirty', async () => {
  // Saves at 0, 6, 12 … 210 min. Each one past the first sees the newest snapshot 6 minutes
  // old, so each takes one first: 35 snapshots in all, and the oldest five fall away.
  const created = await create();
  let base = created.updatedAt;
  for (let i = 0; i <= 35; i++) {
    at(i * 6);
    const res = await save(created.id, { title: `Draft ${i}`, baseUpdatedAt: base });
    expect(res.status).toBe(200);
    base = ((await res.json()) as { updatedAt: string }).updatedAt;
  }

  const kept = await snapshots(created.id);
  expect(kept).toHaveLength(30);
  // The newest 30 survive: taken at the saves from 36 to 210 minutes.
  expect(kept[0]?.createdAt).toBe(new Date(Date.parse(TEST_NOW) + 210 * MINUTE).toISOString());
  expect(kept[29]?.createdAt).toBe(new Date(Date.parse(TEST_NOW) + 36 * MINUTE).toISOString());
});

it('restore snapshots current first', async () => {
  const created = await create();
  at(1);
  const first = await save(created.id, {
    title: 'First',
    contentJson: twoParagraphs('First line', 'Then the rest of it'),
    baseUpdatedAt: created.updatedAt,
  });
  const firstAt = ((await first.json()) as { updatedAt: string }).updatedAt;
  const saved = (await (await t.req('GET', `/api/essays/${created.id}`)).json()) as Essay;
  at(10);
  const second = await save(created.id, {
    title: 'Second',
    contentJson: twoParagraphs('Second line', 'Then more'),
    baseUpdatedAt: firstAt,
  });
  const secondAt = ((await second.json()) as { updatedAt: string }).updatedAt;

  const [snapshot] = await snapshots(created.id); // holds the first document
  expect(snapshot?.createdAt).toBe(secondAt); // taken before the save at 10 min
  const before = (await (await t.req('GET', `/api/essays/${created.id}`)).json()) as Essay;

  at(20);
  const res = await t.req('POST', `/api/essays/${created.id}/snapshots/${snapshot?.id}/restore`);
  expect(res.status).toBe(200);
  const restored = (await res.json()) as Essay;
  // Snapshots hold the document only; the title and column stay as they are.
  expect(restored).toMatchObject({
    id: created.id,
    title: 'Second',
    contentJson: twoParagraphs('First line', 'Then the rest of it'),
    createdAt: TEST_NOW,
  });
  // The restored card reads exactly as it did when saved: the first line ends at the paragraph break.
  expect(saved.firstLine).toBe('First line');
  expect(restored.firstLine).toBe(saved.firstLine);
  expect(restored.wordCount).toBe(saved.wordCount);
  expect(restored.wordCount).toBe(7);
  expect(restored.updatedAt).toBe(new Date(Date.parse(TEST_NOW) + 20 * MINUTE).toISOString());
  expect(restored.updatedAt).not.toBe(secondAt);

  // The restored version re-indexes search too.
  expect(search(t.db, 'first').map((h) => [h.kind, h.refId])).toContainEqual(['essay', created.id]);

  // The restore took a snapshot of what was shown first: "Second", at the restore's time.
  const after = await snapshots(created.id);
  expect(after).toHaveLength(2);
  expect(after[0]?.createdAt).toBe(restored.updatedAt);
  expect(after[1]).toEqual(snapshot);
  expect(before.contentJson).toEqual(twoParagraphs('Second line', 'Then more'));

  const missing = await t.req('POST', `/api/essays/${created.id}/snapshots/999/restore`);
  expect(missing.status).toBe(404);
  const foreign = await t.req('POST', `/api/essays/999/snapshots/${snapshot?.id}/restore`);
  expect(foreign.status).toBe(404);

  await t.req('DELETE', `/api/essays/${created.id}`);
  expect(search(t.db, 'first').map((h) => h.refId)).not.toContain(created.id);
});

it('search finds essay text', async () => {
  const created = await create();
  at(3);
  const res = await save(created.id, {
    title: 'Notes on attention',
    contentJson: twoParagraphs('Notes', 'on stoic attention'),
    plainText: 'ignored: the document is indexed',
    baseUpdatedAt: created.updatedAt,
  });
  expect(res.status).toBe(200);

  const hits = search(t.db, 'stoic');
  expect(hits.some((h) => h.kind === 'essay' && h.refId === created.id)).toBe(true);
  expect(hits.find((h) => h.kind === 'essay')?.title).toBe('Notes on attention');

  // Re-indexing replaces, never duplicates.
  at(9);
  await save(created.id, {
    title: 'Renamed',
    contentJson: twoParagraphs('Notes', 'on stoic attention'),
    baseUpdatedAt: new Date(Date.parse(TEST_NOW) + 3 * MINUTE).toISOString(),
  });
  const again = search(t.db, 'stoic').filter((h) => h.kind === 'essay');
  expect(again).toHaveLength(1);
  expect(again[0]?.title).toBe('Renamed');

  const api = await t.req('GET', '/api/search?q=stoic');
  expect(api.status).toBe(200);
  expect(((await api.json()) as { kind: string }[]).some((h) => h.kind === 'essay')).toBe(true);
});

it('stores and serves pasted images', async () => {
  const form = new FormData();
  form.set('file', new File(['fake png bytes'], 'Pasted image.png', { type: 'image/png' }));
  const res = await t.req('POST', '/api/essay-images', form);
  expect(res.status).toBe(201);
  const { url } = (await res.json()) as { url: string };
  expect(url).toMatch(/^\/api\/essay-images\/[A-Za-z0-9-]+\.png$/);

  const image = await t.req('GET', url);
  expect(image.status).toBe(200);
  expect(image.headers.get('content-type')).toBe('image/png');
  expect(image.headers.get('x-content-type-options')).toBe('nosniff');
  expect(Buffer.from(await image.arrayBuffer()).toString()).toBe('fake png bytes');

  const bad = new FormData();
  bad.set('file', new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }));
  expect((await t.req('POST', '/api/essay-images', bad)).status).toBe(400);
  expect((await t.req('GET', '/api/essay-images/nope.png')).status).toBe(404);
  expect((await t.req('GET', '/api/essay-images/..%2F..%2Fhub.db')).status).toBe(404);
  expect((await t.req('GET', '/api/essay-images/%E0%A4%A.png')).status).toBe(404); // a malformed escape
});

it('deletes an essay', async () => {
  const keep = await create();
  const drop = await create();
  at(2);
  await save(drop.id, { contentJson: doc('gone words'), baseUpdatedAt: drop.updatedAt });

  const res = await t.req('DELETE', `/api/essays/${drop.id}`);
  expect(res.status).toBe(204);
  expect((await list()).map((e) => e.id)).toEqual([keep.id]);
  expect((await t.req('GET', `/api/essays/${drop.id}`)).status).toBe(404);
  expect((await t.req('GET', `/api/essays/${drop.id}/snapshots`)).status).toBe(404);
  expect(search(t.db, 'gone')).toEqual([]);
  expect((await t.req('DELETE', `/api/essays/${drop.id}`)).status).toBe(404);
});
