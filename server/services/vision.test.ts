import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Attachment } from '../../shared/types.ts';
import { UnavailableError } from '../context.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';
import { createClaudeClient } from './claude.ts';
import { processImage, registerVision, TEX_TEMPLATE } from './vision.ts';

let t: TestContext;
let unregister: () => void;

beforeEach(() => {
  t = makeTestContext();
  unregister = registerVision();
});
afterEach(async () => {
  await t.jobs.drain();
  unregister();
  t.cleanup();
});

async function uploadImage(name = 'IMG_0001.jpg', sessionId?: number): Promise<{ status: number; list: Attachment[] }> {
  const form = new FormData();
  form.append('files', new File(['fake jpeg bytes'], name));
  if (sessionId !== undefined) form.append('sessionId', String(sessionId));
  const res = await t.req('POST', '/api/attachments', form);
  return { status: res.status, list: (await res.json()) as Attachment[] };
}

const getAttachment = async (id: number) => (await (await t.req('GET', `/api/attachments/${id}`)).json()) as Attachment;
const storedPath = (id: number) =>
  (t.db.prepare('SELECT path FROM attachments WHERE id = ?').get(id) as { path: string }).path;
const readStored = (id: number) => readFileSync(join(t.paths.dataDir, storedPath(id)), 'utf8');
const monthDir = () => join(t.paths.filesDir, '2026', '11');
const countAttachments = () => (t.db.prepare('SELECT COUNT(*) AS n FROM attachments').get() as { n: number }).n;
const childOf = (parentId: number) =>
  t.db
    .prepare('SELECT id, filename, session_id FROM attachments WHERE parent_id = ?')
    .get(parentId) as { id: number; filename: string; session_id: number | null } | undefined;

function insertSession(): number {
  const now = t.now().toISOString();
  return Number(
    t.db
      .prepare(`INSERT INTO focus_sessions (name, status, started_at, created_at) VALUES ('Ch. 4', 'done', ?, ?)`)
      .run(now, now).lastInsertRowid,
  );
}

