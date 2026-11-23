import { readdirSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { makeTestContext, type TestContext } from '../test/helpers.ts';
import { startRoutines } from './routines.ts';

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

it('backups at boot and keeps the Mac awake when Settings says so', () => {
  t.config.update({ keepAwake: true });
  const routines = startRoutines(t);
  try {
    expect(t.fakes.mac.calls.keepAwake).toEqual([[true]]);
    expect(readdirSync(t.paths.backupsDir)).toContain('hub-2026-11-22.db');
  } finally {
    routines.stop();
  }
  expect(t.fakes.mac.calls.keepAwake.at(-1)).toEqual([false]);
});

it('leaves the Mac’s sleep alone when keep-awake is off', () => {
  const routines = startRoutines(t);
  try {
    expect(t.fakes.mac.calls.keepAwake).toEqual([]);
  } finally {
    routines.stop();
  }
});

it('a failed backup is logged and the hub carries on', () => {
  const logged: string[] = [];
  // The backup folder is gone, so the copy can't be written.
  rmSync(t.paths.backupsDir, { recursive: true, force: true });
  const routines = startRoutines(t, (m) => logged.push(m));
  routines.stop();
  expect(logged.some((m) => m.startsWith('Backup failed:'))).toBe(true);
});
