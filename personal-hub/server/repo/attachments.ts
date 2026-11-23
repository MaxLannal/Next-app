import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Attachment, AttachmentKind } from '../../shared/types.ts';
import { UnavailableError, type AppContext } from '../context.ts';
import { classifyFile, isSyncable, mimeFor, safeFilename } from '../lib/files.ts';
import { indexDoc, removeDoc } from '../lib/search.ts';

const TEXT_LIMIT_BYTES = 1024 * 1024;
const PREVIEW_MAX_PIXELS = 2000;

/** Runs after each new attachment is committed. Tasks 8 and 19 push their handlers here. */
export const onAttachmentCreated: ((ctx: AppContext, a: Attachment) => void)[] = [];

export type CreateAttachmentInput = {
  sessionId: number | null;
  parentId?: number;
  filename: string;
  bytes: Buffer;
  source?: 'upload' | 'github';
  /** Where the file lives in the GitHub repo. A file that came from there starts out synced. */
  repoPath?: string;
  extractedText?: string;
};

/** `sessionIds` is several sessions in one read (the Database's thumbnail strips); an empty list matches nothing. */
export type AttachmentFilter = {
  sessionId?: number;
  sessionIds?: number[];
  unfiled?: boolean;
  source?: Attachment['source'];
};

type AttachmentRow = {
  id: number;
  session_id: number | null;
  parent_id: number | null;
  kind: AttachmentKind;
  filename: string;
  mime: string;
  size: number;
  /** Relative to the data folder: `files/YYYY/MM/<id>-<name>`. */
  path: string;
  preview_path: string | null;
  sha256: string;
  source: Attachment['source'];
  extracted_text: string;
  vision_status: Attachment['visionStatus'];
  repo_path: string | null;
  repo_state: Attachment['repoState'];
  created_at: string;
};

function toAttachment(r: AttachmentRow): Attachment {
  return {
    id: r.id,
    sessionId: r.session_id,
    parentId: r.parent_id,
    kind: r.kind,
    filename: r.filename,
    mime: r.mime,
    size: r.size,
    createdAt: r.created_at,
    source: r.source,
    extractedText: r.extracted_text,
    visionStatus: r.vision_status,
    repoPath: r.repo_path,
    repoState: r.repo_state,
    url: `/api/attachments/${r.id}/file`,
    previewUrl: r.preview_path ? `/api/attachments/${r.id}/preview` : null,
  };
}

function getRow(db: DatabaseSync, id: number): AttachmentRow | undefined {
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined;
}

function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
}

export function sessionExists(db: DatabaseSync, id: number): boolean {
  return db.prepare('SELECT 1 FROM focus_sessions WHERE id = ?').get(id) !== undefined;
}

export function getAttachment(ctx: AppContext, id: number): Attachment | null {
  const row = getRow(ctx.db, id);
  return row ? toAttachment(row) : null;
}

/** The attachment with the absolute paths of its original and its preview. */
export function attachmentFiles(
  ctx: AppContext,
  id: number,
): { attachment: Attachment; file: string; preview: string | null } | null {
  const row = getRow(ctx.db, id);
  if (!row) return null;
  return {
    attachment: toAttachment(row),
    file: join(ctx.paths.dataDir, row.path),
    preview: row.preview_path ? join(ctx.paths.dataDir, row.preview_path) : null,
  };
}

/** Oldest first. With no filter, every attachment. */
export function listAttachments(ctx: AppContext, filter: AttachmentFilter = {}): Attachment[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.sessionId !== undefined) {
    where.push('session_id = ?');
    params.push(filter.sessionId);
  }
  if (filter.sessionIds !== undefined) {
    if (filter.sessionIds.length === 0) return [];
    where.push(`session_id IN (${filter.sessionIds.map(() => '?').join(', ')})`);
    params.push(...filter.sessionIds);
  }
  if (filter.unfiled) where.push('session_id IS NULL');
  if (filter.source !== undefined) {
    where.push('source = ?');
    params.push(filter.source);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = ctx.db.prepare(`SELECT * FROM attachments ${clause} ORDER BY created_at, id`).all(...params);
  return (rows as AttachmentRow[]).map(toAttachment);
}

/**
 * Stores the file at `files/YYYY/MM/<id>-<safe name>` (hub time zone) and indexes it.
 * The bytes go to a temp file first; the row, its id-based path, the index entry and
 * the move into place happen in one transaction. HEIC/HEIF previews are made by a
 * background job. `onAttachmentCreated` handlers run after the commit.
 */