describe('photo to LaTeX', () => {
  it('latex reading creates a .tex child', async () => {
    t.fakes.claude.readImage = async () => ({ kind: 'latex', latex: 'x^2+1=0' });

    const { status, list } = await uploadImage();
    expect(status).toBe(201);
    await t.jobs.drain();

    expect(countAttachments()).toBe(2);
    const parent = await getAttachment(list[0]!.id);
    const child = childOf(parent.id);
    expect(child).toBeDefined();
    const text = await getAttachment(child!.id);

    expect(text.filename).toBe('IMG_0001.tex');
    expect(text.kind).toBe('latex');
    expect(text.parentId).toBe(parent.id);
    expect(text.extractedText).toBe('x^2+1=0');
    expect(readStored(text.id)).toContain('\\begin{document}');
    expect(readStored(text.id)).toContain('x^2+1=0');
    expect(parent.visionStatus).toBe('done');
  });

  it('caption reading', async () => {
    t.fakes.claude.readImage = async () => ({ kind: 'caption', caption: 'Chapters 3 to 5 of the textbook' });

    const { list } = await uploadImage();
    await t.jobs.drain();

    const parent = await getAttachment(list[0]!.id);
    expect(parent.extractedText).toBe('Chapters 3 to 5 of the textbook');
    expect(parent.visionStatus).toBe('done');
    expect(countAttachments()).toBe(1);
  });

  it('failure keeps the upload', async () => {
    t.fakes.claude.readImage = async () => {
      throw new Error('gateway down');
    };

    const { status, list } = await uploadImage();
    await t.jobs.drain();

    expect(status).toBe(201);
    const parent = await getAttachment(list[0]!.id);
    expect(parent.visionStatus).toBe('failed');
    expect(readFileSync(join(t.paths.dataDir, storedPath(parent.id))).toString()).toBe('fake jpeg bytes');
  });

  it('retry endpoint', async () => {
    t.fakes.claude.readImage = async () => {
      throw new Error('gateway down');
    };
    const { list } = await uploadImage();
    await t.jobs.drain();
    expect((await getAttachment(list[0]!.id)).visionStatus).toBe('failed');

    t.fakes.claude.readImage = async () => ({ kind: 'caption', caption: 'Solved' });
    const res = await t.req('POST', `/api/attachments/${list[0]!.id}/vision`);
    expect(res.status).toBe(202);
    await t.jobs.drain();

    expect((await getAttachment(list[0]!.id)).visionStatus).toBe('done');
  });

  it('editing latex rewrites the file', async () => {
    t.fakes.claude.readImage = async () => ({ kind: 'latex', latex: 'x^2+1=0' });
    const { list } = await uploadImage();
    await t.jobs.drain();
    const childId = childOf(list[0]!.id)!.id;

    const res = await t.req('PATCH', `/api/attachments/${childId}`, { extractedText: 'e^{i\\pi}+1=0' });
    expect(res.status).toBe(200);
    const child = (await res.json()) as Attachment;

    expect(readStored(childId)).toBe(TEX_TEMPLATE('e^{i\\pi}+1=0'));
    expect(child.extractedText).toBe('e^{i\\pi}+1=0');
  });

  it('keeps the index and the file in step after an edit', async () => {
    t.fakes.claude.readImage = async () => ({ kind: 'latex', latex: '\\alpha+\\beta' });
    const { list } = await uploadImage();
    await t.jobs.drain();
    const childId = childOf(list[0]!.id)!.id;
    const hits = async (q: string) =>
      ((await (await t.req('GET', `/api/search?q=${encodeURIComponent(q)}`)).json()) as { refId: number }[]).map((h) => h.refId);
    expect(await hits('alpha')).toContain(childId);

    await t.req('PATCH', `/api/attachments/${childId}`, { extractedText: '\\gamma+\\delta' });
    await t.jobs.drain();

    expect(await hits('gamma')).toContain(childId);
    expect(await hits('alpha')).not.toContain(childId);
    expect(readStored(childId)).toContain('\\gamma');
    expect(readStored(childId)).not.toContain('\\alpha');
  });

  it('marks the photo pending while it is being read', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    t.fakes.claude.readImage = async () => {
      await gate;
      return { kind: 'caption', caption: 'Later' };
    };
    const { list } = await uploadImage();
    await new Promise((resolve) => setImmediate(resolve));
    expect((await getAttachment(list[0]!.id)).visionStatus).toBe('pending');

    release();
    await t.jobs.drain();
    expect((await getAttachment(list[0]!.id)).visionStatus).toBe('done');
  });
});

