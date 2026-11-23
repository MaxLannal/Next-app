import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment } from '../../shared/types.ts';
import { UnavailableError } from '../context.ts';
import { search } from '../lib/search.ts';
import { createAttachment, onAttachmentCreated } from '../repo/attachments.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(async () => {
  await t.jobs.drain();
  t.cleanup();
});

const monthDir = () => join(t.paths.filesDir, '2026', '11');

function insertSession(name = 'Ch. 4 exercises'): number {
  const now = t.now().toISOString();
  const res = t.db
    .prepare(`INSERT INTO focus_sessions (name, status, started_at, created_at) VALUES (?, 'done', ?, ?)`)
    .run(name, now, now);
  return Number(res.lastInsertRowid);
}

function upload(files: [name: string, content: string][], sessionId?: number | string): Promise<Response> {
  const form = new FormData();
  for (const [name, content] of files) form.append('files', new File([content], name));
  if (sessionId !== undefined) form.append('sessionId', String(sessionId));
  return t.req('POST', '/api/attachments', form);
}

async function uploadOk(files: [string, string][], sessionId?: number | string): Promise<Attachment[]> {
  const res = await upload(files, sessionId);
  expect(res.status).toBe(201);
  return (await res.json()) as Attachment[];
}

const getAttachment = async (id: number) => (await (await t.req('GET', `/api/attachments/${id}`)).json()) as Attachment;
const storedPath = (id: number) =>
  (t.db.prepare('SELECT path FROM attachments WHERE id = ?').get(id) as { path: string }).path;

describe('upload', () => {
  it('uploads two files to a session', async () => {
    const sessionId = insertSession();
    const list = await uploadOk(
      [
        ['photo.png', 'fake png bytes'],
        ['hw.py', 'print("quadratic residues")\n'],
      ],
      sessionId,
    );

    expect(list).toHaveLength(2);
    expect(list.map((a) => a.kind)).toEqual(['image', 'code']);
    for (const a of list) {
      expect(a.sessionId).toBe(sessionId);
      expect(existsSync(join(monthDir(), `${a.id}-${a.filename}`))).toBe(true);
      expect(storedPath(a.id)).toBe(`files/2026/11/${a.id}-${a.filename}`);
    }

    const [photo, code] = list;
    expect(photo).toMatchObject({
      filename: 'photo.png',
      mime: 'image/png',
      size: 14,
      source: 'upload',
      parentId: null,
      extractedText: '',
      visionStatus: null,
      repoPath: null,
      repoState: null,
      createdAt: '2026-11-22T18:00:00.000Z',
      url: `/api/attachments/${photo.id}/file`,
      previewUrl: null,
    });
    expect(code.extractedText).toBe('print("quadratic residues")\n');
    const sha256 = createHash('sha256').update('print("quadratic residues")\n').digest('hex');
    expect(t.db.prepare('SELECT sha256 FROM attachments WHERE id = ?').get(code.id)).toEqual({ sha256 });
    expect(readdirSync(t.paths.tmpDir)).toEqual([]);
  });

  it('files by month in the hub time zone', async () => {
    t.setNow('2026-12-01T03:00:00.000Z'); // still 30 Nov in Chicago
    const [a] = await uploadOk([['hw.py', 'x']]);
    expect(storedPath(a.id)).toBe(`files/2026/11/${a.id}-hw.py`);
  });

  it('indexes the file name and text', async () => {
    const [a] = await uploadOk([['hw.py', 'quadratic residues']]);
    expect(search(t.db, 'quadr')).toEqual([{ kind: 'attachment', refId: a.id, title: 'hw.py', snippet: 'quadratic residues' }]);
    expect(search(t.db, 'hw').map((h) => h.refId)).toEqual([a.id]);
  });

  it('does not read text out of large files or binaries', async () => {
    const [big, pdf] = await uploadOk([
      ['big.txt', 'x'.repeat(1024 * 1024)],
      ['paper.pdf', '%PDF-1.7 not text'],
    ]);
    expect(big.extractedText).toBe('');
    expect(pdf.extractedText).toBe('');
  });

  it('bad session', async () => {
    for (const sessionId of [999, 'abc', '1.5']) {
      const res = await upload([['hw.py', 'x']], sessionId);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'No such session' });
    }
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM attachments').get()).toEqual({ n: 0 });
    expect(readdirSync(t.paths.filesDir)).toEqual([]);
  });

  it('without files', async () => {
    const res = await t.req('POST', '/api/attachments', new FormData());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No files' });
  });

  it('an empty sessionId means unfiled', async () => {
    const [a] = await uploadOk([['hw.py', 'x']], '');
    expect(a.sessionId).toBeNull();
  });

  it('same filename twice keeps both', async () => {
    const sessionId = insertSession();
    const [first] = await uploadOk([['hw.py', 'print(1)\n']], sessionId);
    const [second] = await uploadOk([['hw.py', 'print(2)\n']], sessionId);

    const res = await t.req('GET', `/api/attachments?sessionId=${sessionId}`);
    const list = (await res.json()) as Attachment[];
    expect(list.map((a) => a.id)).toEqual([first.id, second.id]);
    expect(list.map((a) => a.filename)).toEqual(['hw.py', 'hw.py']);

    const paths = [storedPath(first.id), storedPath(second.id)];
    expect(new Set(paths).size).toBe(2);
    expect(paths.map((p) => readFileSync(join(t.paths.dataDir, p), 'utf8'))).toEqual(['print(1)\n', 'print(2)\n']);
  });

  it('stores a safe file name', async () => {
    const [a] = await uploadOk([['../../etc/passwd', 'root']]);
    expect(a.filename).toBe('passwd');
    expect(existsSync(join(monthDir(), `${a.id}-passwd`))).toBe(true);
  });
});

