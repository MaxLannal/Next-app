import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { FocusSession, SearchHit, SessionEvent, SessionFilters, Subject } from '../../shared/types.ts';
import { search } from '../lib/search.ts';
import { addDays, clip, dayKey, dayStart, focusIntervals, focusSeconds, splitByDay } from '../lib/time.ts';

type SessionRow = {
  id: number;
  name: string;
  subject_id: number | null;
  goal_id: number | null;
  notes: string;
  status: FocusSession['status'];
  started_at: string;
  ended_at: string | null;
  auto_paused_at: string | null;
  focus_seconds: number;
};

type SubjectRow = { id: number; name: string };

const NO_SUBJECT = 'No subject';

/** Runs `fn` in a transaction. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
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

/** The subject with that name, ignoring case and surrounding spaces, created if missing. */
export function upsertSubject(db: DatabaseSync, name: string): Subject {
  const trimmed = name.trim();
  const found = db.prepare('SELECT id, name FROM subjects WHERE name = ?').get(trimmed) as SubjectRow | undefined;
  if (found) return { id: found.id, name: found.name };
  const { lastInsertRowid } = db
    .prepare('INSERT INTO subjects (name, created_at) VALUES (?, ?)')
    .run(trimmed, new Date().toISOString());
  return { id: Number(lastInsertRowid), name: trimmed };
}

export function listSubjects(db: DatabaseSync): Subject[] {
  return db.prepare('SELECT id, name FROM subjects ORDER BY name COLLATE NOCASE').all() as Subject[];
}

export function listTags(db: DatabaseSync): string[] {
  return (db.prepare('SELECT name FROM tags ORDER BY name COLLATE NOCASE').all() as { name: string }[]).map((r) => r.name);
}

/** Replaces the session's tags with `names`; each is created if missing. */
export function setTags(db: DatabaseSync, sessionId: number, names: string[]): void {
  const wanted = [...new Set(names.map((n) => n.trim()).filter((n) => n !== ''))];
  db.prepare('DELETE FROM session_tags WHERE session_id = ?').run(sessionId);
  for (const name of wanted) {
    const found = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number } | undefined;
    const tagId = found?.id ?? Number(db.prepare('INSERT INTO tags (name) VALUES (?)').run(name).lastInsertRowid);
    db.prepare('INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)').run(sessionId, tagId);
  }
}

export function getEvents(db: DatabaseSync, sessionId: number): SessionEvent[] {
  return db
    .prepare('SELECT type, at FROM session_events WHERE session_id = ? ORDER BY at, id')
    .all(sessionId) as SessionEvent[];
}

export function appendEvent(db: DatabaseSync, sessionId: number, type: SessionEvent['type'], at: Date): void {
  db.prepare('INSERT INTO session_events (session_id, type, at) VALUES (?, ?, ?)').run(sessionId, type, at.toISOString());
}

/** The one session that is running or paused, if any. */
export function openSession(db: DatabaseSync): SessionRow | undefined {
  return db
    .prepare("SELECT * FROM focus_sessions WHERE status IN ('running', 'paused') ORDER BY id DESC LIMIT 1")
    .get() as SessionRow | undefined;
}

/** Recomputes `focus_seconds` from the events; an open session counts up to `now`. */
export function recomputeFocus(db: DatabaseSync, sessionId: number, now: Date): void {
  const seconds = focusSeconds(getEvents(db, sessionId), now);
  db.prepare('UPDATE focus_sessions SET focus_seconds = ? WHERE id = ?').run(seconds, sessionId);
}

function tagsOf(db: DatabaseSync, sessionId: number): string[] {
  return (
    db
      .prepare(
        'SELECT t.name FROM session_tags st JOIN tags t ON t.id = st.tag_id WHERE st.session_id = ? ORDER BY t.name COLLATE NOCASE',
      )
      .all(sessionId) as { name: string }[]
  ).map((r) => r.name);
}

