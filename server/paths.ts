import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type HubPaths = {
  dataDir: string;
  dbFile: string;
  filesDir: string;
  repoDir: string;
  backupsDir: string;
  logsDir: string;
  configFile: string;
  tmpDir: string;
};

/** The data folder: `$HUB_DATA_DIR` when set, else `~/PersonalHub`. */
export function defaultDataDir(): string {
  const fromEnv = process.env.HUB_DATA_DIR;
  return fromEnv ? resolve(fromEnv) : join(homedir(), 'PersonalHub');
}

/** Every location under the data folder. Creates the folders. */
export function hubPaths(dataDir: string): HubPaths {
  const paths: HubPaths = {
    dataDir,
    dbFile: join(dataDir, 'hub.db'),
    filesDir: join(dataDir, 'files'),
    repoDir: join(dataDir, 'repo'),
    backupsDir: join(dataDir, 'backups'),
    logsDir: join(dataDir, 'logs'),
    configFile: join(dataDir, 'config.json'),
    tmpDir: join(dataDir, 'tmp'),
  };
  for (const dir of [paths.filesDir, paths.repoDir, paths.backupsDir, paths.logsDir, paths.tmpDir]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}