export function createAttachment(ctx: AppContext, input: CreateAttachmentInput): Attachment {
  const filename = safeFilename(input.filename);
  const kind = classifyFile(filename);
  const mime = mimeFor(filename);
  const size = input.bytes.length;
  const extractedText =
    input.extractedText ?? (isSyncable(kind) && size < TEXT_LIMIT_BYTES ? input.bytes.toString('utf8') : '');
  const now = ctx.now();
  const folder = `files/${format(new TZDate(now, ctx.timeZone()), 'yyyy/MM')}`;

  const tmp = join(ctx.paths.tmpDir, `upload-${randomUUID()}`);
  let placed: string | null = null;
  let stored: { id: number; path: string };
  try {
    writeFileSync(tmp, input.bytes);
    stored = transaction(ctx.db, () => {
      const inserted = ctx.db
        .prepare(
          `INSERT INTO attachments (session_id, parent_id, kind, filename, mime, size, path, sha256, source,
             extracted_text, repo_path, repo_state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.sessionId,
          input.parentId ?? null,
          kind,
          filename,
          mime,
          size,
          createHash('sha256').update(input.bytes).digest('hex'),
          input.source ?? 'upload',
          extractedText,
          input.repoPath ?? null,
          input.repoPath ? 'synced' : null,
          now.toISOString(),
        );
      const newId = Number(inserted.lastInsertRowid);
      const path = `${folder}/${newId}-${filename}`;
      ctx.db.prepare('UPDATE attachments SET path = ? WHERE id = ?').run(path, newId);
      indexDoc(ctx.db, 'attachment', newId, filename, extractedText);

      const dest = join(ctx.paths.dataDir, path);
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(tmp, dest);
      placed = dest;
      return { id: newId, path };
    });
  } catch (err) {
    rmSync(placed ?? tmp, { force: true });
    throw err;
  }

  const { id, path } = stored;
  if (mime === 'image/heic' || mime === 'image/heif') {
    ctx.jobs.enqueue('heic-preview', () => makePreview(ctx, id, path));
  }

  const created = getAttachment(ctx, id)!;
  for (const handler of onAttachmentCreated) {
    try {
      handler(ctx, created);
    } catch (err) {
      console.error(`onAttachmentCreated handler failed for attachment ${id}`, err);
    }
  }
  // Handlers may have changed the row (a queued sync, say), so return it as it is now.
  return getAttachment(ctx, id) ?? created;
}

// The row a preview job was queued for, still holding the same HEIC/HEIF file.
const SAME_HEIC_ROW = `id = ? AND path = ? AND mime IN ('image/heic', 'image/heif')`;

/**
 * Converts the HEIC/HEIF original at `path` to `<same>.preview.jpg`. Does nothing
 * if the row no longer holds that file. A failed conversion leaves no preview.
 */
async function makePreview(ctx: AppContext, id: number, path: string): Promise<void> {
  if (ctx.db.prepare(`SELECT 1 FROM attachments WHERE ${SAME_HEIC_ROW}`).get(id, path) === undefined) return;
  const previewPath = `${path.replace(/\.[^./]*$/, '')}.preview.jpg`;
  const dest = join(ctx.paths.dataDir, previewPath);
  try {
    await ctx.mac.convertImage(join(ctx.paths.dataDir, path), dest, PREVIEW_MAX_PIXELS);
  } catch (err) {
    rmSync(dest, { force: true });
    if (err instanceof UnavailableError) return; // the Mac helpers aren't set up: no preview
    throw err; // the job queue logs it
  }
  const { changes } = ctx.db
    .prepare(`UPDATE attachments SET preview_path = ? WHERE ${SAME_HEIC_ROW}`)
    .run(previewPath, id, path);
  if (Number(changes) === 0) rmSync(dest, { force: true }); // deleted or replaced while converting
}

/** Changes the text (and re-indexes it) or the session. Derived files move with their parent. */
export function updateAttachment(
  ctx: AppContext,
  id: number,
  patch: { extractedText?: string; sessionId?: number | null },
): Attachment | null {
  const row = getRow(ctx.db, id);
  if (!row) return null;
  transaction(ctx.db, () => {
    if (patch.extractedText !== undefined) {
      ctx.db.prepare('UPDATE attachments SET extracted_text = ? WHERE id = ?').run(patch.extractedText, id);
      indexDoc(ctx.db, 'attachment', id, row.filename, patch.extractedText);
    }
    if (patch.sessionId !== undefined) {
      ctx.db
        .prepare('UPDATE attachments SET session_id = ? WHERE id = ? OR parent_id = ?')
        .run(patch.sessionId, id, id);
    }
  });
  return getAttachment(ctx, id);
}

/**
 * Changes the text and rewrites the stored file from it (`render`) before the row
 * and the index, so the file and the indexed text never describe different things:
 * if the write fails, nothing changed.
 */
export function replaceAttachmentText(
  ctx: AppContext,
  id: number,
  render: (text: string) => Buffer,
  makeText: (previous: string) => string = (previous) => previous,
): Attachment | null {
  const found = attachmentFiles(ctx, id);
  if (!found) return null;
  const text = makeText(found.attachment.extractedText);
  writeFileSync(found.file, render(text));
  return updateAttachment(ctx, id, { extractedText: text });
}

/** Deletes the attachment and its derived files: rows, index entries, originals and previews. */
export function deleteAttachment(ctx: AppContext, id: number): boolean {
  const rows = ctx.db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM attachments WHERE id = ?
         UNION ALL
         SELECT a.id FROM attachments a JOIN tree ON a.parent_id = tree.id
       )
       SELECT a.id, a.path, a.preview_path FROM attachments a JOIN tree USING (id)`,
    )
    .all(id) as Pick<AttachmentRow, 'id' | 'path' | 'preview_path'>[];
  if (rows.length === 0) return false;

  transaction(ctx.db, () => {
    for (const r of rows) removeDoc(ctx.db, 'attachment', r.id);
    ctx.db.prepare('DELETE FROM attachments WHERE id = ?').run(id); // children cascade
  });
  for (const r of rows) {
    for (const path of [r.path, r.preview_path]) {
      if (path) rmSync(join(ctx.paths.dataDir, path), { force: true });
    }
  }
  return true;
}
