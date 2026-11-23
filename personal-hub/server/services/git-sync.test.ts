import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Attachment, GitStatus } from '../../shared/types.ts';
import type { GitSync } from '../context.ts';
import { sessionFolder } from '../lib/slug.ts';
import { dayKey } from '../lib/time.ts';
import { createGitSync, hookAttachmentPushes, type GitRunner } from './git-sync.ts';
import type { TestContext } from '../test/helpers.ts';
import { makeTestContext } from '../test/helpers.ts';

const run = promisify(execFile);

// A real git, configured so it can commit and clone on any machine; nothing reaches the network.
async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run(
    'git',
    [
      '-c',
      'user.name=Hub Test',
      '-c',
      'user.email=hub@example.com',
      '-c',
      'init.defaultBranch=main',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    // A pre-receive hook only refuses a push when it exits non-zero and writes to stderr.
    { cwd, env: { ...process.env, GIT_EDITOR: 'true' } },
  );
  return stdout;
}

/** Makes the bare repo refuse every push until the hook is removed. */
function refusePushes(): () => void {
  const hook = join(bare, 'hooks', 'pre-receive');
  writeFileSync(hook, '#!/bin/sh\necho "push refused" >&2\nexit 1\n');
  chmodSync(hook, 0o755);
  return () => rmSync(hook, { force: true });
}

const SESSION_ID = 'ch-4-exercises';

let t: TestContext;
let bare: string;
let work: string;
let remoteUrl: string;
let repoDir: string;
let gitSync: GitSync;

beforeEach(async () => {
  bare = mkdtempSync(join(tmpdir(), 'hub-bare-'));
  await git(bare, 'init', '--bare', '-q');
  work = mkdtempSync(join(tmpdir(), 'hub-work-'));
  await git(work, 'clone', '-q', bare, '.');
  writeFileSync(join(work, 'README.md'), '# work journal\n');
  await git(work, 'add', '.');
  await git(work, 'commit', '-q', '-m', 'init');
  await git(work, 'push', '-q', 'origin', 'HEAD:main');
  remoteUrl = `file://${bare}`;

  t = makeTestContext();
  repoDir = t.paths.repoDir;
  gitSync = connectGit();

  // The app's routes read `ctx.git` per request, so the real service serves them too.
  Object.defineProperty(t, 'git', { get: () => gitSync, set: () => {}, configurable: true });
  hookAttachmentPushes(t);
});

/** A real GitSync over the test's data folder, cloning the bare repo through `remoteUrl`. */
function connectGit(opts: { runner?: GitRunner } = {}): GitSync {
  const git = createGitSync(t, { remoteUrl, ...opts });
  t.git = git;
  return git;
}

