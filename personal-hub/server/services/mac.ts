import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CalendarEvent, NowPlaying } from '../../shared/types.ts';
import { UnavailableError, type MacBridge } from '../context.ts';
import type { HubPaths } from '../paths.ts';

/** Runs a program to completion. Never rejects: a program that can't start or is stopped gets a shell-style code. */
export type Run = (
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number; input?: string },
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** The code `Run` gives a program that doesn't exist (the shell's "command not found"). */
export const NOT_FOUND = 127;
/** The code `Run` gives a program it stopped at its timeout (as `timeout(1)` does). */
export const TIMED_OUT = 124;

const DEFAULT_TIMEOUT_MS = 30_000;

export const execFileRun: Run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { encoding: 'utf8', timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) return resolve({ code: 0, stdout, stderr });
        const code =
          typeof err.code === 'number' ? err.code
          : err.code === 'ENOENT' ? NOT_FOUND
          : err.killed ? TIMED_OUT
          : 1;
        resolve({ code, stdout, stderr: stderr || err.message });
      },
    );
    // Ignore EPIPE from a program that exits without reading its input.
    child.stdin?.on('error', () => {});
    child.stdin?.end(opts.input);
  });

// The Swift helpers are built into the repo's mac/bin by scripts/build-helpers.sh,
// so they are found from this file, not from the data folder.
const MAC_BIN = fileURLToPath(new URL('../../mac/bin/', import.meta.url));
const CALENDAR_HELPER = join(MAC_BIN, 'calendar-helper');
const CALENDAR_JXA = fileURLToPath(new URL('./calendar-jxa.js', import.meta.url));
const MEDIA_HELPER = join(MAC_BIN, 'media-helper');

/** The helper's code when macOS hasn't granted it calendar access. */
const HELPER_DENIED = 2;

/** Where the bridge says why a Mac service failed. Never given program output, which may hold event details. */
export type MacLog = (message: string) => void;

/** Why a calendar read failed, from its code and stderr only: `exit 2 (not authorized)`, `exit 0 (unreadable output)`. */
function failure(out: { code: number; stderr: string }): string {
  if (out.code === 0) return 'exit 0 (unreadable output)';
  const meaning =
    out.code === HELPER_DENIED ? ' (not authorized)'
    : out.code === NOT_FOUND ? ' (not found)'
    : out.code === TIMED_OUT ? ' (timed out)'
    : '';
  // stderr is the program's account of its failure, safe to log; stdout is its data (event titles and notes), never logged.
  const stderr = out.stderr.trim().slice(0, 500);
  return `exit ${out.code}${meaning}${stderr ? `: ${stderr}` : ''}`;
}

/**
 * The hub's reach into macOS: Calendar through the calendar-helper (EventKit),
 * with the Calendar app over osascript as the fallback; images through `sips`;
 * staying awake through `caffeinate`. `paths` is the data folder, which none of
 * these need yet. `log` hears why a calendar read fell back or failed.
 */
