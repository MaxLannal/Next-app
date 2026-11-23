// Where a session's files live in the GitHub repo: `sessions/YYYY-MM-DD_<slug>`.

const MAX_SLUG = 48;
const FALLBACK = 'session';

/**
 * Lowercase ASCII: diacritics stripped, every run of anything else turned into one `-`,
 * capped at 48 characters, falling back to `session`.
 */
export function slug(name: string): string {
  const folded = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
  const out = folded
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
  return out === '' ? FALLBACK : out;
}

/** The session's folder, from the day it started (a day key) and its name at creation. */
export function sessionFolder(startedAtDay: string, name: string): string {
  return `sessions/${startedAtDay}_${slug(name)}`;
}

const ESCAPED = /[.*+?^${}()|[\]\\]/g;

const escapeRegExp = (text: string) => text.replace(ESCAPED, '\\$&');

/** Whether `path` is a file directly inside `folder` (`sessions/YYYY-MM-DD_slug/file`). */
export function isInFolder(path: string, folder: string): boolean {
  return new RegExp(`^${escapeRegExp(folder)}/[^/]+$`).test(path);
}
