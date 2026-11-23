import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitSync } from './git-sync.ts';
import { sessionFolder } from '../lib/slug.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';

const FOLDER = 'sessions/2026-11-22_ch-4-exercises';

/** Answers each git call from a script; anything unscripted fails so a stray call shows up. */
function scripted(calls: { args: string[]; code?: number; stdout?: string; stderr?: string }[]) {
  const seen: string[][] = [];
  const git = async (args: string[]) => {
    seen.push(args);
    const next = calls.shift();
    if (!next || next.args.join(' ') !== args.join(' ')) {
      return { code: 1, stdout: '', stderr: `unexpected: ${args.join(' ')}` };
    }
    return { code: next.code ?? 0, stdout: next.stdout ?? '', stderr: next.stderr ?? '' };
  };
  return { git, seen };
}

let t: TestContext;
afterEach(() => t?.cleanup());

function setup(): number {
  t = makeTestContext();
  t.config.update({ github: { repo: 'max/work-journal' } });
  const folder = sessionFolder('2026-11-22', 'Ch. 4 exercises');
  const res = t.db
    .prepare(`INSERT INTO focus_sessions (name, status, started_at, repo_folder, created_at) VALUES ('Ch. 4 exercises', 'done', '2026-11-22T17:00:00.000Z', ?, '2026-11-22T17:00:00.000Z')`)
    .run(folder);
  return Number(res.lastInsertRowid);
}

const CREDENTIALS = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'];

/** Scripts git with the credential flags already in place, so tests write the bare commands. */
function scriptedGit(calls: { args: string[]; code?: number; stdout?: string; stderr?: string }[]) {
  const { git, seen } = scripted(calls.map((c) => ({ ...c, args: [...CREDENTIALS, ...c.args] })));
  return { git, seen };
}

it('every git call carries the gh credential flags', async () => {
  setup();
  // No retries to make, so a pull runs exactly: rev-parse, pull, diff.
  const { git, seen } = scriptedGit([
    { args: ['rev-parse', 'HEAD'], stdout: 'abc\n' },
    { args: ['pull', '--rebase', '--no-edit'] },
    { args: ['diff', '--name-status', 'abc..HEAD'] },
  ]);
  const sync = createGitSync(t, { git, syncEnabled: true });

  const result = await sync.pull();

  expect(result.lastError).toBeNull();
  expect(seen.map((args) => args[4])).toEqual(['rev-parse', 'pull', 'diff']);
  for (const args of seen) expect(args.slice(0, 4)).toEqual(CREDENTIALS);
});

it('a pull retries a row left pending', async () => {
  const sessionId = setup();
  const { mkdirSync: mk } = await import('node:fs');
  mk(join(t.paths.dataDir, 'files', '2026', '11'), { recursive: true });
  writeFileSync(join(t.paths.dataDir, 'files', '2026', '11', '2-hw.py'), 'v\n');
  const id = Number(
    t.db
      .prepare(
        `INSERT INTO attachments (session_id, kind, filename, mime, size, path, sha256, source, repo_state, created_at)
         VALUES (?, 'code', 'hw.py', 'text/x-python', 2, 'files/2026/11/2-hw.py', 'h', 'upload', 'pending', '2026-11-22T18:00:00.000Z')`,
      )
      .run(sessionId).lastInsertRowid,
  );
  const { git, seen } = scriptedGit([
    { args: ['rev-parse', 'HEAD'], stdout: 'abc\n' },
    { args: ['pull', '--rebase', '--no-edit'] },
    { args: ['diff', '--name-status', 'abc..HEAD'] },
    { args: ['rev-parse', '--verify', 'HEAD'], stdout: 'abc\n' },
    { args: ['rev-parse', '--verify', '@{upstream}'], stdout: 'abc\n' },
    { args: ['rev-list', '--count', '@{upstream}..HEAD'], stdout: '0\n' },
    { args: ['hash-object', '--', `${FOLDER}/hw.py`], stdout: 'blob\n' },
    { args: ['rev-parse', '--verify', `HEAD:${FOLDER}/hw.py`] },
    { args: ['add', '--', `${FOLDER}/hw.py`] },
    { args: ['-c', 'user.name=Personal Hub', '-c', 'user.email=hub@localhost', 'commit', '-q', '-m', 'Ch. 4 exercises: add hw.py'] },
    { args: ['pull', '--rebase', '--no-edit'] },
    { args: ['push', 'origin', 'HEAD'] },
  ]);
  const sync = createGitSync(t, { git, syncEnabled: true });

  const result = await sync.pull();

  expect(result.pending).toBe(0);
  expect(t.db.prepare('SELECT repo_state FROM attachments WHERE id = ?').get(id)).toEqual({ repo_state: 'synced' });
  expect(seen.some((args) => args[4] === 'push')).toBe(true);
});

