import type { Context, Hono } from 'hono';
import { copyFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitStatus } from '../../shared/types.ts';
import { createApp } from '../app.ts';
import { createConfigStore } from '../config.ts';
import { UnavailableError, type AppContext, type ClaudeClient, type GitSync, type MacBridge } from '../context.ts';
import { openDb } from '../db/index.ts';
import { hubPaths } from '../paths.ts';
import { createJobQueue } from '../services/jobs.ts';

export const TEST_NOW = '2026-11-22T18:00:00.000Z';
const REMOTE_HEADER = 'x-test-remote';

type Calls<T> = { [K in keyof T]: T[K] extends (...args: infer A) => unknown ? A[] : never };

/** A service whose methods record their arguments in `calls.<method>`. Methods can be replaced per test. */
export type Fake<T> = T & { calls: Calls<T> };

export type Fakes = { claude: Fake<ClaudeClient>; mac: Fake<MacBridge>; git: Fake<GitSync> };

export type TestContext = AppContext & {
  app: Hono;
  fakes: Fakes;
  setNow(iso: string): void;
  cleanup(): void;
  req(
    method: string,
    path: string,
    body?: unknown,
    init?: { remote?: string; headers?: Record<string, string> },
  ): Promise<Response>;
};

/**
 * A full AppContext on a fresh temp data dir, with a fixed clock (TEST_NOW),
 * the America/Chicago time zone, and fake Claude, Mac and git services.
 */
export function makeTestContext(over: Partial<AppContext> = {}): TestContext {
  const dataDir = mkdtempSync(join(tmpdir(), 'hub-test-'));
  const paths = hubPaths(dataDir);
  const db = openDb(paths.dbFile);
  const fakes: Fakes = { claude: fakeClaude(), mac: fakeMac(), git: fakeGit() };
  let clock = new Date(TEST_NOW);

  const ctx: AppContext = {
    db,
    paths,
    config: createConfigStore(paths.configFile),
    now: () => new Date(clock),
    timeZone: () => 'America/Chicago',
    remoteAddress: (c: Context) => c.req.header(REMOTE_HEADER) ?? '127.0.0.1',
    jobs: createJobQueue(),
    ...fakes,
    ...over,
  };

  // The app holds this same object, so a test can swap a service (t.git = …) after creation.
  const app = createApp(ctx);
  return Object.assign(ctx, {
    app,
    fakes,
    setNow(iso: string) {
      clock = new Date(iso);
    },
    cleanup() {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
    req(method: string, path: string, body?: unknown, init: { remote?: string; headers?: Record<string, string> } = {}) {
      const headers = new Headers(init.headers);
      headers.set(REMOTE_HEADER, init.remote ?? '127.0.0.1');
      let payload: RequestInit['body'];
      if (typeof body === 'string' || body instanceof FormData || body instanceof Uint8Array || body instanceof Blob) {
        payload = body;
      } else if (body !== undefined) {
        payload = JSON.stringify(body);
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      }
      return Promise.resolve(app.request(path, { method, headers, body: payload }));
    },
  });
}

function fake<T extends object>(impl: T): Fake<T> {
  const calls: Record<string, unknown[]> = {};
  const out: Record<string, unknown> = { calls };
  for (const [name, method] of Object.entries(impl) as [string, (...args: unknown[]) => unknown][]) {
    const list: unknown[] = [];
    calls[name] = list;
    out[name] = (...args: unknown[]) => {
      list.push(args);
      return method(...args);
    };
  }
  return out as Fake<T>;
}

function fakeClaude(): Fake<ClaudeClient> {
  return fake<ClaudeClient>({
    // Image uploads trigger a background reading, so the default succeeds quietly.
    readImage: async () => ({ kind: 'caption', caption: 'Photo' }),
    // Chat tests script their own replies.
    streamTurn: async () => {
      throw new UnavailableError('No scripted Claude reply in this test');
    },
  });
}

function fakeMac(): Fake<MacBridge> {
  return fake<MacBridge>({
    calendarEvents: async () => ({ events: [], source: 'eventkit' }),
    calendarStatus: async () => 'granted',
    convertImage: async (src, dest) => {
      await copyFile(src, dest);
    },
    mediaKey: async () => {},
    nowPlaying: async () => null,
    mediaStatus: async () => 'ready',
    keepAwake: () => {},
  });
}

function fakeGit(): Fake<GitSync> {
  let repo: string | null = null;
  const status = (): GitStatus => ({ configured: repo !== null, repo, lastSyncAt: null, lastError: null, pending: 0 });
  return fake<GitSync>({
    status,
    enqueuePush: () => {},
    pull: async () => status(),
    connect: async (name) => {
      repo = name;
      return status();
    },
  });
}
