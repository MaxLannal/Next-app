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
let logs: string[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-mac-'));
  paths = hubPaths(dir);
  logs = [];
});
const bridge = (run: Run) => createMacBridge(paths, run, (message) => logs.push(message));
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

    const out = await bridge(run).calendarEvents(FROM, TO);

    expect(out.source).toBe('eventkit');
    expect(out.events).toHaveLength(2);
    expect(out.events).toEqual(events);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['events', '--from', FROM.toISOString(), '--to', TO.toISOString()]);
    expect(logs).toEqual([]);
  });

  it('falls back to Calendar app on denied', async () => {
    const { run, calls } = fakeRun({ helper: exit(2, '{"error":"denied"}'), osascript: ok('[]\n') });

    const out = await bridge(run).calendarEvents(FROM, TO);

    expect(out).toEqual({ events: [], source: 'calendar-app' });
    const [script, ...range] = calls[1]?.args.slice(2) ?? [];
    expect(calls[1]?.args.slice(0, 2)).toEqual(['-l', 'JavaScript']);
    expect(script).toMatch(/server\/services\/calendar-jxa\.js$/);
    expect(range).toEqual([FROM.toISOString(), TO.toISOString()]);
  });

  it('falls back to Calendar app when the helper is not built', async () => {
    const events = [event('a', 'Office hours', '2026-11-22T21:00:00.000Z', '2026-11-22T22:00:00.000Z')];
    const { run } = fakeRun({ helper: exit(127), osascript: ok(JSON.stringify(events)) });

    const out = await bridge(run).calendarEvents(FROM, TO);

    expect(out).toEqual({ events, source: 'calendar-app' });
  });

  it('both failing is unavailable', async () => {
    const { run } = fakeRun({ helper: exit(2, '{"error":"denied"}'), osascript: exit(1, '', 'Not authorized') });

    const err = await bridge(run).calendarEvents(FROM, TO).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnavailableError);
    expect((err as Error).message).toBe('Calendar access not granted');
  });

  it('a fallback logs why, never the output', async () => {
    const secret = JSON.stringify([event('a', 'Dentist at 9', '2026-11-22T15:00:00.000Z', '2026-11-22T16:00:00.000Z')]);
    const { run } = fakeRun({
      helper: exit(1, secret, '  Fatal error: Unexpectedly found nil\n'),
      osascript: exit(1, secret, 'execution error: Calendar got an error: Application isn’t running. (-600)\n'),
    });

    await expect(bridge(run).calendarEvents(FROM, TO)).rejects.toBeInstanceOf(UnavailableError);

    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain('exit 1');
    expect(logs[0]).toContain('Fatal error: Unexpectedly found nil');
    expect(logs[1]).toContain('exit 1');
    expect(logs[1]).toContain('Application isn’t running. (-600)');
    expect(logs.join('\n')).not.toContain('Dentist');
  });

  it('a denied helper is logged as such', async () => {
    const { run } = fakeRun({ helper: exit(2, '{"error":"denied"}'), osascript: ok('[]') });

    await bridge(run).calendarEvents(FROM, TO);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/exit 2.*not authorized/);
  });

  it('treats unreadable helper output as a failure', async () => {
    const events = [event('a', 'Office hours', '2026-11-22T21:00:00.000Z', '2026-11-22T22:00:00.000Z')];
    const { run } = fakeRun({ helper: ok('not json'), osascript: ok(JSON.stringify(events)) });

    const out = await bridge(run).calendarEvents(FROM, TO);

    expect(out).toEqual({ events, source: 'calendar-app' });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('unreadable output');
    expect(logs[0]).not.toContain('not json');
  });

  it('unreadable Calendar app output is unavailable', async () => {
    const { run } = fakeRun({ helper: exit(2), osascript: ok('[{"title":42}]') });

    await expect(bridge(run).calendarEvents(FROM, TO)).rejects.toBeInstanceOf(UnavailableError);
    expect(logs[1]).toContain('unreadable output');
  });

  it('calendarStatus reads the helper status', async () => {
    const status = (helper: Awaited<ReturnType<Run>>) => bridge(fakeRun({ helper }).run).calendarStatus();

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

    await bridge(run).convertImage(src, dest, 2000);

    // Its size is read first; not knowing it, or over the limit, it is resized as it converts.
    expect(calls).toEqual([
      { cmd: 'sips', args: ['-g', 'pixelWidth', '-g', 'pixelHeight', src] },
      { cmd: 'sips', args: ['-s', 'format', 'jpeg', '-Z', '2000', src, '--out', dest] },
    ]);
  });

  it('convertImage never enlarges an image already within the limit', async () => {
    const { run, calls } = fakeRun({ other: ok(`/x/forest.jpg\n  pixelWidth: 1500\n  pixelHeight: 844\n`) });

    await bridge(run).convertImage('forest.jpg', 'forest-out.jpg', 3840);

    expect(calls.at(-1)).toEqual({ cmd: 'sips', args: ['-s', 'format', 'jpeg', 'forest.jpg', '--out', 'forest-out.jpg'] });
  });

  it('convertImage fails when sips fails', async () => {
    const { run } = fakeRun({ other: exit(13, '', 'Error: Unable to render destination image') });

    await expect(bridge(run).convertImage('a.heic', 'a.jpg', 2000)).rejects.toThrow(/sips/);
  });
});

