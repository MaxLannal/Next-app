import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createApp } from './app.ts';
import { createConfigStore, hubTimeZone } from './config.ts';
import { unavailableClaude, unavailableGit, unavailableMac, type AppContext } from './context.ts';
import { openDb } from './db/index.ts';
import { defaultDataDir, hubPaths } from './paths.ts';
import { convertStoredPhotos } from './routes/traces.ts';
import { createGitSync, hookAttachmentPushes } from './services/git-sync.ts';
import { startHeartbeat } from './services/heartbeat.ts';
import { createJobQueue } from './services/jobs.ts';
import { createMacBridge } from './services/mac.ts';
import { createClaudeClient } from './services/claude.ts';
import { startRoutines } from './services/routines.ts';
import { registerVision, retryWaitingReadings } from './services/vision.ts';

const PULL_EVERY_MS = 2 * 60_000;

const paths = hubPaths(defaultDataDir());
const config = createConfigStore(paths.configFile);

// Built without git first: the sync reads the finished context.
const ctx: AppContext = {
  db: openDb(paths.dbFile),
  paths,
  config,
  now: () => new Date(),
  timeZone: () => hubTimeZone(config.get()),
  remoteAddress: (c) => getConnInfo(c).remote.address ?? '',
  jobs: createJobQueue(),
  claude: unavailableClaude,
  // HUB_NO_MAC=1 (the end-to-end tests) keeps Calendar, media keys and caffeinate out of it.
  mac: process.env.HUB_NO_MAC === '1' ? unavailableMac : createMacBridge(paths),
  git: unavailableGit,
};
ctx.git = createGitSync(ctx);
hookAttachmentPushes(ctx);

// Runs once at boot, which catches a server that was down, then every minute.
startHeartbeat(ctx);
// Traces photos kept as HEIC before uploads were converted become JPEGs, in the background.
void convertStoredPhotos(ctx).catch((err: unknown) => console.error('Converting stored photos failed', err));
// Stays awake if Settings says so, and backs the database up at boot and every 24 hours.
startRoutines(ctx);
// Claude goes through the gateway setup has saved before boot (Setup runs first);
// a reading failure is marked on the photo, so running without it is safe. A
// gateway changed after boot needs a restart.
{
  const anthropic = config.get().anthropic;
  if (anthropic.baseURL && anthropic.authToken) ctx.claude = createClaudeClient(anthropic);
}
registerVision();
// Readings that failed while the gateway was out of balance or out of reach are tried again by
// themselves: once soon after boot (with any a restart left half-done), then every 10 minutes.
{
  const retry = (leftover: boolean) =>
    void retryWaitingReadings(ctx, { leftover }).catch((err: unknown) => console.error('Retrying readings failed', err));
  setTimeout(() => retry(true), 20_000).unref();
  setInterval(() => retry(false), 10 * 60_000).unref();
}

// Pulls what was committed elsewhere every 2 minutes. The queue makes it wait for a running push.
const pullTimer = setInterval(() => {
  ctx.jobs.enqueue('git-pull', async () => {
    await ctx.git.pull();
  });
}, PULL_EVERY_MS);
pullTimer.unref();

const { port } = config.get();
serve({ fetch: createApp(ctx).fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`Hub running at http://localhost:${port}`);
});
