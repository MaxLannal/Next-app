import type { DatabaseSync } from 'node:sqlite';
import type { SearchHit, SearchKind } from '../../shared/types.ts';

/** Indexes one record for full-text search, replacing any earlier row for it. */
export function indexDoc(db: DatabaseSync, kind: SearchKind, refId: number, title: string, body: string): void {
  removeDoc(db, kind, refId);
  // FTS5 columns have no type affinity, so the cast keeps ref_id an integer for joins.
  db.prepare('INSERT INTO search_index (kind, ref_id, title, body) VALUES (?, CAST(? AS INTEGER), ?, ?)').run(
    kind,
    refId,
    title,
    body,
  );
}

export function removeDoc(db: DatabaseSync, kind: SearchKind, refId: number): void {
  db.prepare('DELETE FROM search_index WHERE kind = ? AND ref_id = ?').run(kind, refId);
}

/**
 * Every whitespace-separated token must match as a word prefix. Each token is
 * quoted, so FTS5 operators and punctuation (`C++`, `"`, `-draft`, `AND`) are
 * plain text and can never be a syntax error. Control characters become spaces:
 * FTS5 ends a quoted string at NUL. Title matches rank above body matches.
 */
export function search(db: DatabaseSync, q: string, limit = 30): SearchHit[] {
  const terms = q
    .replace(/\p{Cc}/gu, ' ')
    .split(/\s+/)
    .filter((token) => token !== '')
    .map((token) => `"${token.replaceAll('"', '""')}"*`);
  if (terms.length === 0) return [];

  return db
    .prepare(
      `SELECT kind, ref_id AS refId, title, snippet(search_index, -1, '', '', '…', 12) AS snippet
       FROM search_index
       WHERE search_index MATCH ?
       ORDER BY bm25(search_index, 0, 0, 4, 1)
       LIMIT ?`,
    )
    .all(terms.join(' '), limit) as SearchHit[];
}
