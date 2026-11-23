import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createApp } from './app.ts';
import { createConfigStore, hubTimeZone } from './config.ts';
import { unavailableClaude, unavailableGit, unavailableMac, type AppContext } from './context.ts';
import { openDb } from './db/index.ts';
import { defaultDataDir, hubPaths } from './paths.ts';
import { createClaudeClient } from './services/claude.ts';
import { createJobQueue } from './services/jobs.ts';
import { registerVision } from './services/vision.ts';

const paths = hubPaths(defaultDataDir());
const config = createConfigStore(paths.configFile);

const ctx: AppContext = {
  db: openDb(paths.dbFile),
  paths,
  config,
  now: () => new Date(),
  timeZone: () => hubTimeZone(config.get()),
  remoteAddress: (c) => getConnInfo(c).remote.address ?? '',
  jobs: createJobQueue(),
  claude: unavailableClaude,
  mac: unavailableMac,
  git: unavailableGit,
};

// Claude goes through the gateway once setup has saved it. A failed reading is
// marked on the photo, so this is safe to try without it.
{
  const anthropic = config.get().anthropic;
  if (anthropic.baseURL && anthropic.authToken) ctx.claude = createClaudeClient(anthropic);
}
registerVision();

const { port } = config.get();
serve({ fetch: createApp(ctx).fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`Hub running at http://localhost:${port}`);
});