export function getSession(db: DatabaseSync, id: number, now: Date): FocusSession | null {
  const row = db
    .prepare(
      `SELECT s.*, sub.id AS sub_id, sub.name AS sub_name,
         (SELECT COUNT(*) FROM attachments a WHERE a.session_id = s.id) AS attachment_count
       FROM focus_sessions s LEFT JOIN subjects sub ON sub.id = s.subject_id
       WHERE s.id = ?`,
    )
    .get(id) as (SessionRow & { sub_id: number | null; sub_name: string | null; attachment_count: number }) | undefined;
  if (!row) return null;
  const events = getEvents(db, id);
  return {
    id: row.id,
    name: row.name,
    subject: row.sub_id === null ? null : { id: row.sub_id, name: row.sub_name ?? '' },
    tags: tagsOf(db, id),
    goalId: row.goal_id,
    notes: row.notes,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    focusSeconds: row.status === 'done' ? row.focus_seconds : focusSeconds(events, now),
    autoPausedAt: row.auto_paused_at,
    attachmentCount: row.attachment_count,
    events,
  };
}

/**
 * Newest first, by start. The day bounds are `[fromDay, toDayExclusive)` over the session's
 * start in the hub time zone (`tz` defaults to UTC).
 *
 * `kind` keeps sessions holding a file of that type; `source` keeps those holding one from
 * that place. `q` runs the full-text search and keeps the sessions its hits name: a session
 * hit, the session holding an attachment hit, or the sessions on a day an essay hit falls on
 * (an essay has no session, so the sessions around it stand for it).
 */
