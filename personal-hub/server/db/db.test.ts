import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, SCHEMA_VERSION } from './index.ts';

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
    expect(user_version).toBe(SCHEMA_VERSION);
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
    expect(user_version).toBe(SCHEMA_VERSION);
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

it('never reuses an attachment id', () => {
  const db = openDb(join(dir, 'hub.db'));
  try {
    const insert = db.prepare(
      `INSERT INTO attachments (kind, filename, mime, size, path, sha256, created_at)
       VALUES ('other', 'a', 'application/octet-stream', 0, 'p', 's', '2026-11-22T18:00:00.000Z')`,
    );
    const first = Number(insert.run().lastInsertRowid);
    db.prepare('DELETE FROM attachments WHERE id = ?').run(first);
    const second = Number(insert.run().lastInsertRowid);
    expect(second).toBeGreaterThan(first);
  } finally {
    db.close();
  }
});

describe('the v2 upgrade', () => {
  it('adds the skill tracker to a v1 file without touching its data', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { DatabaseSync } = await import('node:sqlite');
    const { readFileSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'hub-v1-'));
    const file = join(dir, 'hub.db');
    try {
      // A file as v1 left it, holding one goal.
      const v1 = new DatabaseSync(file);
      v1.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
      v1.exec('PRAGMA user_version = 1');
      v1.exec("INSERT INTO goals (title, created_at) VALUES ('Keep me', '2026-11-22T18:00:00.000Z')");
      v1.close();

      const db = openDb(file);
      const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(user_version).toBe(2);
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
      expect(tables).toEqual(expect.arrayContaining(['skills', 'skill_nodes', 'skill_links']));
      expect((db.prepare('SELECT title FROM goals').get() as { title: string }).title).toBe('Keep me');
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
