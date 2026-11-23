import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Resource } from '../../shared/types.ts';
import { makeTestContext, TEST_NOW, type TestContext } from '../test/helpers.ts';

// The routes fetch titles with the global fetch. Tests answer from fixtures; nothing reaches the network.
const pages: Record<string, () => Response> = {
  'https://example.com/notes': () => new Response('<title>Lecture notes</title>', { headers: { 'content-type': 'text/html' } }),
  'https://example.com/ladr.pdf': () =>
    new Response('%PDF-1.4\n1 0 obj << /Title (Linear Algebra Done Right) >> endobj', {
      headers: { 'content-type': 'application/pdf' },
    }),
  'https://www.coursera.org/learn/ml': () =>
    new Response('<meta property="og:title" content="Machine Learning">', { headers: { 'content-type': 'text/html' } }),
};
const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const page = pages[String(input)];
  if (!page) throw new Error(`Unexpected fetch: ${String(input)}`);
  return page();
});

let t: TestContext;
beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
  vi.unstubAllGlobals();
});

async function add(url: string): Promise<Resource> {
  const res = await t.req('POST', '/api/resources', { url });
  expect(res.status).toBe(201);
  return (await res.json()) as Resource;
}

async function list(query = ''): Promise<Resource[]> {
  const res = await t.req('GET', `/api/resources${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Resource[];
}

it('rejects non-links', async () => {
  for (const url of ['javascript:alert(1)', 'ftp://example.com/file', 'not a link', '', 42]) {
    const res = await t.req('POST', '/api/resources', { url });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That doesn't look like a link" });
  }
  const noBody = await t.req('POST', '/api/resources', 'nope', { headers: { 'content-type': 'application/json' } });
  expect(noBody.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await list()).toEqual([]);
});

it('adds a link with its fetched title', async () => {
  const added = await add('  https://example.com/notes  ');

  expect(added).toEqual({
    id: expect.any(Number),
    url: 'https://example.com/notes',
    title: 'Lecture notes',
    kind: 'link',
    domain: 'example.com',
    thumbnail: null,
    note: '',
    done: false,
    createdAt: TEST_NOW,
  });
  expect(await list()).toEqual([added]);
});

it('stores a private address with the URL as its title, without fetching', async () => {
  const added = await add('http://192.168.1.10/admin');

  expect(added).toMatchObject({ url: 'http://192.168.1.10/admin', title: 'http://192.168.1.10/admin', domain: '192.168.1.10' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('keeps the link when the title fetch fails', async () => {
  const added = await add('https://example.com/unknown');

  expect(added).toMatchObject({ url: 'https://example.com/unknown', title: 'https://example.com/unknown', kind: 'link' });
});

it('lists newest first and filters by kind', async () => {
  const notes = await add('https://example.com/notes');
  const book = await add('https://example.com/ladr.pdf');
  const course = await add('https://www.coursera.org/learn/ml');

  expect(book).toMatchObject({ title: 'Linear Algebra Done Right', kind: 'pdf' });
  expect(course).toMatchObject({ title: 'Machine Learning', kind: 'course', domain: 'coursera.org' });
  expect((await list()).map((r) => r.id)).toEqual([course.id, book.id, notes.id]);
  expect(await list('?kind=pdf')).toEqual([book]);
  expect(await list('?kind=video')).toEqual([]);
  expect((await list('?kind=')).length).toBe(3);

  const bad = await t.req('GET', '/api/resources?kind=podcast');
  expect(bad.status).toBe(400);
});

it('edits title, kind, note and done', async () => {
  const added = await add('https://example.com/notes');

  const res = await t.req('PATCH', `/api/resources/${added.id}`, {
    title: '  Axler, chapter 3  ',
    kind: 'course',
    note: 'Do the exercises',
    done: true,
  });
  expect(res.status).toBe(200);
  const edited = (await res.json()) as Resource;
  expect(edited).toEqual({ ...added, title: 'Axler, chapter 3', kind: 'course', note: 'Do the exercises', done: true });
  expect(await list()).toEqual([edited]);

  const undone = await t.req('PATCH', `/api/resources/${added.id}`, { done: false });
  expect(await undone.json()).toMatchObject({ done: false, title: 'Axler, chapter 3' });
});

it('refuses bad edits', async () => {
  const added = await add('https://example.com/notes');

  for (const body of [{ title: '   ' }, { kind: 'podcast' }, { done: 'yes' }, { note: 7 }]) {
    const res = await t.req('PATCH', `/api/resources/${added.id}`, body);
    expect(res.status).toBe(400);
  }
  expect(await list()).toEqual([added]);

  const missing = await t.req('PATCH', '/api/resources/999', { done: true });
  expect(missing.status).toBe(404);
  const notAnId = await t.req('PATCH', '/api/resources/abc', { done: true });
  expect(notAnId.status).toBe(404);
});

it('deletes a resource', async () => {
  const keep = await add('https://example.com/notes');
  const drop = await add('https://example.com/ladr.pdf');

  const res = await t.req('DELETE', `/api/resources/${drop.id}`);
  expect(res.status).toBe(204);
  expect(await list()).toEqual([keep]);

  const again = await t.req('DELETE', `/api/resources/${drop.id}`);
  expect(again.status).toBe(404);
});
