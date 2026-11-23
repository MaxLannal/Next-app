import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configFromEnv, fillPlist, modelCandidates } from './setup-config.ts';

describe('configFromEnv', () => {
  it('copies the gateway and keeps the default model', () => {
    expect(configFromEnv({ ANTHROPIC_BASE_URL: 'https://gateway.example', ANTHROPIC_AUTH_TOKEN: 'sk-1' })).toEqual({
      anthropic: { baseURL: 'https://gateway.example', authToken: 'sk-1', model: 'claude-opus-5-5' },
    });
  });

  it('asks for nothing when the shell has no gateway', () => {
    expect(configFromEnv({})).toEqual({});
    expect(configFromEnv({ ANTHROPIC_MODEL: 'other-model' })).toEqual({});
  });

  it('ignores blank values', () => {
    expect(configFromEnv({ ANTHROPIC_BASE_URL: '  ', ANTHROPIC_AUTH_TOKEN: '' })).toEqual({});
  });
});

describe('modelCandidates', () => {
  it('tries the configured model, then the shell’s when it differs', () => {
    expect(modelCandidates('claude-opus-5-5', 'gateway-model')).toEqual(['claude-opus-5-5', 'gateway-model']);
  });

  it('doesn’t repeat the same model', () => {
    expect(modelCandidates('claude-opus-5-5', 'claude-opus-5-5')).toEqual(['claude-opus-5-5']);
    expect(modelCandidates('claude-opus-5-5', ' ')).toEqual(['claude-opus-5-5']);
    expect(modelCandidates('claude-opus-5-5', undefined)).toEqual(['claude-opus-5-5']);
  });
});

describe('the launchd plist', () => {
  const template = readFileSync(join(process.cwd(), 'scripts/launchd.plist.template'), 'utf8');

  it('runs Node on server/main.ts, with the data folder in the environment and logs under it', () => {
    const plist = fillPlist(template, {
      NODE: '/opt/node/bin/node',
      MAIN: '/Users/you/personal-hub/server/main.ts',
      HUB_DIR: '/Users/you/personal-hub',
      DATA_DIR: '/Users/you/PersonalHub',
      LOG_DIR: '/Users/you/PersonalHub/logs',
    });
    expect(plist).toContain('<string>com.personalhub.server</string>');
    expect(plist).toContain('<string>/opt/node/bin/node</string>\n    <string>/Users/you/personal-hub/server/main.ts</string>');
    expect(plist).toContain('<key>HUB_DATA_DIR</key>\n    <string>/Users/you/PersonalHub</string>');
    expect(plist).toContain('<string>/Users/you/PersonalHub/logs/hub.log</string>');
    expect(plist).toContain('<key>KeepAlive</key>\n  <true/>');
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(plist).not.toContain('@@');
  });

  it('escapes a path that holds XML characters', () => {
    const plist = fillPlist(template, { NODE: '/a&b/node', MAIN: 'x', HUB_DIR: 'x', DATA_DIR: '<data>', LOG_DIR: 'x' });
    expect(plist).toContain('/a&amp;b/node');
    expect(plist).toContain('&lt;data&gt;');
  });
});
