import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { makeTestContext, type TestContext } from '../test/helpers.ts';
import { backupCopy, backupNow, dayKey, KEEP_BACKUPS, lastBackupDay } from './backup.ts';

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

const backups = () => readdirSync(t.paths.backupsDir).filter((f) => f.endsWith('.db')).sort();

it('prunes to fourteen', () => {
  // 16 consecutive days: 2026-11-07 … 2026-11-22 (noon UTC is morning in Chicago, so the local day matches).
  for (let day = 7; day <= 22; day++) {
    t.setNow(`2026-11-${String(day).padStart(2, '0')}T18:00:00.000Z`);
    backupNow(t);
  }

  const files = backups();
  expect(files).toHaveLength(KEEP_BACKUPS);
  expect(files[0]).toBe('hub-2026-11-09.db');
  expect(files[files.length - 1]).toBe('hub-2026-11-22.db');
});

it('replaces the same day’s file instead of adding one', () => {
  t.setNow('2026-11-22T14:00:00.000Z');
  const first = backupNow(t);
  t.setNow('2026-11-22T20:00:00.000Z');
  const second = backupNow(t);

  expect(second).toBe(first);
  expect(backups()).toEqual(['hub-2026-11-22.db']);
});

it('is a readable copy of the database', () => {
  t.db.exec("INSERT INTO settings (key, value) VALUES ('probe', 'kept')");
  const file = backupNow(t);

  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const row = copy.prepare("SELECT value FROM settings WHERE key = 'probe'").get() as { value: string };
    expect(row.value).toBe('kept');
  } finally {
    copy.close();
  }
  expect(readFileSync(file).length).toBeGreaterThan(0);
});

it('names the file by the hub’s local day', () => {
  // 03:00 UTC on the 23rd is 21:00 on the 22nd in Chicago.
  expect(dayKey(new Date('2026-11-23T03:00:00.000Z'), 'America/Chicago')).toBe('2026-11-22');
  expect(dayKey(new Date('2026-11-23T03:00:00.000Z'), 'UTC')).toBe('2026-11-23');
});

it('reports the newest backup day, and none before the first', () => {
  expect(lastBackupDay(t.paths.backupsDir)).toBeNull();
  t.setNow('2026-11-21T18:00:00.000Z');
  backupNow(t);
  t.setNow('2026-11-22T18:00:00.000Z');
  backupNow(t);
  expect(lastBackupDay(t.paths.backupsDir)).toBe('2026-11-22');
});

it('copies a live database with its write-ahead files', () => {
  // A running hub in WAL mode has the newest pages in -wal; a copy without it can miss them.
  t.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  t.db.exec("INSERT INTO settings (key, value) VALUES ('wal-copy', 'yes')");
  t.db.exec("INSERT INTO resources (url, title, kind, domain, note, done, created_at) VALUES ('https://example.org', 'Saved in the log', 'link', 'example.org', '', 0, '2026-11-22T00:00:00.000Z')");
  const file = `${t.paths.backupsDir}/copied.db`;
  backupCopy(t.paths.dbFile, file);

  const copy = new DatabaseSync(file);
  try {
    const row = copy.prepare("SELECT value FROM settings WHERE key = 'wal-copy'").get() as { value: string };
    const links = copy.prepare("SELECT count(*) AS n FROM resources WHERE title = 'Saved in the log'").get() as { n: number };
    expect(row.value).toBe('yes');
    expect(links.n).toBe(1);
  } finally {
    copy.close();
  }
});
