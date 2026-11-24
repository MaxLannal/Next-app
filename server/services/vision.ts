import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Attachment, ImageReading, VisionError } from '../../shared/types.ts';
import { UnavailableError, type AppContext } from '../context.ts';
import { MODEL_MISSING } from './claude.ts';
import {
  attachmentFiles,
  createAttachment,
  deleteAttachment,
  getAttachment,
  onAttachmentCreated,
  replaceAttachmentText,
  updateAttachment,
} from '../repo/attachments.ts';

/** Photos are sent at most this big; the original is kept. */
export const VISION_MAX_PIXELS = 2000;
/** A PDF is read when it's a scan of a few pages, not a book: at most this many pages and bytes. */
export const PDF_MAX_PAGES = 10;
export const PDF_MAX_BYTES = 24 * 1024 * 1024;

/** What gets read for the math in it: photos (any format the Mac converts, HEIC included) and PDFs. */
export const readable = (kind: Attachment['kind']) => kind === 'image' || kind === 'pdf';

/** Failures that pass by themselves (the gateway topped up, or back): the hub tries those again. */
const PASSING: VisionError[] = ['balance', 'unreachable'];

/** Why a reading failed, from what the gateway (or the Mac) answered. */
export function whyFailed(err: unknown): VisionError {
  const status = typeof (err as { status?: unknown } | null)?.status === 'number' ? (err as { status: number }).status : null;
  if (status === 402) return 'balance';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'model';
  if (status !== null && (status === 408 || status === 409 || status === 429 || status >= 500)) return 'unreachable';
  if (err instanceof UnavailableError) {
    if (err.message === MODEL_MISSING) return 'model';
    return /sips/i.test(err.message) ? 'unreadable' : 'setup';
  }
  const name = (err as { name?: unknown } | null)?.name;
  const code = (err as { code?: unknown; cause?: { code?: unknown } } | null)?.code ?? (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError' || name === 'AbortError') return 'unreachable';
  if (typeof code === 'string' && /^(ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|UND_ERR)/.test(code)) return 'unreachable';
  return 'unreadable';
}

/** Pages in a PDF, counted from its page objects; 0 when they're packed where this can't see. */
export function pdfPages(bytes: Buffer): number {
  return (bytes.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

/** A `.tex` file that compiles, holding only the reading as body content. */
export const TEX_TEMPLATE = (latex: string): string =>
  `\\documentclass{article}\n\\usepackage{amsmath,amssymb}\n\\begin{document}\n${latex}\n\\end{document}\n`;

const HANDWRITTEN = 'Handwritten work';

const hold = (ctx: AppContext, id: number, status: 'pending' | 'done' | 'failed', error: VisionError | null = null) =>
  ctx.db.prepare('UPDATE attachments SET vision_status = ?, vision_error = ? WHERE id = ?').run(status, error, id);

/** A photo, as an upright JPEG of at most 2000 px (an iPhone's HEIC included). */
async function readPhoto(ctx: AppContext, file: string, jpeg: string): Promise<ImageReading> {
  await ctx.mac.convertImage(file, jpeg, VISION_MAX_PIXELS);
  return ctx.claude.readImage({ data: readFileSync(jpeg), mediaType: 'image/jpeg' });
}

/** A scanned PDF, whole; if the gateway won't take a PDF, its first page as a photo. */
async function readPdf(ctx: AppContext, file: string, jpeg: string): Promise<ImageReading> {
  try {
    return await ctx.claude.readImage({ data: readFileSync(file), mediaType: 'application/pdf' });
  } catch (err) {
    if ((err as { status?: unknown } | null)?.status !== 400) throw err;
    return readPhoto(ctx, file, jpeg);
  }
}

/**
 * Reads one uploaded photo or scanned PDF: asks Claude for the math in it and files the answer.
 * A LaTeX reading becomes a child `.tex` file (`<name>.tex`, same session); the upload's own text
 * gets the caption. It is marked done, or failed with why (the upload left as it was). A PDF longer
 * than a few pages isn't read at all.
 */
export async function processImage(ctx: AppContext, attachmentId: number): Promise<void> {
  const found = attachmentFiles(ctx, attachmentId);
  if (!found || !readable(found.attachment.kind) || found.attachment.parentId !== null) return;
  const photo = found.attachment;
  if (photo.kind === 'pdf') {
    const bytes = readFileSync(found.file);
    if (bytes.length > PDF_MAX_BYTES || pdfPages(bytes) > PDF_MAX_PAGES) return;
  }
  hold(ctx, photo.id, 'pending');

  const jpeg = join(ctx.paths.tmpDir, `vision-${randomUUID()}.jpg`);
  try {
    const reading = photo.kind === 'pdf' ? await readPdf(ctx, found.file, jpeg) : await readPhoto(ctx, found.file, jpeg);

    if (!getAttachment(ctx, photo.id)) return; // deleted while reading
    // A re-run replaces the earlier answer; nothing else is ever derived from a photo.
    const children = ctx.db.prepare('SELECT id FROM attachments WHERE parent_id = ?').all(photo.id) as { id: number }[];
    for (const child of children) deleteAttachment(ctx, child.id);
    let caption: string;
    if (reading.kind === 'latex') {
      const latex = reading.latex.trim();
      // "hw page.jpg" → "hw page.tex"
      const filename = `${photo.filename.replace(/\.[^.]*$/, '')}.tex`;
      createAttachment(ctx, { sessionId: photo.sessionId, parentId: photo.id, filename, bytes: Buffer.from(TEX_TEMPLATE(latex)), extractedText: latex });
      // ImageReading's latex variant has no caption (Task 1), so the photo says what it is.
      caption = HANDWRITTEN;
    } else {
      caption = reading.caption;
    }
    updateAttachment(ctx, photo.id, { extractedText: caption }); // re-indexes the photo
    hold(ctx, photo.id, 'done');
  } catch (err) {
    if (getAttachment(ctx, photo.id)) hold(ctx, photo.id, 'failed', whyFailed(err));
    throw err; // the job queue logs it
  } finally {
    rmSync(jpeg, { force: true });
  }
}

/**
 * Readings that failed for a reason that passes by itself (the gateway out of balance, or out of
 * reach) are tried again: the oldest first, and the rest once that one lands, so a gateway still
 * down is asked once, not once per photo. At startup, readings a restart left half-done go too.
 */
export async function retryWaitingReadings(ctx: AppContext, { leftover = false }: { leftover?: boolean } = {}): Promise<void> {
  const passing = PASSING.map((e) => `'${e}'`).join(', ');
  const rows = ctx.db
    .prepare(
      `SELECT id FROM attachments WHERE parent_id IS NULL AND kind IN ('image', 'pdf')
         AND ((vision_status = 'failed' AND vision_error IN (${passing}))${leftover ? " OR vision_status = 'pending'" : ''})
       ORDER BY id`,
    )
    .all() as { id: number }[];
  const [first, ...rest] = rows;
  if (!first) return;
  await processImage(ctx, first.id).catch(() => {});
  if (getAttachment(ctx, first.id)?.visionStatus !== 'done') return;
  for (const r of rest) ctx.jobs.enqueue('vision', () => processImage(ctx, r.id));
}

/**
 * Every new top-level photo or PDF is read in the background. Call once at startup.
 * One is enqueued once even if this is registered twice; the returned
 * function removes the handler again (tests).
 */
export function registerVision(): () => void {
  let seen: WeakSet<Attachment> | null = null;
  const handler = (inner: AppContext, a: Attachment) => {
    if (!readable(a.kind) || a.parentId !== null) return;
    seen ??= new WeakSet();
    if (seen.has(a)) return;
    seen.add(a);
    inner.jobs.enqueue('vision', () => processImage(inner, a.id));
  };
  onAttachmentCreated.push(handler);
  return () => {
    const at = onAttachmentCreated.indexOf(handler);
    if (at !== -1) onAttachmentCreated.splice(at, 1);
  };
}

/**
 * A LaTeX child (`<photo>.tex`) with new text: the file is rewritten from the
 * template first, then the row and its index — a failed write changes neither.
 */
export function rewriteLatexFile(ctx: AppContext, attachmentId: number, extractedText: string): Attachment | null {
  const found = attachmentFiles(ctx, attachmentId);
  if (found && (found.attachment.kind !== 'latex' || found.attachment.parentId === null)) return null;
  return replaceAttachmentText(ctx, attachmentId, (text) => Buffer.from(TEX_TEMPLATE(text)), () => extractedText);
}

/** Is this a derived LaTeX file, the kind whose text can be edited in place? */
export function isDerivedLatex(ctx: AppContext, attachmentId: number): boolean {
  const found = attachmentFiles(ctx, attachmentId);
  return found !== null && found.attachment.kind === 'latex' && found.attachment.parentId !== null;
}
