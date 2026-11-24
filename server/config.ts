import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export type HubConfig = {
  port: number;
  timeZone: string | null;
  passcodeHash: string | null;
  sessionSecret: string;
  hubToken: string;
  anthropic: { baseURL: string | null; authToken: string | null; model: string };
  github: { repo: string | null };
  /** The Mapbox access token the Traces globe draws its tiles with. */
  mapbox: { token: string | null };
  /** The dashboard's wallpaper, a file in `files/wallpaper/`; null for the fog photograph. */
  wallpaper: { file: string | null };
  keepAwake: boolean;
  sleepTargetHours: number;
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type ConfigStore = {
  get(): HubConfig;
  update(patch: DeepPartial<HubConfig>): HubConfig;
};

const randomSecret = () => randomBytes(32).toString('hex');
const isSecret = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/** The session secret and hub token are always 32 random bytes as hex; anything else is replaced. */
function withSecrets(cfg: HubConfig): HubConfig {
  return {
    ...cfg,
    sessionSecret: isSecret(cfg.sessionSecret) ? cfg.sessionSecret : randomSecret(),
    hubToken: isSecret(cfg.hubToken) ? cfg.hubToken : randomSecret(),
  };
}

function defaults(): HubConfig {
  return {
    port: 4747,
    timeZone: null,
    passcodeHash: null,
    sessionSecret: randomSecret(),
    hubToken: randomSecret(),
    anthropic: { baseURL: null, authToken: null, model: 'claude-opus-5-5' },
    github: { repo: null },
    mapbox: { token: null },
    wallpaper: { file: null },
    keepAwake: false,
    sleepTargetHours: 8,
  };
}

/**
 * Reads `config.json`, filling in defaults and fresh secrets for anything missing,
 * and keeps the file at mode 0600 (it holds the hub token and gateway token).
 */
export function createConfigStore(file: string): ConfigStore {
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : null;
  let current = withSecrets(merge(defaults(), raw === null ? {} : parse(file, raw)));
  if (serialize(current) !== raw) save(file, current);
  else chmodSync(file, 0o600);

  return {
    get: () => current,
    update(patch) {
      current = withSecrets(merge(current, patch));
      save(file, current);
      return current;
    },
  };
}

/** The configured gateway settings, as the file holds them (null before setup writes them). */
export function anthropicSettings(file: string): { baseURL: string | null; authToken: string | null; model: string } {
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : '{}';
  const anthropic = (merge({}, parse(file, raw)) as DeepPartial<HubConfig>).anthropic ?? {};
  return {
    baseURL: typeof anthropic.baseURL === 'string' && anthropic.baseURL !== '' ? anthropic.baseURL : null,
    authToken: typeof anthropic.authToken === 'string' && anthropic.authToken !== '' ? anthropic.authToken : null,
    model: typeof anthropic.model === 'string' && anthropic.model !== '' ? anthropic.model : 'claude-opus-5-5',
  };
}

/** The hub's time zone: the configured one, else the Mac's. */
export function hubTimeZone(cfg: HubConfig): string {
  return cfg.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function parse(file: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Couldn't read ${file}: ${(err as Error).message}`);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-merges plain objects; `undefined` in the patch leaves a value alone. */
function merge<T>(base: T, patch: unknown): T {
  if (!isRecord(base) || !isRecord(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = merge(base[key], value);
  }
  return out as T;
}

const serialize = (cfg: HubConfig) => `${JSON.stringify(cfg, null, 2)}\n`;

function save(file: string, cfg: HubConfig): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, serialize(cfg), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}
