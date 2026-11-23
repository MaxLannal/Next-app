// The parts of scripts/setup.ts that are decisions rather than commands: filling
// in the config from the environment, and writing the launchd plist. Kept apart
// from the script so they can be tested.
import type { DeepPartial, HubConfig } from '../server/config.ts';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const LAUNCH_AGENT_LABEL = 'com.personalhub.server';

/**
 * Which gateway the config gets when it has none yet: the shell's
 * ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN. A config that already names a
 * gateway is left as it is, which keeps a re-run from swapping it.
 */
export function configFromEnv(env: Record<string, string | undefined>): DeepPartial<HubConfig> {
  const baseURL = env.ANTHROPIC_BASE_URL?.trim() || null;
  const authToken = env.ANTHROPIC_AUTH_TOKEN?.trim() || null;
  return baseURL === null && authToken === null ? {} : { anthropic: { baseURL, authToken, model: DEFAULT_MODEL } };
}

/** The models to try, in order: the configured one, then `$ANTHROPIC_MODEL` when it differs. */
export function modelCandidates(configured: string, envModel: string | undefined): string[] {
  const fallback = envModel?.trim() ?? '';
  return fallback !== '' && fallback !== configured ? [configured, fallback] : [configured];
}

/**
 * The plist with `@@NAME@@` placeholders filled in. Values go in XML-escaped:
 * a path may hold `&` or `<`.
 */
export function fillPlist(template: string, values: Record<string, string>): string {
  return template.replace(/@@([A-Z_]+)@@/g, (match, name: string) => {
    if (!(name in values)) return match;
    return values[name].replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  });
}
