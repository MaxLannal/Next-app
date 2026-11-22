import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDb } from './index.ts';

const TABLES = [
  'subjects',
  'tags',
  'goals',
  'goal_plan_history',
  'focus_sessions',
  'session_events',
  'session_tags',
  'attachments',
  'essays',
  'essay_snapshots',
  'resources',
  'sleep_samples',
  'exercise_log',
  'chat_conversations',
  'chat_messages',
  'settings',
  'search_index',
];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-db-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

it('migrates a fresh file', () => {
  const db = openDb(join(dir, 'hub.db'));
  try {
    const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(user_version).toBe(1);
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    expect(TABLES).toHaveLength(17);
    expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(TABLES));
  } finally {
    db.close();
  }
});

it('reopen is idempotent', () => {
  const file = join(dir, 'hub.db');
  const first = openDb(file);
  first.prepare('INSERT INTO subjects (name, created_at) VALUES (?, ?)').run('Algebra', '2026-11-22T18:00:00.000Z');
  first.close();

  const second = openDb(file);
  try {
    const { user_version } = second.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(user_version).toBe(1);
    const { n } = second.prepare('SELECT count(*) AS n FROM subjects').get() as { n: number };
    expect(n).toBe(1);
  } finally {
    second.close();
  }
});

it('turns on WAL and foreign keys', () => {
  const db = openDb(join(dir, 'hub.db'));
  try {
    const { journal_mode } = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    const { foreign_keys } = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(journal_mode).toBe('wal');
    expect(foreign_keys).toBe(1);
  } finally {
    db.close();
  }
});
