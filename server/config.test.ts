import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createConfigStore } from './config.ts';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-config-'));
  file = join(dir, 'config.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const mode = (path: string) => statSync(path).mode & 0o777;

it('creates the file with defaults and random secrets, mode 0600', () => {
  const cfg = createConfigStore(file).get();

  expect(cfg.sessionSecret).toMatch(/^[0-9a-f]{64}$/);
  expect(cfg.hubToken).toMatch(/^[0-9a-f]{64}$/);
  expect(cfg.hubToken).not.toBe(cfg.sessionSecret);
  expect(cfg).toMatchObject({
    port: 4747,
    timeZone: null,
    passcodeHash: null,
    anthropic: { baseURL: null, authToken: null, model: 'claude-opus-5-5' },
    github: { repo: null },
    keepAwake: false,
    sleepTargetHours: 8,
  });
  expect(mode(file)).toBe(0o600);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(cfg);
});

it('updates merge deeply and persist', () => {
  const first = createConfigStore(file);
  const updated = first.update({ anthropic: { baseURL: 'https://gateway.example' }, keepAwake: true });
  expect(updated.anthropic).toEqual({ baseURL: 'https://gateway.example', authToken: null, model: 'claude-opus-5-5' });

  const second = createConfigStore(file).get();
  expect(second.anthropic.baseURL).toBe('https://gateway.example');
  expect(second.keepAwake).toBe(true);
  expect(second.sessionSecret).toBe(first.get().sessionSecret);
  expect(mode(file)).toBe(0o600);
});

it('replaces empty, null or malformed secrets', () => {
  for (const bad of [{ sessionSecret: '', hubToken: null }, { sessionSecret: 42, hubToken: 'short' }]) {
    writeFileSync(file, JSON.stringify(bad));

    const cfg = createConfigStore(file).get();

    expect(cfg.sessionSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(cfg.hubToken).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(readFileSync(file, 'utf8')).sessionSecret).toBe(cfg.sessionSecret);
  }
});

it('an update cannot blank a secret', () => {
  const store = createConfigStore(file);
  const cfg = store.update({ sessionSecret: '', hubToken: '' });

  expect(cfg.sessionSecret).toMatch(/^[0-9a-f]{64}$/);
  expect(cfg.hubToken).toMatch(/^[0-9a-f]{64}$/);
});

it('fills in what an existing file is missing', () => {
  writeFileSync(file, JSON.stringify({ port: 5000, github: { repo: 'max/notes' } }), { mode: 0o644 });

  const cfg = createConfigStore(file).get();

  expect(cfg.port).toBe(5000);
  expect(cfg.github.repo).toBe('max/notes');
  expect(cfg.sessionSecret).toMatch(/^[0-9a-f]{64}$/);
  expect(cfg.hubToken).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.parse(readFileSync(file, 'utf8')).hubToken).toBe(cfg.hubToken);
  expect(mode(file)).toBe(0o600);
});