describe('serving', () => {
  it('serves the file', async () => {
    const [photo, code] = await uploadOk([
      ['photo.png', 'fake png bytes'],
      ['hw.py', 'print(1)\n'],
    ]);

    const py = await t.req('GET', code.url);
    expect(py.status).toBe(200);
    expect(py.headers.get('content-type')).toMatch(/^text\/x-python/);
    expect(py.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''hw.py");
    expect(py.headers.get('x-content-type-options')).toBe('nosniff');
    expect(py.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(await py.text()).toBe('print(1)\n');

    const png = await t.req('GET', photo.url);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(png.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(png.headers.get('content-length')).toBe('14');
    expect(await png.text()).toBe('fake png bytes');
  });

  it('encodes unicode file names', async () => {
    const [a] = await uploadOk([['微积分 作业 (1).pdf', '%PDF']]);
    const res = await t.req('GET', a.url);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(
      "inline; filename*=UTF-8''%E5%BE%AE%E7%A7%AF%E5%88%86%20%E4%BD%9C%E4%B8%9A%20%281%29.pdf",
    );
  });

  it('serves html and svg as downloads', async () => {
    const files = await uploadOk([
      ['page.html', '<script>alert(1)</script>'],
      ['logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ]);
    for (const a of files) {
      const res = await t.req('GET', a.url);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      expect(res.headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''${a.filename}`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });

  it('unknown ids are 404', async () => {
    for (const path of ['/api/attachments/999', '/api/attachments/999/file', '/api/attachments/abc/file']) {
      expect((await t.req('GET', path)).status).toBe(404);
    }
    const [a] = await uploadOk([['hw.py', 'x']]);
    expect((await t.req('GET', `/api/attachments/${a.id}/preview`)).status).toBe(404);
  });
});

describe('HEIC previews', () => {
  it('HEIC gets a preview', async () => {
    const [a] = await uploadOk([['IMG_0001.HEIC', 'heic bytes']]);
    await t.jobs.drain();

    const previewCalls = t.fakes.mac.calls.convertImage.filter(([, dest]) => dest.endsWith('.preview.jpg'));
    expect(previewCalls).toHaveLength(1);
    const [src, dest, maxPixels] = previewCalls[0];
    expect(maxPixels).toBe(2000);
    expect(src).toBe(join(monthDir(), `${a.id}-IMG_0001.HEIC`));
    expect(dest).toBe(join(monthDir(), `${a.id}-IMG_0001.preview.jpg`));

    const after = await getAttachment(a.id);
    expect(after.previewUrl).toBe(`/api/attachments/${a.id}/preview`);
    const res = await t.req('GET', after.previewUrl!);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''IMG_0001.jpg");
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(await res.text()).toBe('heic bytes');
  });

  it('a preview never lands on a later upload', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.fakes.mac.convertImage = async (_src, dest) => {
      await gate;
      writeFileSync(dest, 'jpeg');
    };

    const [heic] = await uploadOk([['IMG_0001.HEIC', 'heic bytes']]);
    expect((await t.req('DELETE', `/api/attachments/${heic.id}`)).status).toBe(204);
    const [jpg] = await uploadOk([['photo.jpg', 'jpg bytes']]);
    release();
    await t.jobs.drain();

    expect(jpg.id).not.toBe(heic.id);
    expect((await getAttachment(jpg.id)).previewUrl).toBeNull();
    expect(readdirSync(monthDir())).toEqual([`${jpg.id}-photo.jpg`]);
  });

  it('other images get no preview', async () => {
    await uploadOk([['photo.png', 'png']]);
    await t.jobs.drain();
    expect(t.fakes.mac.calls.convertImage).toHaveLength(0);
  });

  it('a failed conversion leaves no preview', async () => {
    t.fakes.mac.convertImage = async () => {
      throw new UnavailableError('Mac helpers are not set up yet');
    };
    const [a] = await uploadOk([['IMG_0002.heif', 'heif bytes']]);
    await t.jobs.drain();

    expect((await getAttachment(a.id)).previewUrl).toBeNull();
    expect(readdirSync(monthDir())).toEqual([`${a.id}-IMG_0002.heif`]);
  });
});

describe('listing and editing', () => {
  it('lists by session, unfiled and source', async () => {
    const sessionId = insertSession();
    const [filed] = await uploadOk([['hw.py', 'x']], sessionId);
    const [loose] = await uploadOk([['notes.md', 'y']]);
    const synced = createAttachment(t, {
      sessionId: null,
      filename: 'idea.md',
      bytes: Buffer.from('z'),
      source: 'github',
      repoPath: 'notes/idea.md',
    });
    expect(synced).toMatchObject({ source: 'github', repoPath: 'notes/idea.md', repoState: 'synced' });

    const ids = async (query: string) =>
      ((await (await t.req('GET', `/api/attachments${query}`)).json()) as Attachment[]).map((a) => a.id);
    expect(await ids(`?sessionId=${sessionId}`)).toEqual([filed.id]);
    expect(await ids('?unfiled=1')).toEqual([loose.id, synced.id]);
    expect(await ids('?unfiled=1&source=github')).toEqual([synced.id]);
    expect(await ids('?source=upload')).toEqual([filed.id, loose.id]);
    expect(await ids('')).toEqual([filed.id, loose.id, synced.id]);
    expect((await t.req('GET', '/api/attachments?source=dropbox')).status).toBe(400);
    expect((await t.req('GET', '/api/attachments?sessionId=x')).status).toBe(400);
  });

  it('lists several sessions in one read', async () => {
    const a = insertSession('One');
    const b = insertSession('Two');
    const c = insertSession('Three');
    const [a1] = await uploadOk([['a.png', '1']], a);
    const [a2] = await uploadOk([['a.txt', '2']], a);
    const [b1] = await uploadOk([['b.png', '3']], b);
    await uploadOk([['c.png', '4']], c);
    await uploadOk([['loose.png', '5']]);

    const ids = async (query: string) =>
      ((await (await t.req('GET', `/api/attachments${query}`)).json()) as Attachment[]).map((x) => x.id);
    expect(await ids(`?sessionIds=${a},${b}`)).toEqual([a1.id, a2.id, b1.id]);
    expect(await ids(`?sessionIds=${b}`)).toEqual(await ids(`?sessionId=${b}`));
    expect(await ids('?sessionIds=')).toEqual([]);
    expect((await t.req('GET', '/api/attachments?sessionIds=1,x')).status).toBe(400);
  });

  it('patch updates text and session, and re-indexes', async () => {
    const sessionId = insertSession();
    const [a] = await uploadOk([['photo.png', 'png']]);

    const res = await t.req('PATCH', `/api/attachments/${a.id}`, { extractedText: 'eigenvalue sketch', sessionId });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: a.id, extractedText: 'eigenvalue sketch', sessionId });
    expect(search(t.db, 'eigen').map((h) => h.refId)).toEqual([a.id]);

    const unfiled = await t.req('PATCH', `/api/attachments/${a.id}`, { sessionId: null });
    expect(await unfiled.json()).toMatchObject({ sessionId: null, extractedText: 'eigenvalue sketch' });
  });

  it('patch moves derived files with their parent', async () => {
    const sessionId = insertSession();
    const parent = createAttachment(t, { sessionId: null, filename: 'IMG_0003.jpg', bytes: Buffer.from('jpg') });
    const child = createAttachment(t, {
      sessionId: null,
      parentId: parent.id,
      filename: 'IMG_0003.tex',
      bytes: Buffer.from('x^2'),
    });

    await t.req('PATCH', `/api/attachments/${parent.id}`, { sessionId });
    expect((await getAttachment(child.id)).sessionId).toBe(sessionId);
  });

  it('patch rejects bad input', async () => {
    const [a] = await uploadOk([['hw.py', 'x']]);
    const bad = async (body: unknown) => (await t.req('PATCH', `/api/attachments/${a.id}`, body)).status;

    expect(await bad({ sessionId: 999 })).toBe(400);
    expect(await bad({ sessionId: 'abc' })).toBe(400);
    expect(await bad({ extractedText: 5 })).toBe(400);
    expect(await bad('not json')).toBe(400);
    expect((await t.req('PATCH', '/api/attachments/999', { extractedText: 'x' })).status).toBe(404);
  });

  it('delete removes files', async () => {
    const [a] = await uploadOk([['IMG_0001.HEIC', 'heic bytes']]);
    await t.jobs.drain();
    const child = createAttachment(t, {
      sessionId: null,
      parentId: a.id,
      filename: 'IMG_0001.tex',
      bytes: Buffer.from('residue'),
    });
    expect(readdirSync(monthDir())).toHaveLength(3);

    const res = await t.req('DELETE', `/api/attachments/${a.id}`);
    expect(res.status).toBe(204);
    expect(readdirSync(monthDir())).toEqual([]);
    expect((await t.req('GET', `/api/attachments/${a.id}`)).status).toBe(404);
    expect((await t.req('GET', `/api/attachments/${child.id}`)).status).toBe(404);
    expect(search(t.db, 'IMG')).toEqual([]);
    expect(search(t.db, 'residue')).toEqual([]);

    expect((await t.req('DELETE', `/api/attachments/${a.id}`)).status).toBe(404);
  });
});

describe('createAttachment', () => {
  it('runs onAttachmentCreated handlers after the commit, and a failing one never fails the upload', async () => {
    const seen: { id: number; committed: boolean }[] = [];
    const failing = () => {
      throw new Error('handler boom');
    };
    const recording = (_ctx: unknown, a: Attachment) => {
      const row = t.db.prepare('SELECT id FROM attachments WHERE id = ?').get(a.id);
      seen.push({ id: a.id, committed: row !== undefined && !t.db.isTransaction });
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    onAttachmentCreated.push(failing, recording);
    try {
      const [a] = await uploadOk([['hw.py', 'x']]);
      expect(seen).toEqual([{ id: a.id, committed: true }]);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(String(errors.mock.calls[0])).toContain(`attachment ${a.id}`);
    } finally {
      onAttachmentCreated.splice(onAttachmentCreated.indexOf(failing), 2);
      errors.mockRestore();
    }
  });

  it('extractedText given by the caller wins', () => {
    const a = createAttachment(t, {
      sessionId: null,
      filename: 'IMG_0004.tex',
      bytes: Buffer.from('\\begin{document}x\\end{document}'),
      extractedText: 'x',
    });
    expect(a.extractedText).toBe('x');
    expect(a.kind).toBe('latex');
  });

  it('a failed insert leaves no file behind', () => {
    expect(() =>
      createAttachment(t, { sessionId: null, parentId: 999, filename: 'orphan.tex', bytes: Buffer.from('x') }),
    ).toThrow();
    expect(readdirSync(t.paths.tmpDir)).toEqual([]);
    expect(readdirSync(t.paths.filesDir)).toEqual([]);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM attachments').get()).toEqual({ n: 0 });
    expect(t.db.isTransaction).toBe(false);
  });
});