it('status counts pending and failed uploads', async () => {
  const sessionId = setup();
  const insert = (state: string) =>
    t.db
      .prepare(
        `INSERT INTO attachments (session_id, kind, filename, mime, size, path, sha256, source, repo_state, created_at)
         VALUES (?, 'code', 'hw.py', 'text/x-python', 1, 'x', 'h', 'upload', ?, '2026-11-22T18:00:00.000Z')`,
      )
      .run(sessionId, state);
  insert('pending');
  insert('failed');
  insert('failed');
  insert('synced');

  expect(createGitSync(t).status()).toMatchObject({ configured: true, pending: 3 });
});

it('does nothing while not configured', async () => {
  t = makeTestContext();
  const { git, seen } = scriptedGit([]);
  const sync = createGitSync(t, { git, remoteUrl: 'file:///nowhere' });

  expect((await sync.pull()).configured).toBe(false);
  expect(sync.status()).toMatchObject({ configured: false, repo: null });
  expect(seen).toEqual([]);
});

it('a failed pull reaches the status line', async () => {
  t = makeTestContext();
  t.config.update({ github: { repo: 'max/work-journal' } });
  const { git } = scriptedGit([
    { args: ['rev-parse', 'HEAD'], stdout: 'abc\n' },
    { args: ['pull', '--rebase', '--no-edit'], code: 128, stderr: 'fatal: not a git repository' },
  ]);
  const sync = createGitSync(t, { git, syncEnabled: true });
  const result = await sync.pull();
  expect(result.lastError).toBe('pull failed: fatal: not a git repository');
});

// The repo already holds hw.py. The same content maps to it and is skipped; the rename case
// is `renames on collision, skips identical` against the real remote.
it('identical content under the same name skips the commit', async () => {
  setup();
  const repo = t.paths.repoDir;
  mkdirSync(join(repo, FOLDER), { recursive: true });
  writeFileSync(join(repo, FOLDER, 'hw.py'), 'v1\n');

  // Push an attachment whose content matches hw.py: no git work at all past the housekeeping pull.
  const sha = createHash('sha256').update('v1\n').digest('hex');
  const file = join(t.paths.dataDir, 'files', '2026', '11', '1-hw.py');
  mkdirSync(join(t.paths.dataDir, 'files', '2026', '11'), { recursive: true });
  writeFileSync(file, 'v1\n');
  const sessionId = t.db.prepare('SELECT id FROM focus_sessions').get() as { id: number };
  const id = Number(
    t.db
      .prepare(
        `INSERT INTO attachments (session_id, kind, filename, mime, size, path, sha256, source, created_at)
         VALUES (?, 'code', 'hw.py', 'text/x-python', 3, 'files/2026/11/1-hw.py', ?, 'upload', '2026-11-22T18:00:00.000Z')`,
      )
      .run(sessionId.id, sha).lastInsertRowid,
  );
  const { git, seen } = scriptedGit([
    { args: ['pull', '--rebase', '--no-edit'] },
    { args: ['rev-parse', '--verify', 'HEAD'], stdout: 'abc\n' },
    { args: ['rev-parse', '--verify', '@{upstream}'], stdout: 'abc\n' },
    { args: ['rev-list', '--count', '@{upstream}..HEAD'], stdout: '0\n' },
  ]);
  const sync = createGitSync(t, { git, syncEnabled: true });

  sync.enqueuePush(id);
  await t.jobs.drain();

  // The housekeeping pull, then the ahead check: nothing was added, committed or pushed.
  expect(seen.map((args) => args[4])).toEqual(['pull', 'rev-parse', 'rev-parse', 'rev-list']);
  expect(t.db.prepare('SELECT repo_path, repo_state FROM attachments WHERE id = ?').get(id)).toEqual({
    repo_path: `${FOLDER}/hw.py`,
    repo_state: 'synced',
  });
});