describe('processImage', () => {
  it('converts every photo through the Mac bridge and sends a JPEG', async () => {
    const sent: { data: Buffer; mediaType: string }[] = [];
    t.fakes.claude.readImage = async (img) => {
      sent.push(img);
      return { kind: 'latex', latex: 'y=x^2' };
    };
    const { list } = await uploadImage('notes.png');
    expect(sent).toHaveLength(0); // nothing is read before the queue runs
    await t.jobs.drain();

    // Exactly one handler ran: one conversion, for this photo.
    expect(t.fakes.mac.calls.convertImage).toHaveLength(1);
    const [src, dest, maxPixels] = t.fakes.mac.calls.convertImage[0]!;
    expect(src).toBe(join(t.paths.dataDir, storedPath(list[0]!.id)));
    expect(maxPixels).toBe(2000);
    expect(dirname(dest)).toBe(t.paths.tmpDir);
    // Claude got the converted bytes as a JPEG; the temp file is cleaned up afterwards.
    expect(sent.at(-1)).toEqual({ data: Buffer.from('fake jpeg bytes'), mediaType: 'image/jpeg' });
    expect(existsSync(dest)).toBe(false);
  });

  it('names the child after the original file', async () => {
    t.fakes.claude.readImage = async () => ({ kind: 'latex', latex: 'a+b' });
    const { list } = await uploadImage('hw page.jpg');
    await t.jobs.drain();
    expect(childOf(list[0]!.id)!.filename).toBe('hw page.tex');
  });

  it('files the child in the same session as the photo', async () => {
    const sessionId = insertSession();
    t.fakes.claude.readImage = async () => ({ kind: 'latex', latex: 'a+b' });
    const { list } = await uploadImage('IMG_0001.jpg', sessionId);
    await t.jobs.drain();
    expect(childOf(list[0]!.id)!.session_id).toBe(sessionId);
  });

  it('puts the caption, or "Handwritten work", on the parent', async () => {
    t.fakes.claude.readImage = async () => ({ kind: 'latex', latex: 'a+b' });
    const { list } = await uploadImage();
    await t.jobs.drain();
    expect((await getAttachment(list[0]!.id)).extractedText).toBe('Handwritten work');
  });

  it('indexes the extracted text so search finds it', async () => {
    t.fakes.claude.readImage = async () => ({ kind: 'latex', latex: '\\frac{d}{dx} x^2 = 2x' });
    const { list } = await uploadImage();
    await t.jobs.drain();

    const hits = (await (await t.req('GET', '/api/search?q=frac')).json()) as { refId: number }[];
    expect(hits.map((h) => h.refId)).toContain(childOf(list[0]!.id)!.id);
    const parentHits = (await (await t.req('GET', '/api/search?q=Handwritten')).json()) as { refId: number }[];
    expect(parentHits.map((h) => h.refId)).toContain(list[0]!.id);
  });

  it('refuses a non-image and a derived file', async () => {
    const form = new FormData();
    form.append('files', new File(['print(1)'], 'hw.py'));
    const created = (await (await t.req('POST', '/api/attachments', form)).json()) as Attachment[];
    expect((await t.req('POST', `/api/attachments/${created[0]!.id}/vision`)).status).toBe(400);

    t.fakes.claude.readImage = async () => ({ kind: 'latex', latex: 'a+b' });
    const { list } = await uploadImage();
    await t.jobs.drain();
    expect((await t.req('POST', `/api/attachments/${childOf(list[0]!.id)!.id}/vision`)).status).toBe(400);
  });

  it('404s for a missing photo', async () => {
    expect((await t.req('POST', '/api/attachments/999/vision')).status).toBe(404);
  });

  it('does nothing when the photo was deleted before the job ran', async () => {
    let reads = 0;
    t.fakes.claude.readImage = async () => {
      reads += 1;
      return { kind: 'latex', latex: 'x' };
    };
    const { list } = await uploadImage();
    await t.jobs.drain();
    const before = reads;
    await t.req('DELETE', `/api/attachments/${list[0]!.id}`);

    await processImage(t, list[0]!.id);
    expect(countAttachments()).toBe(0);
    expect(reads).toBe(before);
  });

  it('leaves the .tex file alone when the photo text is edited', async () => {
    t.fakes.claude.readImage = async () => ({ kind: 'latex', latex: 'x' });
    const { list } = await uploadImage();
    await t.jobs.drain();
    const childId = childOf(list[0]!.id)!.id;
    const before = readStored(childId);

    await t.req('PATCH', `/api/attachments/${list[0]!.id}`, { extractedText: 'My notes' });
    expect(readStored(childId)).toBe(before);
  });

  it('replaces the derived file when the reading is re-run', async () => {
    t.fakes.claude.readImage = async () => ({ kind: 'latex', latex: 'first' });
    const { list } = await uploadImage();
    await t.jobs.drain();
    const childId = childOf(list[0]!.id)!.id;

    t.fakes.claude.readImage = async () => ({ kind: 'latex', latex: 'second' });
    expect((await t.req('POST', `/api/attachments/${list[0]!.id}/vision`)).status).toBe(202);
    await t.jobs.drain();

    // One derived file, rewritten: no stale second copy left behind.
    expect(countAttachments()).toBe(2);
    expect(readStored(childOf(list[0]!.id)!.id)).toBe(TEX_TEMPLATE('second'));
    expect(readdirSync(monthDir()).filter((name) => name.endsWith('.tex'))).toHaveLength(1);
  });
});

