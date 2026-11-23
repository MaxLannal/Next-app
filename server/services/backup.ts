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
  return backupInto(
    ctx.db,
    ctx.paths.backupsDir,
    dayKey(ctx.now(), ctx.timeZone()),
    (file) => ctx.db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`),
  );
}

/** The day's path, `VACUUM INTO` it (over today's earlier file, which VACUUM INTO refuses to overwrite), then prune. */
function backupInto(db: { exec(sql: string): void }, dir: string, day: string, write: (file: string) => void): string {
  const file = join(dir, `hub-${day}.db`);
  if (existsSync(file)) unlinkSync(file);
  write(file);
  prune(dir);
  return file;
}

/**
 * The daily routine's backup, while the hub has the database open and can't
 * `VACUUM INTO` its own file: copies `hub.db` with its `-wal` and `-shm` into
 * the same day's name (replacing today's earlier copy), then prunes.
 */
export function backupLive(ctx: AppContext): string {
  const dir = ctx.paths.backupsDir;
  return backupInto(ctx.db, dir, dayKey(ctx.now(), ctx.timeZone()), (file) => {
    backupCopy(ctx.paths.dbFile, file);
  });
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
 * Writes the database into `file` by copying it together with `-wal` and
 * `-shm`. The live hub runs in WAL mode, so its newest pages can sit in `-wal`;
 * a copy without that file, or one taken while the `-wal` is replaced halfway
 * through, can be inconsistent. The three files are copied in the order
 * database, `-shm`, `-wal`, which suits SQLite: a commit lands in `-wal` (and a
 * checkpoint copies back to the database) before `-wal` is reset, so the
 * database's copy is the oldest of the three.
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