describe('media (Task 15)', () => {
  /** A `Run` that answers the media helper, and logs every call. */
  function mediaRun(answer: Awaited<ReturnType<Run>>) {
    const calls: Call[] = [];
    const run: Run = async (cmd, args) => {
      calls.push({ cmd, args });
      return answer;
    };
    return { run, calls };
  }

  it('mediaStatus maps to ready / no-accessibility / missing', async () => {
    const status = async (answer: Awaited<ReturnType<Run>>) => bridge(mediaRun(answer).run).mediaStatus();

    expect(await status(ok('{"accessibility":true}'))).toBe('ready');
    expect(await status(ok('{"accessibility":false}'))).toBe('no-accessibility');
    expect(await status(exit(127))).toBe('missing');
    expect(await status(ok('not json'))).toBe('missing');
  });

  it('mediaKey posts the right arg', async () => {
    const { run, calls } = mediaRun(ok(''));
    const mac = bridge(run);

    await mac.mediaKey('play');
    await mac.mediaKey('next');
    await mac.mediaKey('previous');

    expect(calls.map((c) => c.args)).toEqual([['key', 'play'], ['key', 'next'], ['key', 'previous']]);
    for (const call of calls) expect(call.cmd).toMatch(/mac\/bin\/media-helper$/);
  });

  it('mediaKey without accessibility fails with the grant needed', async () => {
    const denied: Run = async () => exit(2, '{"error":"no-accessibility"}');

    const err = await bridge(denied).mediaKey('play').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnavailableError);
    expect(logs.some((m) => m.includes('exit 2') && m.includes('not authorized'))).toBe(true);
  });

  it('nowPlaying parses the track', async () => {
    const track = { title: 'Pink + White', artist: 'Frank Ocean', album: 'Blonde', artwork: 'data:image/jpeg;base64,AAA', playing: true };
    const { run, calls } = mediaRun(ok(JSON.stringify(track)));

    expect(await bridge(run).nowPlaying()).toEqual(track);
    expect(calls[0]?.args).toEqual(['now']);
  });

  it('nowPlaying absorbs a missing album and artwork', async () => {
    const { run } = mediaRun(ok(JSON.stringify({ title: 'Pink + White', artist: 'Frank Ocean', playing: false })));

    expect(await bridge(run).nowPlaying()).toEqual({
      title: 'Pink + White',
      artist: 'Frank Ocean',
      album: null,
      artwork: null,
      playing: false,
    });
  });

  it('nowPlaying unavailable returns null', async () => {
    const unavailable = (answer: Awaited<ReturnType<Run>>) => bridge(mediaRun(answer).run).nowPlaying();

    expect(await unavailable(exit(3, '{"error":"unavailable"}'))).toBeNull();
    expect(await unavailable(exit(127))).toBeNull();
    expect(await unavailable(ok('not json'))).toBeNull();
  });

  it('never logs track details', async () => {
    const { run } = mediaRun(exit(3, '{"title":"Pink + White"}', 'MediaRemote answered 3'));
    await bridge(run).nowPlaying();

    expect(logs.join('\n')).not.toContain('Pink');
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