// ── The real client, against a local stand-in for the gateway ─────────────

type Seen = { path: string; auth: string | undefined; body: Record<string, unknown> };

type Handler = (req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>) => void;

const MESSAGE = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text: '{"kind":"caption","latex":"","caption":"A dog"}' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 5, output_tokens: 5 },
};

const reply = (status: number, body: unknown): Handler => (_req, res) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const replyText = (text: string): Handler => (_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ...MESSAGE, content: [{ type: 'text', text }] }));
};

let gateway: Server;
let baseURL: string;
let seen: Seen[] = [];
let handler: Handler;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });
}

beforeEach(async () => {
  seen = [];
  handler = replyText('{"kind":"caption","latex":"","caption":"A dog"}');
  gateway = createServer(async (req, res) => {
    const raw = await readBody(req);
    const body = raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>);
    seen.push({ path: req.url ?? '', auth: req.headers.authorization, body });
    handler(req, res, body);
  });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const address = gateway.address();
  baseURL = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
});

const cfg = () => ({ baseURL, authToken: 'gateway-token', model: 'claude-opus-5-5' });

describe('createClaudeClient.readImage', () => {
  it('asks for structured output and returns the reading', async () => {
    handler = replyText('{"kind":"latex","latex":"x^2","caption":"A page"}');
    const reading = await createClaudeClient(cfg()).readImage({ data: Buffer.from('jpeg'), mediaType: 'image/jpeg' });

    expect(reading).toEqual({ kind: 'latex', latex: 'x^2' });
    expect(seen).toHaveLength(1);
    const { path, auth, body } = seen[0]!;
    expect(path).toBe('/v1/messages');
    expect(auth).toBe('Bearer gateway-token');
    expect(body.max_tokens).toBe(16000);
    const blocks = (body.messages as { content: { type: string; source?: Record<string, string> }[] }[])[0]!.content;
    expect(blocks[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'anBlZw==' } });
    expect(String(body.system)).toContain('You read photos and scans of someone');
  });

  it('retries as JSON text when the gateway rejects structured output', async () => {
    handler = (req, res) => {
      if (seen.length === 1) return reply(400, { type: 'error', error: { type: 'invalid_request_error', message: 'output_config is not supported' } })(req, res, {});
      return replyText('{"kind":"caption","latex":"","caption":"A dog"}')(req, res, {});
    };
    const reading = await createClaudeClient(cfg()).readImage({ data: Buffer.from('jpeg'), mediaType: 'image/jpeg' });

    expect(reading).toEqual({ kind: 'caption', caption: 'A dog' });
    expect(seen).toHaveLength(2);
    expect(seen[1]!.body.output_config).toBeUndefined();
    expect(String(seen[1]!.body.system)).toContain('Reply with only a JSON object');
  });

  it('reports a missing model as unavailable', async () => {
    handler = reply(404, { type: 'error', error: { type: 'not_found_error', message: 'model: claude-opus-5-5' } });
    const err: unknown = await createClaudeClient(cfg())
      .readImage({ data: Buffer.from('jpeg'), mediaType: 'image/jpeg' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnavailableError);
    expect((err as UnavailableError).message).toBe('Model not found on the gateway');
    expect(seen).toHaveLength(1); // a 404 is not retried as a structured-output problem
  });

  it('names what the gateway sent when there is no parsed reading', async () => {
    handler = reply(200, { ...MESSAGE, content: [] }); // 200 with no text at all
    const err: unknown = await createClaudeClient(cfg())
      .readImage({ data: Buffer.from('jpeg'), mediaType: 'image/jpeg' })
      .catch((e: unknown) => e);
    expect((err as Error).message).toContain('without a parsed reading');
  });
});

