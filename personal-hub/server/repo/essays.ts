import type { DatabaseSync } from 'node:sqlite';
import type { Essay, EssayColumn, EssaySummary } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import { indexDoc, removeDoc } from '../lib/search.ts';

export const ESSAY_COLUMNS: readonly EssayColumn[] = ['meditations', 'plans', 'insights'];

export const SNAPSHOT_INTERVAL_MS = 5 * 60_000;
export const KEPT_SNAPSHOTS = 30;

export const EMPTY_DOC = '{"type":"doc","content":[]}';

export type EssaySnapshot = { id: number; createdAt: string };

type EssayRow = {
  id: number;
  column_key: EssayColumn;
  title: string;
  content_json: string;
  plain_text: string;
  word_count: number;
  created_at: string;
  updated_at: string;
};

/** What a save carries. `column` alone moves the essay, leaving its text as it is. */
export type EssaySave = {
  title?: string;
  contentJson?: unknown;
  plainText?: string;
  wordCount?: number;
  column?: EssayColumn;
  baseUpdatedAt: string;
};

/** A save against an out-of-date base: someone else (or another tab) saved first. */
export class StaleSaveError extends Error {
  readonly current: Essay;
  constructor(current: Essay) {
    super('Changed elsewhere');
    this.name = 'StaleSaveError';
    this.current = current;
  }
}

function firstLine(plainText: string): string {
  const line = plainText.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  return line.trim();
}

