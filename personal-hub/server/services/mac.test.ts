import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../../shared/types.ts';
import { UnavailableError } from '../context.ts';
import { hubPaths, type HubPaths } from '../paths.ts';
import { createMacBridge, execFileRun, type Run } from './mac.ts';

const FROM = new Date('2026-11-22T06:00:00.000Z');
const TO = new Date('2026-11-23T06:00:00.000Z');

const event = (id: string, title: string, start: string, end: string): CalendarEvent => ({
  id,
  title,
  start,
  end,
  allDay: false,
  calendar: 'Classes',
  color: '#8e9bf0',
  location: null,
  notes: null,
  url: null,
});

type Call = { cmd: string; args: string[] };
const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' });
const exit = (code: number, stdout = '', stderr = '') => ({ code, stdout, stderr });

/** A `Run` that answers the calendar helper and osascript separately, and records every call. */
function fakeRun(answers: { helper?: Awaited<ReturnType<Run>>; osascript?: Awaited<ReturnType<Run>>; other?: Awaited<ReturnType<Run>> }) {
  const calls: Call[] = [];
  const run: Run = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd.endsWith('/calendar-helper')) return answers.helper ?? exit(127);
    if (cmd === 'osascript') return answers.osascript ?? exit(1);
    return answers.other ?? ok('');
  };
  return { run, calls };
}

let dir: string;
let paths: HubPaths;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-mac-'));
  paths = hubPaths(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('calendar', () => {
  it('parses helper output', async () => {
    const events = [
      event('a', 'STAT 251 lecture', '2026-11-22T16:30:00.000Z', '2026-11-22T17:20:00.000Z'),
      event('b', 'Office hours', '2026-11-22T21:00:00.000Z', '2026-11-22T22:00:00.000Z'),
    ];
    const { run, calls } = fakeRun({ helper: ok(JSON.stringify(events)) });

    const out = await createMacBridge(paths, run).calendarEvents(FROM, TO);

    expect(out.source).toBe('eventkit');
    expect(out.events).toHaveLength(2);
    expect(out.events).toEqual(events);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['events', '--from', FROM.toISOString(), '--to', TO.toISOString()]);
  });

  it('falls back to Calendar app on denied', async () => {
    const { run, calls } = fakeRun({ helper: exit(2, '{"error":"denied"}'), osascript: ok('[]\n') });

    const out = await createMacBridge(paths, run).calendarEvents(FROM, TO);

    expect(out).toEqual({ events: [], source: 'calendar-app' });
    const [script, ...range] = calls[1]?.args.slice(2) ?? [];
    expect(calls[1]?.args.slice(0, 2)).toEqual(['-l', 'JavaScript']);
    expect(script).toMatch(/server\/services\/calendar-jxa\.js$/);
    expect(range).toEqual([FROM.toISOString(), TO.toISOString()]);
  });

  it('falls back to Calendar app when the helper is not built', async () => {
    const events = [event('a', 'Office hours', '2026-11-22T21:00:00.000Z', '2026-11-22T22:00:00.000Z')];
    const { run } = fakeRun({ helper: exit(127), osascript: ok(JSON.stringify(events)) });

    const out = await createMacBridge(paths, run).calendarEvents(FROM, TO);

    expect(out).toEqual({ events, source: 'calendar-app' });
  });

  it('both failing is unavailable', async () => {
    const { run } = fakeRun({ helper: exit(2, '{"error":"denied"}'), osascript: exit(1, '', 'Not authorized') });

    const err = await createMacBridge(paths, run).calendarEvents(FROM, TO).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnavailableError);
    expect((err as Error).message).toBe('Calendar access not granted');
  });

  it('treats unreadable helper output as a failure', async () => {
    const { run } = fakeRun({ helper: ok('not json'), osascript: ok('[{"title":42}]') });

    await expect(createMacBridge(paths, run).calendarEvents(FROM, TO)).rejects.toBeInstanceOf(UnavailableError);
  });

  it('calendarStatus reads the helper status', async () => {
    const status = (helper: Awaited<ReturnType<Run>>) => createMacBridge(paths, fakeRun({ helper }).run).calendarStatus();

    expect(await status(ok('{"authorized":true}'))).toBe('granted');
    expect(await status(ok('{"authorized":false}'))).toBe('denied');
    expect(await status(exit(127))).toBe('missing');
  });
});

describe('images', () => {
  it('convertImage args', async () => {
    const { run, calls } = fakeRun({});
    const src = join(dir, 'IMG_0001.heic');
    const dest = join(dir, 'IMG_0001.jpg');

    await createMacBridge(paths, run).convertImage(src, dest, 2000);

    expect(calls).toEqual([{ cmd: 'sips', args: ['-s', 'format', 'jpeg', '-Z', '2000', src, '--out', dest] }]);
  });

  it('convertImage fails when sips fails', async () => {
    const { run } = fakeRun({ other: exit(13, '', 'Error: Unable to render destination image') });

    await expect(createMacBridge(paths, run).convertImage('a.heic', 'a.jpg', 2000)).rejects.toThrow(/sips/);
  });
});

describe('media (Task 15)', () => {
  it('is not set up yet', async () => {
    const mac = createMacBridge(paths, fakeRun({}).run);

    expect(await mac.mediaStatus()).toBe('missing');
    await expect(mac.mediaKey('play')).rejects.toBeInstanceOf(UnavailableError);
    await expect(mac.nowPlaying()).rejects.toBeInstanceOf(UnavailableError);
  });
});

describe('execFileRun', () => {
  it('returns the exit code and output', async () => {
    expect(await execFileRun('sh', ['-c', 'echo out; echo err >&2; exit 3'])).toEqual({ code: 3, stdout: 'out\n', stderr: 'err\n' });
  });

  it('feeds input on stdin', async () => {
    expect(await execFileRun('cat', [], { input: 'hello' })).toMatchObject({ code: 0, stdout: 'hello' });
  });

  it('reports a missing program as 127', async () => {
    expect(await execFileRun(join(dir, 'no-such-helper'), [])).toMatchObject({ code: 127 });
  });

  it('stops a program that runs past its timeout', async () => {
    const started = Date.now();
    const out = await execFileRun('sleep', ['5'], { timeoutMs: 100 });
    expect(out.code).toBe(124);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