// A gateway that streams: text deltas, then message_stop.
const streamReply: Handler = (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (name: string, data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  event('message_start', { type: 'message_start', message: { ...MESSAGE, content: [], usage: { input_tokens: 5, output_tokens: 0 } } });
  event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } });
  event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ', there' } });
  event('content_block_stop', { type: 'content_block_stop', index: 0 });
  event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } });
  event('message_stop', { type: 'message_stop' });
  res.end();
};

describe('streamTurn', () => {
  it('forwards text and returns the final message', async () => {
    handler = streamReply;
    const deltas: string[] = [];
    const message = await createClaudeClient(cfg()).streamTurn(
      { system: 'Be brief.', messages: [{ role: 'user', content: 'Hi' }], tools: [] },
      (d) => deltas.push(d),
    );

    expect(deltas.join('')).toBe('Hello, there');
    expect(message.content[0]).toMatchObject({ type: 'text', text: 'Hello, there' });
    const { body } = seen[0]!;
    expect(body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 64000, thinking: { type: 'adaptive' }, stream: true });
    expect(body.output_config).toEqual({ effort: 'medium' });
  });

  it('reports a missing model as unavailable', async () => {
    handler = reply(404, { type: 'error', error: { type: 'not_found_error', message: 'model: claude-opus-5-5' } });
    const err: unknown = await createClaudeClient(cfg())
      .streamTurn({ system: '', messages: [], tools: [] }, () => {})
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnavailableError);
  });
});

async function uploadFile(name: string, body: string): Promise<Attachment> {
  const form = new FormData();
  form.append('files', new File([body], name));
  const res = await t.req('POST', '/api/attachments', form);
  return ((await res.json()) as Attachment[])[0]!;
}

/** A PDF with `n` page objects, as far as the page count can see. */
const pdfOf = (n: number) => `%PDF-1.7\n${Array.from({ length: n }, (_, i) => `${i + 3} 0 obj << /Type /Page /Parent 2 0 R >> endobj`).join('\n')}\n2 0 obj << /Type /Pages /Count ${n} >> endobj\n%%EOF`;

describe('scanned PDFs to LaTeX', () => {
  it('reads a scanned PDF whole, as a document, into a .tex beside it', async () => {
    const asked: string[] = [];
    t.fakes.claude.readImage = async (img) => {
      asked.push(img.mediaType);
      return { kind: 'latex', latex: '\\textbf{7.1} Let $a<b$.' };
    };
    const pdf = await uploadFile('HW7 scan.pdf', pdfOf(2));
    await t.jobs.drain();
    expect(asked).toEqual(['application/pdf']);
    expect((await getAttachment(pdf.id)).visionStatus).toBe('done');
    expect(childOf(pdf.id)?.filename).toBe('HW7 scan.tex');
    expect(readStored(childOf(pdf.id)!.id)).toBe(TEX_TEMPLATE('\\textbf{7.1} Let $a<b$.'));
  });

  it('reads its first page as a photo when the gateway refuses a PDF', async () => {
    const asked: string[] = [];
    t.fakes.claude.readImage = async (img) => {
      asked.push(img.mediaType);
      if (img.mediaType === 'application/pdf') throw Object.assign(new Error('documents not supported'), { status: 400 });
      return { kind: 'latex', latex: 'x=1' };
    };
    const pdf = await uploadFile('page.pdf', pdfOf(1));
    await t.jobs.drain();
    expect(asked).toEqual(['application/pdf', 'image/jpeg']);
    expect((await getAttachment(pdf.id)).visionStatus).toBe('done');
  });

  it('leaves a long PDF (a book, not a scan) unread', async () => {
    let asked = 0;
    t.fakes.claude.readImage = async () => {
      asked += 1;
      return { kind: 'latex', latex: 'x' };
    };
    const book = await uploadFile('textbook.pdf', pdfOf(40));
    await t.jobs.drain();
    expect(asked).toBe(0);
    expect((await getAttachment(book.id)).visionStatus).toBeNull();
  });
});