function toSummary(r: EssayRow): EssaySummary {
  return {
    id: r.id,
    column: r.column_key,
    title: r.title,
    firstLine: firstLine(r.plain_text),
    wordCount: r.word_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toEssay(r: EssayRow): Essay {
  return { ...toSummary(r), contentJson: JSON.parse(r.content_json) as unknown };
}

function getRow(db: DatabaseSync, id: number): EssayRow | undefined {
  return db.prepare('SELECT * FROM essays WHERE id = ?').get(id) as EssayRow | undefined;
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

const indexEssay = (db: DatabaseSync, id: number, title: string, plainText: string) =>
  indexDoc(db, 'essay', id, title, plainText);

export function getEssay(ctx: AppContext, id: number): Essay | null {
  const row = getRow(ctx.db, id);
  return row ? toEssay(row) : null;
}

/** Every essay as a summary, newest change first. */
export function listEssays(ctx: AppContext): EssaySummary[] {
  const rows = ctx.db.prepare('SELECT * FROM essays ORDER BY updated_at DESC, id DESC').all() as EssayRow[];
  return rows.map(toSummary);
}

export function createEssay(ctx: AppContext, column: EssayColumn): Essay {
  const now = ctx.now().toISOString();
  const inserted = ctx.db
    .prepare(
      `INSERT INTO essays (column_key, title, content_json, plain_text, word_count, created_at, updated_at)
       VALUES (?, '', ?, '', 0, ?, ?)`,
    )
    .run(column, EMPTY_DOC, now, now);
  return getEssay(ctx, Number(inserted.lastInsertRowid)) as Essay;
}

/** Snapshots taken at one instant are one visit to the editor, so this is "a saved version older than…". */
function newestSnapshotAt(db: DatabaseSync, essayId: number): string | null {
  const row = db.prepare('SELECT max(created_at) AS at FROM essay_snapshots WHERE essay_id = ?').get(essayId) as {
    at: string | null;
  };
  return row.at;
}

/** Stores the essay's current content as a snapshot, then drops all but the newest 30. */
function snapshot(db: DatabaseSync, row: EssayRow, at: string): void {
  db.prepare('INSERT INTO essay_snapshots (essay_id, content_json, created_at) VALUES (?, ?, ?)').run(
    row.id,
    row.content_json,
    at,
  );
  db.prepare(
    `DELETE FROM essay_snapshots WHERE essay_id = ? AND id NOT IN
       (SELECT id FROM essay_snapshots WHERE essay_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)`,
  ).run(row.id, row.id, KEPT_SNAPSHOTS);
}

/**
 * Snapshots the stored content when it is non-empty and the newest snapshot is
 * none or older than five minutes, so a burst of typing leaves one version.
 */
function snapshotBeforeChange(db: DatabaseSync, row: EssayRow, now: string): void {
  if (row.content_json === EMPTY_DOC) return;
  const newest = newestSnapshotAt(db, row.id);
  if (newest !== null && Date.parse(now) - Date.parse(newest) < SNAPSHOT_INTERVAL_MS) return;
  snapshot(db, row, now);
}

/**
 * Applies a save to the essay if `baseUpdatedAt` is its current `updated_at`,
 * re-indexes search, and returns the new `updatedAt`. Throws StaleSaveError
 * when the essay changed since the base was read.
 */
export function saveEssay(ctx: AppContext, id: number, save: EssaySave): string {
  const now = ctx.now().toISOString();
  return transaction(ctx.db, () => {
    const row = getRow(ctx.db, id);
    if (!row) throw new Error('No such essay');
    if (row.updated_at !== save.baseUpdatedAt) throw new StaleSaveError(toEssay(row));

    snapshotBeforeChange(ctx.db, row, now);
    const title = save.title ?? row.title;
    const contentJson = save.contentJson === undefined ? row.content_json : (JSON.stringify(save.contentJson) as string);
    const plainText = save.plainText ?? row.plain_text;
    const wordCount = save.wordCount ?? row.word_count;
    const column = save.column ?? row.column_key;

    ctx.db
      .prepare(
        `UPDATE essays SET column_key = ?, title = ?, content_json = ?, plain_text = ?, word_count = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(column, title, contentJson, plainText, wordCount, now, id);
    indexEssay(ctx.db, id, title, plainText);
    return now;
  });
}

/** Snapshots, newest first. */
export function listSnapshots(ctx: AppContext, essayId: number): EssaySnapshot[] {
  const rows = ctx.db
    .prepare('SELECT id, created_at AS createdAt FROM essay_snapshots WHERE essay_id = ? ORDER BY created_at DESC, id DESC')
    .all(essayId) as EssaySnapshot[];
  return rows;
}

/**
 * Puts the snapshot's content back, keeping the essay's title and column.
 * The content it replaces is snapshotted first, so a restore can be undone.
 */
export function restoreSnapshot(ctx: AppContext, essayId: number, snapshotId: number): Essay {
  const now = ctx.now().toISOString();
  return transaction(ctx.db, () => {
    const row = getRow(ctx.db, essayId);
    if (!row) throw new Error('No such essay');
    const found = ctx.db
      .prepare('SELECT content_json FROM essay_snapshots WHERE id = ? AND essay_id = ?')
      .get(snapshotId, essayId) as { content_json: string } | undefined;
    if (!found) throw new Error('No such snapshot');

    snapshotBeforeChange(ctx.db, row, now);
    // The document keeps its text; wordCount and the first line follow it, as the web app sends them.
    const plainText = wordsOf(found.content_json);
    const wordCount = plainText === '' ? 0 : plainText.split(/\s+/).length;
    ctx.db
      .prepare('UPDATE essays SET content_json = ?, plain_text = ?, word_count = ?, updated_at = ? WHERE id = ?')
      .run(found.content_json, plainText, wordCount, now, essayId);
    indexEssay(ctx.db, essayId, row.title, plainText);
    return getEssay(ctx, essayId) as Essay;
  });
}

/** The text of every `text` node in a stored document, in order, one space between blocks. */
function wordsOf(contentJson: string): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return;
    const { type, text, content } = node as { type?: unknown; text?: unknown; content?: unknown };
    if (type === 'text' && typeof text === 'string') out.push(text);
    if (Array.isArray(content)) content.forEach(walk);
  };
  try {
    walk(JSON.parse(contentJson));
  } catch {
    return '';
  }
  return out.join(' ').trim();
}

/** Deletes the essay, its snapshots (cascade) and its search entry. */
export function deleteEssay(ctx: AppContext, id: number): boolean {
  return transaction(ctx.db, () => {
    const { changes } = ctx.db.prepare('DELETE FROM essays WHERE id = ?').run(id);
    if (Number(changes) === 0) return false;
    removeDoc(ctx.db, 'essay', id);
    return true;
  });
}
