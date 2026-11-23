// Two-way GitHub sync: uploads of code and text are committed into the clone, and the
// clone is pulled every couple of minutes so files committed elsewhere land in the hub.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { GitStatus } from '../../shared/types.ts';
import type { AppContext, GitSync } from '../context.ts';
import { classifyFile, isSyncable } from '../lib/files.ts';
import { isInFolder, sessionFolder } from '../lib/slug.ts';
import { dayKey } from '../lib/time.ts';
import { createAttachment, getAttachment, onAttachmentCreated, updateAttachment } from '../repo/attachments.ts';

export type GitResult = { code: number; stdout: string; stderr: string };
export type GitRunner = (args: string[], cwd: string) => Promise<GitResult>;

export type GitSyncOptions = {
  git?: GitRunner;
  /** Tests clone this URL instead of going through `gh`. */
  remoteUrl?: string;
  /** Tests that script git: the clone is treated as ready and lives in `paths.repoDir`. */
  syncEnabled?: boolean;
};

const exec = promisify(execFile);

/** Runs git with the user's own credential helpers switched off, so only `gh` is asked for a token. */
async function runGit(args: string[], cwd: string): Promise<GitResult> {
  try {
    const { stdout, stderr } = await exec('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const failed = err as { code?: unknown; stdout?: string; stderr?: string; message: string };
    return {
      code: typeof failed.code === 'number' ? failed.code : 1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr || failed.message,
    };
  }
}

const GIT_ENV = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'];

type SessionRow = { id: number; name: string; started_at: string; repo_folder: string | null };

/** A repo-relative file path: no leading slash, no backslash, no `..`. */
const UNSAFE_PATH = /^\/|\\|(^|\/)\.\.(\/|$)/;

/** A push that can't go ahead; the message already reads `hw.py has no session …`. */
class ReasonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReasonError';
  }
}

