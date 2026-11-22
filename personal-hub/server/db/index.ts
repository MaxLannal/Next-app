import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 1;
const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** Opens the hub database (WAL, foreign keys on) and creates the schema on a fresh file. */
export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (user_version === 0) {
    db.exec('BEGIN');
    try {
      db.exec(schema);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      db.close();
      throw err;
    }
  }
  return db;
}