export function createMacBridge(
  paths: HubPaths,
  run: Run = execFileRun,
  log: MacLog = (message) => console.error(message),
): MacBridge {
  let caffeinate: ChildProcess | null = null;

  return {
    // ── Calendar ──────────────────────────────────────────────────────────
    async calendarEvents(from, to) {
      const [fromIso, toIso] = [from.toISOString(), to.toISOString()];

      const helper = await run(CALENDAR_HELPER, ['events', '--from', fromIso, '--to', toIso], { timeoutMs: 20_000 });
      const fromHelper = helper.code === 0 ? parseEvents(helper.stdout) : null;
      if (fromHelper) return { events: fromHelper, source: 'eventkit' };

      // Denied (macOS refuses the helper, e.g. when the hub runs under launchd),
      // not built yet, or broken: ask the Calendar app instead. It is slower and
      // misses repeating events whose series began before the range.
      log(`Calendar helper failed, ${failure(helper)}; reading the Calendar app instead`);
      const jxa = await run('osascript', ['-l', 'JavaScript', CALENDAR_JXA, fromIso, toIso], { timeoutMs: 45_000 });
      const fromApp = jxa.code === 0 ? parseEvents(jxa.stdout) : null;
      if (fromApp) return { events: fromApp, source: 'calendar-app' };

      log(`Calendar app read failed, ${failure(jxa)}`);
      throw new UnavailableError('Calendar access not granted');
    },

    async calendarStatus() {
      const out = await run(CALENDAR_HELPER, ['status'], { timeoutMs: 10_000 });
      if (out.code === NOT_FOUND) return 'missing';
      return out.code === 0 && parseJson(out.stdout)?.authorized === true ? 'granted' : 'denied';
    },

    // ── Images ────────────────────────────────────────────────────────────
    async convertImage(src, dest, maxPixels) {
      const out = await run('sips', ['-s', 'format', 'jpeg', '-Z', String(maxPixels), src, '--out', dest], {
        timeoutMs: 60_000,
      });
      if (out.code === NOT_FOUND) throw new UnavailableError('sips is not available on this machine');
      if (out.code !== 0) throw new Error(`sips couldn't convert the image (exit ${out.code}): ${out.stderr.trim()}`);
    },

    // ── Media ─────────────────────────────────────────────────────────────
    // The now-playing panel is experimental: `media-helper` posts the keyboard's
    // media keys and reads MediaRemote. Track details (like calendar titles) are
    // never logged; only a failure's exit code and stderr are.
    async mediaKey(key) {
      const out = await run(MEDIA_HELPER, ['key', key], { timeoutMs: 10_000 });
      if (out.code === 0) return;
      log(`Media key failed, ${failure(out)}`);
      if (out.code === HELPER_DENIED) throw new UnavailableError('Media controls need Accessibility access');
      if (out.code === NOT_FOUND) throw new UnavailableError('Media controls are not set up yet');
      throw new Error(`The media key didn't go through (exit ${out.code})`);
    },
    async nowPlaying() {
      const out = await run(MEDIA_HELPER, ['now'], { timeoutMs: 10_000 });
      if (out.code === NOT_FOUND) return null;
      if (out.code !== 0) {
        log(`Now playing unavailable, ${failure(out)}`);
        return null;
      }
      const track = parseNowPlaying(out.stdout);
      if (!track) log(`Now playing unreadable, ${failure(out)}`);
      return track;
    },
    async mediaStatus() {
      const out = await run(MEDIA_HELPER, ['status'], { timeoutMs: 10_000 });
      if (out.code !== 0) return 'missing';
      const value = parseJson(out.stdout)?.accessibility;
      if (value === true) return 'ready';
      return value === false ? 'no-accessibility' : 'missing';
    },

    // ── Power ─────────────────────────────────────────────────────────────
    /** `caffeinate -s` keeps the Mac awake on power; `-w` ends it with the hub. */
    keepAwake(on) {
      if (on && !caffeinate) {
        const child = spawn('caffeinate', ['-s', '-w', String(process.pid)], { stdio: 'ignore' });
        child.unref();
        const forget = () => {
          if (caffeinate === child) caffeinate = null;
        };
        child.on('error', forget);
        child.on('exit', forget);
        caffeinate = child;
      } else if (!on && caffeinate) {
        caffeinate.kill();
        caffeinate = null;
      }
    },
  };
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isString = (v: unknown): v is string => typeof v === 'string';
const optionalString = (v: unknown): string | null => (isString(v) && v !== '' ? v : null);

/** The media helper's JSON as a track, or null if it isn't one. A null title means no player, not a broken reply. */
function parseNowPlaying(text: string): NowPlaying | null {
  const value = parseJson(text);
  if (!value || !isString(value.title) || !isString(value.artist)) return null;
  return {
    title: value.title,
    artist: value.artist,
    album: optionalString(value.album),
    artwork: optionalString(value.artwork),
    playing: value.playing === true,
  };
}

/** The helper's (or the JXA script's) JSON as events, or null if it isn't a list of events. */
function parseEvents(text: string): CalendarEvent[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;

  const events: CalendarEvent[] = [];
  for (const item of value as Record<string, unknown>[]) {
    const { id, title, start, end } = item ?? {};
    if (!isString(id) || !isString(title) || !isString(start) || !isString(end)) return null;
    events.push({
      id,
      title,
      start,
      end,
      allDay: item.allDay === true,
      calendar: isString(item.calendar) ? item.calendar : '',
      color: isString(item.color) && /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#8c93b0',
      location: optionalString(item.location),
      notes: optionalString(item.notes),
      url: optionalString(item.url),
    });
  }
  return events;
}
