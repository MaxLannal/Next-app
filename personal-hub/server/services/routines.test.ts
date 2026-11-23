import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { makeTestContext, TEST_NOW, type TestContext } from '../test/helpers.ts';
import { dayKey } from './backup.ts';
import { startRoutines } from './routines.ts';

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

it('backups at boot and keeps the Mac awake when Settings says so', () => {
  t.config.update({ keepAwake: true });
  const routines = startRoutines(t);
  try {
    expect(t.fakes.mac.calls.keepAwake).toEqual([[true]]);
    const day = dayKey(new Date(TEST_NOW), 'America/Chicago');
    expect(readdirSync(t.paths.backupsDir)).toContain(`hub-${day}.db`);
  } finally {
    routines.stop();
  }
  expect(t.fakes.mac.calls.keepAwake.at(-1)).toEqual([false]);
});

it('the run-time backup is a valid copy with rows still in the write-ahead log', () => {
  // These rows are committed to hub.db-wal and not checkpointed into hub.db.
  t.db.exec("INSERT INTO settings (key, value) VALUES ('live-copy', 'yes')");
  t.db.exec(
    "INSERT INTO resources (url, title, kind, domain, note, done, created_at) VALUES ('https://example.org', 'In the log', 'link', 'example.org', '', 0, '2026-11-22T00:00:00.000Z')",
  );
  expect(existsSync(`${t.paths.dbFile}-wal`)).toBe(true);

  const routines = startRoutines(t);
  routines.stop();

  const day = dayKey(new Date(TEST_NOW), 'America/Chicago');
  const file = join(t.paths.backupsDir, `hub-${day}.db`);
  expect(existsSync(`${file}-wal`)).toBe(true);
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    expect(copy.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    // The source's WAL is still there, so the copy's rows came from -wal, not a checkpoint.
    expect(existsSync(`${t.paths.dbFile}-wal`)).toBe(true);
    const row = copy.prepare("SELECT value FROM settings WHERE key = 'live-copy'").get() as { value: string };
    const titles = copy.prepare("SELECT title FROM resources WHERE title = 'In the log'").get() as { title: string };
    expect(row.value).toBe('yes');
    expect(titles.title).toBe('In the log');
  } finally {
    copy.close();
  }
});

it('leaves the Mac’s sleep alone when keep-awake is off', () => {
  const routines = startRoutines(t);
  try {
    expect(t.fakes.mac.calls.keepAwake).toEqual([]);
  } finally {
    routines.stop();
  }
});

it('a failed backup is logged and the hub carries on', () => {
  const logged: string[] = [];
  // The backup folder is gone, so the copy can't be written.
  rmSync(t.paths.backupsDir, { recursive: true, force: true });
  const routines = startRoutines(t, (m) => logged.push(m));
  routines.stop();
  expect(logged.some((m) => m.startsWith('Backup failed:'))).toBe(true);
});