afterEach(async () => {
  await t.jobs.drain();
  t.cleanup();
  rmSync(bare, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

function insertSession(name = 'Ch. 4 exercises', startedAt = '2026-11-22T17:00:00.000Z'): number {
  // The folder the session route writes at creation (startedAt is 11:00 in Chicago).
  const folder = sessionFolder(dayKey(new Date(startedAt), t.timeZone()), name);
  const res = t.db
    .prepare(
      `INSERT INTO focus_sessions (name, status, started_at, repo_folder, created_at) VALUES (?, 'done', ?, ?, ?)`,
    )
    .run(name, startedAt, folder, startedAt);
  return Number(res.lastInsertRowid);
}

async function upload(files: [string, string][], sessionId: number | null): Promise<Attachment[]> {
  const form = new FormData();
  for (const [name, content] of files) form.append('files', new File([content], name));
  if (sessionId !== null) form.append('sessionId', String(sessionId));
  const res = await t.req('POST', '/api/attachments', form);
  expect(res.status).toBe(201);
  return (await res.json()) as Attachment[];
}

async function one(files: [string, string][], sessionId: number | null): Promise<Attachment> {
  const [a] = await upload(files, sessionId);
  await t.jobs.drain();
  return a;
}

/** A fresh clone of the bare repo. */
async function cloneBare(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'hub-clone-'));
  await git(dir, 'clone', '-q', remoteUrl, '.');
  return dir;
}

const commitCount = async (): Promise<number> =>
  Number((await git(bare, 'rev-list', '--count', 'main')).trim());

const committedFiles = async (): Promise<string[]> =>
  (await git(bare, 'ls-tree', '-r', '--name-only', 'main')).split('\n').filter((p) => p !== '');

const row = (id: number) =>
  t.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as {
    filename: string;
    repo_path: string | null;
    repo_state: string | null;
    sha256: string;
  };

const sessionFolderOf = (id: number) =>
  (t.db.prepare('SELECT repo_folder FROM focus_sessions WHERE id = ?').get(id) as { repo_folder: string | null })
    .repo_folder;

const attachmentsOf = async (sessionId: number) =>
  (await (await t.req('GET', `/api/attachments?sessionId=${sessionId}`)).json()) as Attachment[];

const status = (): GitStatus => gitSync.status();

describe('connect', () => {
  it('clones the remote and saves the repo', async () => {
    const res = await t.req('POST', '/api/github/connect', { repo: 'max/work-journal' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ configured: true, repo: 'max/work-journal', pending: 0 });
    expect(t.config.get().github.repo).toBe('max/work-journal');
    expect(existsSync(join(repoDir, 'README.md'))).toBe(true);
    expect(status().configured).toBe(true);
  });

  it('rejects a name that is not owner/repo', async () => {
    for (const repo of ['', 'work-journal', 'a/b/c', 42]) {
      expect((await t.req('POST', '/api/github/connect', { repo })).status).toBe(400);
    }
    expect(t.fakes.git.calls.connect).toHaveLength(0);
  });
});

describe('push', () => {
  it('pushes an uploaded .py into the session folder', async () => {
    const sessionId = insertSession();
    await t.req('POST', '/api/github/connect', { repo: 'max/work-journal' });

    const [hw] = await upload([['hw.py', 'print("quadratic residues")\n']], sessionId);
    await t.jobs.drain();

    const clone = await cloneBare();
    const path = `sessions/2026-11-22_${SESSION_ID}/hw.py`;
    expect(readFileSync(join(clone, path), 'utf8')).toBe('print("quadratic residues")\n');
    expect(readFileSync(join(repoDir, path), 'utf8')).toBe('print("quadratic residues")\n');
    expect(row(hw.id)).toMatchObject({ repo_path: path, repo_state: 'synced' });
    expect(sessionFolderOf(sessionId)).toBe(`sessions/2026-11-22_${SESSION_ID}`);
    expect((await git(bare, 'log', '-1', '--format=%s')).trim()).toBe('Ch. 4 exercises: add hw.py');
    expect(status()).toMatchObject({ lastError: null, pending: 0 });
    rmSync(clone, { recursive: true, force: true });
  });

  it('keeps photos local', async () => {
    const sessionId = insertSession();
    await t.req('POST', '/api/github/connect', { repo: 'max/work-journal' });
    const before = await commitCount();

    const [photo] = await upload([['a.png', 'fake png']], sessionId);
    await t.jobs.drain();

    expect(await commitCount()).toBe(before);
    expect(row(photo.id)).toMatchObject({ repo_path: null, repo_state: null });
  });

  it('renames on collision, skips identical', async () => {
    const sessionId = insertSession();
    await t.req('POST', '/api/github/connect', { repo: 'max/work-journal' });

    const [first] = await upload([['hw.py', 'v1\n']], sessionId);
    await t.jobs.drain();
    const afterFirst = await commitCount();
    expect(afterFirst).toBe(2); // the init commit and this one

    const [again] = await upload([['hw.py', 'v1\n']], sessionId);
    await t.jobs.drain();
    expect(await commitCount()).toBe(afterFirst);
    expect(row(again.id)).toMatchObject({ repo_path: `sessions/2026-11-22_${SESSION_ID}/hw.py`, repo_state: 'synced' });

    const [different] = await upload([['hw.py', 'v2\n']], sessionId);
    await t.jobs.drain();
    expect(await commitCount()).toBe(afterFirst + 1);
    expect(row(different.id).repo_path).toBe(`sessions/2026-11-22_${SESSION_ID}/hw (2).py`);

    const folder = join(repoDir, `sessions/2026-11-22_${SESSION_ID}`);
    expect(readFileSync(join(folder, 'hw.py'), 'utf8')).toBe('v1\n'); // never overwritten
    expect(readFileSync(join(folder, 'hw (2).py'), 'utf8')).toBe('v2\n');
    expect(row(first.id).repo_path).toBe(`sessions/2026-11-22_${SESSION_ID}/hw.py`);

    // The local store keeps every upload as its own file.
    const stored = await attachmentsOf(sessionId);
    expect(stored.map((a) => a.id)).toEqual([first.id, again.id, different.id]);
  });

  it('fills in the folder of a session made before sync', async () => {
    const sessionId = insertSession();
    // Strip the folder as an older session would have: not written at creation.
    t.db.prepare('UPDATE focus_sessions SET repo_folder = NULL WHERE id = ?').run(sessionId);
    await t.req('POST', '/api/github/connect', { repo: 'max/work-journal' });

    const [hw] = await upload([['hw.py', 'x\n']], sessionId);
    await t.jobs.drain();

    expect(sessionFolderOf(sessionId)).toBe(`sessions/2026-11-22_${SESSION_ID}`);
    expect(row(hw.id).repo_path).toBe(`sessions/2026-11-22_${SESSION_ID}/hw.py`);
  });

  it('a re-run does not duplicate a commit', async () => {
    const sessionId = insertSession();
    await t.req('POST', '/api/github/connect', { repo: 'max/work-journal' });

    // A failed push, asked for twice before the retry: the second request must not double it.
    const allow = refusePushes();
    const [hw] = await upload([['hw.py', 'v1\n']], sessionId);
    await t.jobs.drain();
    expect(row(hw.id).repo_state).toBe('failed');
    allow();

    gitSync.enqueuePush(hw.id);
    gitSync.enqueuePush(hw.id);
    await t.jobs.drain();
    expect(await commitCount()).toBe(2); // the init commit and one file commit

    gitSync.enqueuePush(hw.id);
    await t.jobs.drain();
    expect(await commitCount()).toBe(2);
    expect(row(hw.id).repo_state).toBe('synced');
  });
});

describe('pull', () => {
  async function connectAndSync(): Promise<void> {
    await t.req('POST', '/api/github/connect', { repo: 'max/work-journal' });
  }

  /** Someone else's clone commits files and pushes. */
  async function upstream(files: Record<string, string>, deletes: string[] = []): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(work, path, '..'), { recursive: true });
      writeFileSync(join(work, path), content);
    }
    for (const path of deletes) await git(work, 'rm', '-q', path);
    await git(work, 'add', '-A');
    await git(work, 'commit', '-q', '-m', 'from another clone');
    await git(work, 'fetch', '-q', 'origin');
    await git(work, 'rebase', '-q', 'origin/main');
    await git(work, 'push', '-q', 'origin', 'HEAD:main');
  }

  it('pulls new files into their session', async () => {
    const sessionId = insertSession();
    await connectAndSync();
    await upstream({ [`sessions/2026-11-22_${SESSION_ID}/extra.py`]: 'print("extra")\n' });

    expect((await gitSync.pull()).lastError).toBeNull();

    const [extra] = await attachmentsOf(sessionId);
    expect(extra).toMatchObject({
      sessionId,
      filename: 'extra.py',
      source: 'github',
      repoPath: `sessions/2026-11-22_${SESSION_ID}/extra.py`,
      extractedText: 'print("extra")\n',
    });
    const stored = await t.req('GET', extra.url);
    expect(await stored.text()).toBe('print("extra")\n');
  });

  it('leaves files outside a session folder unfiled', async () => {
    await connectAndSync();
    await upstream({ 'notes/idea.md': '# idea\n' });
    await gitSync.pull();

    const list = (await (await t.req('GET', '/api/attachments?unfiled=1')).json()) as Attachment[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ sessionId: null, filename: 'idea.md', source: 'github', repoPath: 'notes/idea.md' });
  });

  it('updates a changed file and marks a deleted one removed', async () => {
    const sessionId = insertSession();
    await connectAndSync();
    await upstream({ [`sessions/2026-11-22_${SESSION_ID}/extra.py`]: 'one\n' });
    await gitSync.pull();
    const [extra] = await attachmentsOf(sessionId);

    await upstream({ [`sessions/2026-11-22_${SESSION_ID}/extra.py`]: 'two\n' });
    await gitSync.pull();
    let [changed] = await attachmentsOf(sessionId);
    expect(changed.id).toBe(extra.id);
    expect(changed.extractedText).toBe('two\n');
    expect(changed.repoState).toBe('synced');

    await upstream({}, [`sessions/2026-11-22_${SESSION_ID}/extra.py`]);
    await gitSync.pull();
    [changed] = await attachmentsOf(sessionId);
    expect(changed.repoState).toBe('removed');
    // The local copy is kept.
    const res = await t.req('GET', `/api/attachments/${changed.id}/file`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('two\n');
  });

  it('does not re-import what it pushed itself', async () => {
    const sessionId = insertSession();
    await connectAndSync();
    await one([['hw.py', 'v1\n']], sessionId);
    const count = (await attachmentsOf(sessionId)).length;

    await gitSync.pull();

    expect((await attachmentsOf(sessionId)).map((a) => a.source)).toEqual(['upload']);
    expect((await attachmentsOf(sessionId)).length).toBe(count);
  });

  it('reports a failure and retries it on the next pull', async () => {
    const sessionId = insertSession();
    await connectAndSync();

    const allow = refusePushes();
    const [hw] = await upload([['hw.py', 'v1\n']], sessionId);
    await t.jobs.drain();

    expect(row(hw.id).repo_state).toBe('failed');
    const failed = status();
    expect(failed.lastError).toBeTruthy();
    expect(failed.pending).toBe(1);
    expect(await t.req('GET', '/api/github/status').then((r) => r.json())).toMatchObject({ lastError: failed.lastError });

    allow();
    await gitSync.pull();

    expect(row(hw.id).repo_state).toBe('synced');
    expect(row(hw.id).repo_path).toBe(`sessions/2026-11-22_${SESSION_ID}/hw.py`);
    expect(status()).toMatchObject({ lastError: null, pending: 0 });
    expect(await committedFiles()).toContain(`sessions/2026-11-22_${SESSION_ID}/hw.py`);
    expect((await git(bare, 'log', '-1', '--format=%s', 'main')).trim()).toBe('Ch. 4 exercises: add hw.py');
  });

  it('surfaces a pull failure as lastError', async () => {
    await connectAndSync();
    rmSync(join(repoDir, '.git'), { recursive: true, force: true });
    const result = await gitSync.pull();
    expect(result.lastError).toBeTruthy();
    expect(status().lastError).toBe(result.lastError);
  });
});

describe('routes', () => {
  it('reports status before setup', async () => {
    const res = await t.req('GET', '/api/github/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false, repo: null, lastSyncAt: null, lastError: null, pending: 0 });
  });

  it('sync runs a pull and answers the status', async () => {
    await t.req('POST', '/api/github/connect', { repo: 'max/work-journal' });
    const res = await t.req('POST', '/api/github/sync');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ configured: true, lastSyncAt: expect.any(String) });
  });
});
