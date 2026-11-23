import { copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from '../context.ts';

/** Backups kept: the newest 14 days. */
export const KEEP_BACKUPS = 14;

const BACKUP_NAME = /^hub-(\d{4}-\d{2}-\d{2})\.db$/;

/** The local day key of `at` in the hub's time zone (`YYYY-MM-DD`). */
export function dayKey(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Copies the database into `backups/hub-YYYY-MM-DD.db` (today's file is
 * replaced), then deletes all but the newest 14. Day keys sort as dates.
 * Returns the backup's full path.
 */
export function backupNow(ctx: AppContext): string {
  const dir = ctx.paths.backupsDir;
  const file = join(dir, `hub-${dayKey(ctx.now(), ctx.timeZone())}.db`);
  // VACUUM INTO won't write over a file, so today's earlier backup is replaced first.
  if (existsSync(file)) unlinkSync(file);
  ctx.db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  prune(dir);
  return file;
}

/** The day of the newest backup, or null when there is none. */
export function lastBackupDay(dir: string): string | null {
  const days = backupDays(dir);
  return days.length === 0 ? null : days[days.length - 1];
}

function backupDays(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => BACKUP_NAME.exec(name)?.[1])
    .filter((day): day is string => day !== undefined)
    .sort();
}

function prune(dir: string): void {
  const days = backupDays(dir);
  for (const day of days.slice(0, Math.max(0, days.length - KEEP_BACKUPS))) {
    unlinkSync(join(dir, `hub-${day}.db`));
  }
}

/**
 * Writes the database into the day's backup file by copying it together with
 * `-wal` and `-shm`, the way the live hub runs (WAL). `sqlite3 file 'VACUUM
 * INTO …'` does the same on the command line for a hub that isn't running.
 */
export function backupCopy(dbFile: string, file: string): string {
  for (const suffix of ['-wal', '-shm']) if (existsSync(file + suffix)) unlinkSync(file + suffix);
  if (existsSync(file)) unlinkSync(file);
  copyFileSync(dbFile, file);
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(dbFile + suffix)) copyFileSync(dbFile + suffix, file + suffix);
  }
  return file;
}
