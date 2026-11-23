import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from '../context.ts';
import {
  attachmentFiles,
  createAttachment,
  deleteAttachment,
  getAttachment,
  onAttachmentCreated,
  updateAttachment,
} from '../repo/attachments.ts';

/** Photos are sent at most this big; the original is kept. */
export const VISION_MAX_PIXELS = 2000;

/** A `.tex` file that compiles, holding only the reading as body content. */
export const TEX_TEMPLATE = (latex: string) =>
  `\\documentclass{article}\n\\usepackage{amsmath,amssymb}\n\\begin{document}\n${latex}\n\\end{document}\n`;

const HANDWRITTEN = 'Handwritten work';

const hold = (ctx: AppContext, id: number, status: 'pending' | 'done' | 'failed') =>
  ctx.db.prepare('UPDATE attachments SET vision_status = ? WHERE id = ?').run(status, id);

/**
 * Reads one uploaded photo: converts it to a JPEG of at most 2000 px, asks
 * Claude, and files the answer. A LaTeX reading becomes a child `.tex` file
 * (`<name>.tex`, same session); the photo's own text gets the caption. The photo
 * is marked done, or failed with the upload left as it was.
 */
export async function processImage(ctx: AppContext, attachmentId: number): Promise<void> {
  const found = attachmentFiles(ctx, attachmentId);
  if (!found || found.attachment.kind !== 'image' || found.attachment.parentId !== null) return;
  const photo = found.attachment;
  hold(ctx, photo.id, 'pending');

  const jpeg = join(ctx.paths.tmpDir, `vision-${randomUUID()}.jpg`);
  try {
    await ctx.mac.convertImage(found.file, jpeg, VISION_MAX_PIXELS);
    const reading = await ctx.claude.readImage({ data: readFileSync(jpeg), mediaType: 'image/jpeg' });

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
      caption = HANDWRITTEN;
    } else {
      caption = reading.caption;
    }
    updateAttachment(ctx, photo.id, { extractedText: caption }); // re-indexes the photo
    hold(ctx, photo.id, 'done');
  } catch (err) {
    hold(ctx, photo.id, 'failed');
    throw err; // the job queue logs it
  } finally {
    rmSync(jpeg, { force: true });
  }
}

/** Every new top-level photo is read in the background. Call once at startup. */
export function registerVision(): void {
  onAttachmentCreated.push((inner, a) => {
    if (a.kind === 'image' && a.parentId === null) inner.jobs.enqueue('vision', () => processImage(inner, a.id));
  });
}

/** A LaTeX child (`<photo>.tex`) whose text was edited gets its file rewritten from the template. */
export function rewriteLatexFile(ctx: AppContext, attachmentId: number): void {
  const found = attachmentFiles(ctx, attachmentId);
  if (!found || found.attachment.kind !== 'latex' || found.attachment.parentId === null) return;
  writeFileSync(found.file, TEX_TEMPLATE(found.attachment.extractedText));
}
