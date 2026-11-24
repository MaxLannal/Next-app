import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/** Each step brings the file up one version; a fresh file runs them all, an older one only the rest. */
const MIGRATIONS = [
  readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'), // v1: the hub
  readFileSync(new URL('./skills.sql', import.meta.url), 'utf8'), // v2: the skill tracker
  readFileSync(new URL('./skills-v3.sql', import.meta.url), 'utf8'), // v3: completion dates, stage names, stage-relative y
  readFileSync(new URL('./goals-rank.sql', import.meta.url), 'utf8'), // v4: goals keep the order they're dragged into
  readFileSync(new URL('./traces.sql', import.meta.url), 'utf8'), // v5: traces, the places on the globe
  readFileSync(new URL('./skill-sizes.sql', import.meta.url), 'utf8'), // v6: skill cards sized by hand
];
export const SCHEMA_VERSION = MIGRATIONS.length;

/** Opens the hub database (WAL, foreign keys on) and brings its schema up to date, one version at a time. */
export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let version = user_version; version < SCHEMA_VERSION; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      db.close();
      throw err;
    }
  }
  return db;
}