export function listSessions(db: DatabaseSync, f: SessionFilters, now: Date, tz = 'UTC'): FocusSession[] {
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  if (f.from !== undefined) {
    where.push('started_at >= ?');
    params.push(dayStart(f.from, tz).toISOString());
  }
  if (f.to !== undefined) {
    where.push('started_at < ?');
    params.push(dayStart(f.to, tz).toISOString());
  }
  if (f.subjectId !== undefined) {
    where.push('subject_id = ?');
    params.push(f.subjectId);
  }
  if (f.goalId !== undefined) {
    where.push('goal_id = ?');
    params.push(f.goalId);
  }
  if (f.tag !== undefined) {
    where.push(
      'id IN (SELECT st.session_id FROM session_tags st JOIN tags t ON t.id = st.tag_id WHERE t.name = ? COLLATE NOCASE)',
    );
    params.push(f.tag);
  }
  if (f.kind !== undefined) {
    where.push('id IN (SELECT session_id FROM attachments WHERE kind = ?)');
    params.push(f.kind);
  }
  if (f.source !== undefined) {
    where.push('id IN (SELECT session_id FROM attachments WHERE source = ?)');
    params.push(f.source);
  }
  if (f.q !== undefined && f.q.trim() !== '') {
    const hits = sessionsForHits(db, search(db, f.q, SEARCH_LIMIT), tz, f.from, f.to);
    where.push(hits.sql);
    params.push(...hits.params);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  let sql = `SELECT id FROM focus_sessions ${clause} ORDER BY started_at DESC, id DESC`;
  if (f.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(f.limit);
  }
  const ids = (db.prepare(sql).all(...params) as { id: number }[]).map((r) => r.id);
  const out = ids.map((id) => getSession(db, id, now)).filter((s): s is FocusSession => s !== null);
  if (f.sort === 'subject') out.sort((a, b) => (a.subject?.name ?? '').localeCompare(b.subject?.name ?? '') || b.id - a.id);
  if (f.sort === 'duration') out.sort((a, b) => b.focusSeconds - a.focusSeconds || b.id - a.id);
  return out;
}

/** How many search hits one `q` considers. Past this, the rarest matches may fall away. */
const SEARCH_LIMIT = 300;

type QWhere = { sql: string; params: SQLInputValue[] };

/** Two SQL placeholders for the bound of one local day, in `[started_at, next day)`. */
const DAY_BOUND = '(started_at >= ? AND started_at < ?)';
/** Essay hits are capped so their day bounds stay well under SQLite's variable limit. */
const MAX_ESSAY_DAYS = 60;

/**
 * The `q` condition for `listSessions`: the sessions the search hits name, as SQL and
 * its params. A session hit is that session; an attachment hit is the session holding
 * it (a derived file counts for its parent). An essay has no session, so an essay hit
 * stands for the sessions on the session-day it falls on, each day clipped to `[from, to)`.
 * No hits gives `0`, never a match-all.
 */
function sessionsForHits(db: DatabaseSync, hits: SearchHit[], tz: string, from?: string, to?: string): QWhere {
  const sessions = new Set<number>();
  const attachments = new Set<number>();
  const days = new Set<string>();
  for (const hit of hits.filter((h) => h.kind === 'session')) sessions.add(hit.refId);
  for (const hit of hits.filter((h) => h.kind === 'attachment')) attachments.add(hit.refId);
  for (const hit of hits.filter((h) => h.kind === 'essay')) {
    const day = essayDay(db, hit.refId, tz);
    if (day !== null) days.add(day);
  }

  const parts: string[] = ['0'];
  const params: SQLInputValue[] = [];
  if (sessions.size > 0) {
    parts.push(`id IN (VALUES ${[...sessions].map(() => '(?)').join(', ')})`);
    params.push(...sessions);
  }
  if (attachments.size > 0) {
    const marks = [...attachments].map(() => '?').join(', ');
    params.push(...attachments, ...attachments);
    parts.push(`id IN (SELECT session_id FROM attachments WHERE id IN (${marks}) OR parent_id IN (${marks}))`);
  }
  const essayDays = [...days].filter((d) => (from === undefined || d >= from) && (to === undefined || d < to));
  if (essayDays.length > 0) {
    parts.push(essayDays.slice(0, MAX_ESSAY_DAYS).map(() => DAY_BOUND).join(' OR '));
    for (const day of essayDays.slice(0, MAX_ESSAY_DAYS)) {
      params.push(dayStart(day, tz).toISOString(), dayStart(addDays(day, 1), tz).toISOString());
    }
  }
  return { sql: `(${parts.join(' OR ')})`, params };
}

/** The local day an essay was created, in the hub's time zone. */
function essayDay(db: DatabaseSync, essayId: number, tz: string): string | null {
  const row = db.prepare('SELECT created_at FROM essays WHERE id = ?').get(essayId) as { created_at: string } | undefined;
  return row ? dayKey(new Date(row.created_at), tz) : null;
}

/**
 * Focus seconds per local day for `[fromDay, toDayExclusive)`, each day mapping
 * `subjectId | null` to the subject's name and seconds. Only days with focus are keys.
 */
export function focusByDay(
  db: DatabaseSync,
  fromDay: string,
  toDayExclusive: string,
  tz: string,
  now: Date,
): Map<string, Map<number | null, { name: string; seconds: number }>> {
  const rows = db
    .prepare(
      `SELECT s.id, s.subject_id, sub.name AS subject_name
       FROM focus_sessions s LEFT JOIN subjects sub ON sub.id = s.subject_id
       WHERE s.ended_at IS NULL OR s.ended_at > ?`,
    )
    .all(`${fromDay}T00:00:00.000Z`) as { id: number; subject_id: number | null; subject_name: string | null }[];

  const out = new Map<string, Map<number | null, { name: string; seconds: number }>>();
  for (const row of rows) {
    const subjectId = row.subject_id ?? null;
    const name = row.subject_name ?? NO_SUBJECT;
    for (const [day, seconds] of splitByDay(focusIntervals(getEvents(db, row.id), now), tz)) {
      if (day < fromDay || day >= toDayExclusive) continue;
      let byDay = out.get(day);
      if (!byDay) out.set(day, (byDay = new Map()));
      byDay.set(subjectId, { name, seconds: (byDay.get(subjectId)?.seconds ?? 0) + seconds });
    }
  }
  return out;
}

/** Focus seconds from sessions on `goalId` that started on or after `sinceDay`, when given. */
export function goalFocusSeconds(db: DatabaseSync, goalId: number, tz: string, now: Date, sinceDay?: string): number {
  const since = sinceDay === undefined ? null : dayStart(sinceDay, tz).getTime();
  const rows = db.prepare('SELECT id FROM focus_sessions WHERE goal_id = ?').all(goalId) as { id: number }[];
  let total = 0;
  for (const row of rows) {
    const intervals = focusIntervals(getEvents(db, row.id), now);
    const kept = since === null ? intervals : clip(intervals, new Date(since), now);
    total += kept.reduce((sum, i) => sum + Math.round((i.end.getTime() - i.start.getTime()) / 1000), 0);
  }
  return total;
}