export function createGitSync(ctx: AppContext, opts: GitSyncOptions = {}): GitSync {
  const git = opts.git ?? runGit;
  let repoDir: string | null = opts.syncEnabled ? ctx.paths.repoDir : null;
  let lastSyncAt: string | null = null;
  let lastError: string | null = null;

  const configured = () => ctx.config.get().github.repo !== null || repoDir !== null;
  const ready = () => configured() && repoDir !== null;

  /** Every git call goes through here: our credential flags, inside the clone, in this order. */
  async function call(args: string[]): Promise<GitResult> {
    return git([...GIT_ENV, ...args], repoDir ?? ctx.paths.repoDir);
  }

  /** Runs git and throws the last line of its stderr when it fails. */
  async function must(args: string[]): Promise<string> {
    const result = await call(args);
    if (result.code !== 0) {
      const lines = result.stderr.trim().split('\n').filter((l) => l !== '');
      // The last line names the refs and not the reason; the `remote:` line carries the reason.
      const detail =
        lines.find((l) => l.startsWith('remote:'))?.slice('remote:'.length).trim() ||
        lines.at(-1) ||
        `git ${args.find((a) => !GIT_ENV.includes(a) && !a.startsWith('-')) ?? ''} failed`;
      throw new Error(detail);
    }
    return result.stdout;
  }

  function status(): GitStatus {
    const pending = ctx.db.prepare("SELECT COUNT(*) AS n FROM attachments WHERE repo_state IN ('pending', 'failed')").get() as {
      n: number;
    };
    return {
      configured: configured(),
      repo: ctx.config.get().github.repo ?? (repoDir === null ? null : 'local'),
      lastSyncAt,
      lastError,
      pending: Number(pending.n),
    };
  }

  const sessionRow = (id: number) =>
    ctx.db.prepare('SELECT id, name, started_at, repo_folder FROM focus_sessions WHERE id = ?').get(id) as
      | SessionRow
      | undefined;

  /** The session's repo folder, written down the first time it's needed (older sessions have none). */
  function folderOf(session: SessionRow): string {
    if (session.repo_folder !== null) return session.repo_folder;
    const folder = sessionFolder(dayKey(new Date(session.started_at), ctx.timeZone()), session.name);
    ctx.db.prepare('UPDATE focus_sessions SET repo_folder = ? WHERE id = ?').run(folder, session.id);
    return folder;
  }

  /**
   * `hw.py`, `hw (2).py`, `hw (3).py` … the first name the clone doesn't hold. A name that holds
   * the same bytes is reused (`skip`: nothing new to write), never overwritten. Null once every
   * numbered name is taken: better a failed push than a guess that overwrites.
   */
  function freeName(folder: string, filename: string, content: Buffer): { name: string; skip: boolean } | null {
    const dot = filename.lastIndexOf('.');
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : '';
    for (let n = 1; n < 10_000; n += 1) {
      const name = n === 1 ? filename : `${stem} (${n})${ext}`;
      const target = join(repoDir!, folder, name);
      if (!existsSync(target)) return { name, skip: false };
      if (readFileSync(target).equals(content)) return { name, skip: true };
    }
    return null;
  }

  async function pushOne(attachmentId: number): Promise<void> {
    const a = getAttachment(ctx, attachmentId);
    // Only uploads of code, LaTeX and text go up: photos, PDFs, files renamed on the way in and
    // derived files stay local, and are not in this job at all, so they are left alone.
    if (!a || a.source !== 'upload' || !isSyncable(a.kind) || a.parentId !== null) return;
    const source = ctx.db.prepare('SELECT path FROM attachments WHERE id = ?').get(attachmentId) as { path: string } | undefined;
    const session = a.sessionId === null ? undefined : sessionRow(a.sessionId);
    if (!source || !session || !repoDir || UNSAFE_PATH.test(a.filename)) {
      throw new ReasonError(
        !source ? 'is missing its locally stored file' : !session ? 'has no session to file it under' : 'has a name that is not a plain file name',
      );
    }

    const folder = folderOf(session);
    const content = readFileSync(join(ctx.paths.dataDir, source.path));
    const chosen = freeName(folder, a.filename, content);
    if (chosen === null) throw new ReasonError('every name for this file is taken in the repo');
    const { name, skip } = chosen;
    const repoPath = `${folder}/${name}`;

    // `skip` means the file is already in the clone. A commit an earlier attempt made but never
    // pushed is still waiting, so that case pushes too.
    const heads = await Promise.all([
      call(['rev-parse', '--verify', 'HEAD']),
      call(['rev-parse', '--verify', '@{upstream}']),
    ]);
    const ahead =
      heads[0].code === 0 &&
      heads[1].code === 0 &&
      (await call(['rev-list', '--count', '@{upstream}..HEAD'])).stdout.trim() !== '0';
    if (!skip || ahead) {
      const target = join(repoDir, repoPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      // Commit while HEAD's copy differs from the file. Compared against HEAD, not the index, so a
      // commit made by an earlier attempt that never pushed is pushed by this one.
      const working = (await must(['hash-object', '--', repoPath])).trim();
      const committed = (await call(['rev-parse', `--verify`, `HEAD:${repoPath}`])).stdout.trim() || null;
      if (working !== committed) {
        await must(['add', '--', repoPath]);
        await must(['-c', 'user.name=Personal Hub', '-c', 'user.email=hub@localhost', 'commit', '-q', '-m', `${session.name}: add ${name}`]);
      }
      await must(['pull', '--rebase', '--no-edit']);
      await must(['push', 'origin', 'HEAD']);
    }

    ctx.db.prepare("UPDATE attachments SET repo_path = ?, repo_state = 'synced' WHERE id = ?").run(repoPath, attachmentId);
    lastError = null;
  }

  /** Records a failed push: the row, the status line, and one log line. */
  function markFailed(attachmentId: number, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    ctx.db.prepare("UPDATE attachments SET repo_state = 'failed' WHERE id = ?").run(attachmentId);
    lastError = `push failed: ${message}`;
    console.error(`GitHub push failed for attachment ${attachmentId}: ${message}`);
  }

  /** A failure whose message already says what went wrong, without git's stderr. */
  function describe(attachmentId: number, err: unknown): unknown {
    if (!(err instanceof ReasonError)) return err;
    const name = (ctx.db.prepare('SELECT filename FROM attachments WHERE id = ?').get(attachmentId) as { filename: string } | undefined)?.filename;
    return new Error(`${name ?? 'this file'} ${err.message}`);
  }

  /** Pushes one upload; a failure is written on the attachment and on the status line, never thrown. */
  async function pushJob(attachmentId: number): Promise<void> {
    if (!ready()) return;
    const marked = ctx.db
      .prepare("UPDATE attachments SET repo_state = 'pending' WHERE id = ? AND (repo_state IS NULL OR repo_state = 'failed')")
      .run(attachmentId);
    if (Number(marked.changes) === 0) return; // already pushed, queued, or marked removed
    // Start from what is on GitHub now, so the commit isn't made on a stale base.
    await call(['pull', '--rebase', '--no-edit']);
    try {
      await pushOne(attachmentId);
    } catch (err) {
      markFailed(attachmentId, describe(attachmentId, err));
    }
  }

  function enqueuePush(attachmentId: number): void {
    ctx.jobs.enqueue('git-push', () => pushJob(attachmentId));
  }

  /** Retries uploads whose earlier push failed, and rows a crash left pending. */
  async function retryFailed(): Promise<void> {
    const rows = ctx.db
      .prepare("SELECT id FROM attachments WHERE repo_state IN ('pending', 'failed') ORDER BY id")
      .all() as { id: number }[];
    for (const r of rows) {
      try {
        await pushOne(r.id); // on failure, stays failed with its error
      } catch (err) {
        markFailed(r.id, describe(r.id, err));
      }
    }
  }

  /** A path from git: under a session's folder it belongs to that session, otherwise unfiled. */
  function sessionFor(repoPath: string): number | null {
    const sessions = ctx.db.prepare('SELECT id, repo_folder FROM focus_sessions WHERE repo_folder IS NOT NULL').all() as {
      id: number;
      repo_folder: string;
    }[];
    return sessions.find((s) => isInFolder(repoPath, s.repo_folder))?.id ?? null;
  }

  /**
   * Files in a newer clone's HEAD that the hub doesn't hold yet: new ones, or changed ones.
   * `createAttachment` and `updateAttachment` each open their own transaction, so nothing here
   * holds one open across them; a future caller that does needs a savepoint for the nesting.
   */
  async function applyChange(statusCode: string, repoPath: string): Promise<void> {
    if (!repoDir) return;
    const existing = ctx.db.prepare('SELECT id FROM attachments WHERE repo_path = ?').get(repoPath) as
      | { id: number }
      | undefined;
    const absolute = join(repoDir, repoPath);

    if (statusCode === 'D') {
      if (existing) ctx.db.prepare("UPDATE attachments SET repo_state = 'removed' WHERE id = ?").run(existing.id);
      return;
    }
    if (!existsSync(absolute)) return; // a deletion stuck between the record and the checkout
    const bytes = readFileSync(absolute);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const name = repoPath.split('/').at(-1)!;
    // Always passed, even empty, so a large file's import text is read on every change and the
    // index always matches the file; `undefined` would leave the old text in the index.
    const text = isSyncable(classifyFile(name)) ? bytes.toString('utf8') : '';

    if (existing) {
      const { id } = existing;
      const { path } = ctx.db.prepare('SELECT path FROM attachments WHERE id = ?').get(id) as { path: string };
      writeFileSync(join(ctx.paths.dataDir, path), bytes);
      updateAttachment(ctx, id, { extractedText: text });
      ctx.db.prepare("UPDATE attachments SET sha256 = ?, repo_state = 'synced' WHERE id = ?").run(sha256, id);
      return;
    }

    createAttachment(ctx, {
      sessionId: sessionFor(repoPath),
      filename: name,
      bytes,
      source: 'github',
      repoPath,
      extractedText: text,
      notify: false,
    });
  }

  async function pull(): Promise<GitStatus> {
    if (!ready()) return status();
    try {
      const head = await call(['rev-parse', 'HEAD']);
      await must(['pull', '--rebase', '--no-edit']);

      if (head.code === 0) {
        const old = head.stdout.trim();
        const diff = await call(['diff', '--name-status', `${old}..HEAD`]);
        if (diff.code === 0) {
          for (const line of diff.stdout.split('\n')) {
            if (line.trim() === '') continue;
            const [code, ...rest] = line.split('\t');
            const repoPath = rest.at(-1) ?? '';
            if (repoPath === '' || UNSAFE_PATH.test(repoPath)) continue;
            if (code !== 'A' && code !== 'M' && code !== 'D') continue;
            await applyChange(code, repoPath);
          }
        }
      }

      await retryFailed();
      lastSyncAt = ctx.now().toISOString();
    } catch (err) {
      lastError = `pull failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    return status();
  }

  /** Runs `gh` once; resolves true on exit 0. */
  async function gh(args: string[]): Promise<boolean> {
    try {
      await exec('gh', args, { maxBuffer: 4 * 1024 * 1024 });
      return true;
    } catch {
      return false;
    }
  }

  async function connect(repo: string): Promise<GitStatus> {
    const name = repo.trim();
    try {
      if (opts.remoteUrl === undefined) {
        if (!(await gh(['repo', 'view', name]))) {
          await gh(['repo', 'create', name, '--private']);
        }
      }
      if (existsSync(join(repoDir ?? ctx.paths.repoDir, '.git'))) {
        await must(['remote', 'set-url', 'origin', opts.remoteUrl ?? `https://github.com/${name}.git`]);
        await must(['pull', '--rebase', '--no-edit']);
      } else {
        mkdirSync(repoDir ?? ctx.paths.repoDir, { recursive: true });
        await must(['clone', opts.remoteUrl ?? `https://github.com/${name}.git`, '.']);
      }
      repoDir = repoDir ?? ctx.paths.repoDir;
      ctx.config.update({ github: { repo: name } });
      lastError = null;
    } catch (err) {
      lastError = `connect failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    return status();
  }

  // The clone may already be there from a previous run.
  if (ctx.config.get().github.repo !== null && existsSync(join(ctx.paths.repoDir, '.git'))) {
    repoDir = ctx.paths.repoDir;
  }

  return { status, enqueuePush, pull, connect };
}

/** Queues a push for each new syncable upload once git is configured. */
export function hookAttachmentPushes(ctx: AppContext): void {
  onAttachmentCreated.push((c, a) => {
    if (a.source !== 'upload' || !isSyncable(a.kind) || a.parentId !== null) return;
    let configured = false;
    try {
      configured = c.git.status().configured;
    } catch {
      return; // the git service isn't available at all
    }
    if (configured) c.git.enqueuePush(a.id);
  });
}
