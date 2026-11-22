import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createApp } from './app.ts';
import { createConfigStore, hubTimeZone } from './config.ts';
import { unavailableClaude, unavailableGit, unavailableMac, type AppContext } from './context.ts';
import { openDb } from './db/index.ts';
import { defaultDataDir, hubPaths } from './paths.ts';
import { createJobQueue } from './services/jobs.ts';

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

const { port } = config.get();
serve({ fetch: createApp(ctx).fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`Hub running at http://localhost:${port}`);
});