describe('when a reading fails', () => {
  const payment = () => Object.assign(new Error('402 insufficient balance'), { status: 402 });

  it('says why: the gateway out of balance, refusing the token, missing the model, or out of reach', async () => {
    const { whyFailed } = await import('./vision.ts');
    expect(whyFailed(payment())).toBe('balance');
    expect(whyFailed(Object.assign(new Error('no'), { status: 401 }))).toBe('auth');
    expect(whyFailed(new UnavailableError('Model not found on the gateway'))).toBe('model');
    expect(whyFailed(new UnavailableError('Claude is not set up yet'))).toBe('setup');
    expect(whyFailed(Object.assign(new Error('busy'), { status: 529 }))).toBe('unreachable');
    expect(whyFailed(Object.assign(new Error('x'), { name: 'APIConnectionError' }))).toBe('unreachable');
    expect(whyFailed(new Error('The gateway replied without a JSON object'))).toBe('unreadable');

    t.fakes.claude.readImage = async () => {
      throw payment();
    };
    const { list } = await uploadImage();
    await t.jobs.drain();
    const photo = await getAttachment(list[0]!.id);
    expect([photo.visionStatus, photo.visionError]).toEqual(['failed', 'balance']);
  });

  it('tries again by itself once the cause passes: one first, the rest once that one lands', async () => {
    const { retryWaitingReadings } = await import('./vision.ts');
    t.fakes.claude.readImage = async () => {
      throw payment();
    };
    const a = (await uploadImage('IMG_1.HEIC')).list[0]!;
    const b = (await uploadImage('IMG_2.HEIC')).list[0]!;
    const broken = (await uploadImage('IMG_3.HEIC')).list[0]!;
    await t.jobs.drain();
    t.db.prepare("UPDATE attachments SET vision_error = 'unreadable' WHERE id = ?").run(broken.id);

    // Still out of balance: only the oldest is asked.
    let asks = 0;
    t.fakes.claude.readImage = async () => {
      asks += 1;
      throw payment();
    };
    await retryWaitingReadings(t);
    await t.jobs.drain();
    expect(asks).toBe(1);

    // Topped up: the oldest lands, then the other waiting one; an unreadable photo isn't tried again.
    t.fakes.claude.readImage = async () => ({ kind: 'latex', latex: 'f(a)=f(b)=0' });
    await retryWaitingReadings(t);
    await t.jobs.drain();
    expect((await getAttachment(a.id)).visionStatus).toBe('done');
    expect((await getAttachment(b.id)).visionStatus).toBe('done');
    expect((await getAttachment(a.id)).visionError).toBeNull();
    expect((await getAttachment(broken.id)).visionStatus).toBe('failed');
  });
});

describe('a reading given by hand', () => {
  it('files LaTeX for a photo exactly as a reading would be, replacing a failed one', async () => {
    t.fakes.claude.readImage = async () => {
      throw Object.assign(new Error('402'), { status: 402 });
    };
    const { list } = await uploadImage('IMG_1950.HEIC');
    await t.jobs.drain();
    const id = list[0]!.id;

    const res = await t.req('PUT', `/api/attachments/${id}/reading`, { latex: '\\textbf{7.1} Let $a<b$.' });
    expect(res.status).toBe(200);
    const photo = (await res.json()) as Attachment;
    expect([photo.visionStatus, photo.visionError, photo.extractedText]).toEqual(['done', null, 'Handwritten work']);
    expect(childOf(id)?.filename).toBe('IMG_1950.tex');
    expect(readStored(childOf(id)!.id)).toBe(TEX_TEMPLATE('\\textbf{7.1} Let $a<b$.'));

    expect((await t.req('PUT', `/api/attachments/${id}/reading`, { latex: '  ' })).status).toBe(400);
    expect((await t.req('PUT', `/api/attachments/${childOf(id)!.id}/reading`, { latex: 'x' })).status).toBe(404);
  });
});
