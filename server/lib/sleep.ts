// Sleep analytics: nights from stage samples, the quality score, and the Shortcut's payload.
// Pure functions. Instants are ISO-8601 strings; nights are local day keys in the hub time zone.

import type { SleepNight, SleepSample, SleepStage } from '../../shared/types.ts';
import { parseShortcutDate } from './local-dates.ts';
import { dayKey } from './time.ts';

const HOUR_MS = 3_600_000;
/** Two sleeps more than this apart are different sleeps (an afternoon nap is its own cluster). */
const CLUSTER_GAP_MS = 3 * HOUR_MS;

export const SLEEP_STAGES: readonly SleepStage[] = ['in_bed', 'asleep', 'awake', 'core', 'deep', 'rem'];

/** Core, deep, rem and unspecified all count as sleep; in bed and awake don't. */
const isAsleep = (stage: SleepStage) => stage === 'core' || stage === 'deep' || stage === 'rem' || stage === 'asleep';

/**
 * Health's stage names on a Chinese-language iPhone (简体 and 繁體). The specific stages come
 * first, because 深度睡眠 and 核心睡眠 also contain plain 睡眠.
 */
const CHINESE_STAGES: [RegExp, SleepStage][] = [
  [/卧床|臥床|在床/, 'in_bed'],
  [/清醒|醒着|醒著/, 'awake'],
  [/快速动眼|快速動眼|眼动|眼動/, 'rem'],
  [/深度|深睡/, 'deep'],
  [/核心|浅睡|淺睡|轻度|輕度/, 'core'],
  [/睡眠|睡着|睡著|入睡|未指定/, 'asleep'],
];

/** What a sample's source becomes when the Shortcut leaves it empty, as it does by default. */
export const DEFAULT_SOURCE = 'Apple Health';

const systemTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * A stage name as a Shortcut or a health export writes it: `Core`, `REM`, `In Bed`, `Awake`,
 * `Asleep (Core)`, `HKCategoryValueSleepAnalysisAsleepDeep` → a stage. Null when it isn't one.
 */
export function stageFrom(value: string): SleepStage | null {
  const chinese = CHINESE_STAGES.find(([pattern]) => pattern.test(value));
  if (chinese) return chinese[1];
  // HealthKit's own values, matched whole: `HKCategoryValueSleepAnalysisAsleepREM` would otherwise
  // read as plain `Asleep`.
  const health = value.trim();
  if (health === 'HKCategoryValueSleepAnalysisInBed') return 'in_bed';
  if (health === 'HKCategoryValueSleepAnalysisAsleepUnspecified' || health === 'HKCategoryValueSleepAnalysisAsleep') return 'asleep';
  if (health === 'HKCategoryValueSleepAnalysisAwake') return 'awake';
  if (health === 'HKCategoryValueSleepAnalysisAsleepCore') return 'core';
  if (health === 'HKCategoryValueSleepAnalysisAsleepDeep') return 'deep';
  if (health === 'HKCategoryValueSleepAnalysisAsleepREM') return 'rem';
  // The qualifiers HealthKit puts after Asleep, with or without its prefix. A qualifier that
  // isn't one of these (`Nap`) is not a stage: it falls through to null.
  for (const prefix of ['HKCategoryValueSleepAnalysisAsleep', 'Asleep']) {
    if (!health.startsWith(prefix) || health === prefix) continue;
    const rest = health.slice(prefix.length).toLowerCase();
    if (rest === 'core' || rest === 'light') return 'core';
    if (rest === 'deep') return 'deep';
    if (rest === 'rem') return 'rem';
    if (rest === 'unspecified') return 'asleep';
  }
  const words = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^hkcategoryvaluesleepanalysis/, '')
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(' ');
  // `Asleep (Core)` writes the stage in brackets; last one wins.
  const stage = words[words.length - 1] ?? '';
  if (words.includes('in') && words.includes('bed')) return 'in_bed';
  if (stage === 'awake') return 'awake';
  if (stage === 'core' || stage === 'light') return 'core';
  if (stage === 'deep') return 'deep';
  if (stage === 'rem') return 'rem';
  if (stage === 'asleep' || stage === 'unspecified' || stage === 'sleeping') return 'asleep';
  return null;
}

/** A source whose name says Watch, however the Shortcut typed it. */
export const isWatchSource = (source: string) => /\bwatch\b/i.test(source);

/** In bed wraps the stages it holds; awake beats a stage that says the same minutes were sleep. */
const RANK: Record<SleepStage, number> = { in_bed: 0, awake: 1, asleep: 2, rem: 3, core: 4, deep: 5 };

/** Length in seconds of the union of [start, end) ranges: overlapping ranges count once. */
function unionSeconds(spans: { start: number; end: number }[]): number {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let total = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  for (const s of sorted) {
    const from = Math.max(s.start, cursor);
    if (s.end > from) total += s.end - from;
    cursor = Math.max(cursor, s.end);
  }
  return Math.round(total / 1000);
}

/** The parts of [start, end) not already covered by `covered`, so a re-sent window adds nothing new. */
function uncovered(start: number, end: number, covered: { start: number; end: number }[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let cursor = start;
  for (const c of [...covered].sort((a, b) => a.start - b.start)) {
    if (c.end <= cursor) continue;
    if (c.start > cursor) out.push({ start: cursor, end: Math.min(c.start, end) });
    cursor = Math.max(cursor, c.end);
    if (cursor >= end) break;
  }
  if (cursor < end) out.push({ start: cursor, end });
  return out.filter((p) => p.end > p.start);
}

/**
 * Merges samples of one source into non-overlapping runs. A re-sent sample adds no time: a run
 * keeps its stage over the seconds another sample repeats (Dijkstra's sweep). HealthKit's
 * longest run comes first, so in-bed doesn't swallow the stages it contains, then started
 * earliest, so a stage keeps its minutes rather than a later correction of the same window
 * made by another device of this same source.
 */
function runsOfOne(source: SleepSample[]): { start: number; end: number; stage: SleepStage }[] {
  const parsed = source
    .map((s) => ({ start: Date.parse(s.start), end: Date.parse(s.end), stage: s.stage, span: Date.parse(s.end) - Date.parse(s.start) }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => b.span - a.span || a.start - b.start || RANK[a.stage] - RANK[b.stage]);
  const runs: { start: number; end: number; stage: SleepStage }[] = [];
  for (const s of parsed) {
    for (const part of uncovered(s.start, s.end, runs)) runs.push({ ...part, stage: s.stage });
  }
  return runs.sort((a, b) => a.start - b.start);
}

/**
 * Drops samples a re-sent window repeats or a longer run of the same source already covers.
 * Different sources are all kept: which one counts is decided per night. Order is preserved.
 */
export function dedupeSamples(samples: SleepSample[]): SleepSample[] {
  const runs = new Map<string, { start: number; end: number }[]>();
  const seen: string[] = [];
  return samples.filter((s) => {
    const start = Date.parse(s.start);
    const end = Date.parse(s.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
    const key = `${s.source}\u0000${s.start}\u0000${s.end}\u0000${s.stage}`;
    if (seen.includes(key)) return false;
    seen.push(key);
    const covered = runs.get(s.source) ?? [];
    const fresh = uncovered(start, end, covered);
    if (fresh.length === 0) return false;
    runs.set(s.source, [...covered, { start, end }]);
    return true;
  });
}

type Run = { source: string; start: number; end: number };

/**
 * Nights from stage samples. Samples less than 3 h apart join one cluster; a cluster belongs to
 * the local day its last end falls on. Within a night, one source is counted: the Watch's, else the
 * one with the most asleep time, and any of its runs that overlap the night's chosen sleep are left
 * out, so a Watch and an iPhone recording the same night never add up. `asleep` sums core, deep,
 * rem and unspecified; `inBed` is the larger of the in-bed runs and bedtime → wake.
 * Oldest night first.
 */
export function groupNights(samples: SleepSample[], tz: string, targetHours: number): SleepNight[] {
  const clean = dedupeSamples(samples);

  const bySource = new Map<string, SleepSample[]>();
  for (const s of clean) {
    const list = bySource.get(s.source) ?? [];
    list.push(s);
    bySource.set(s.source, list);
  }

  // Each cluster of each source, and the night it ended on.
  const clusters: (Run & { night: string; asleep: number })[] = [];
  for (const [source, list] of bySource) {
    const sorted = list
      .map((s) => ({ ...s, startMs: Date.parse(s.start), endMs: Date.parse(s.end) }))
      .sort((a, b) => a.startMs - b.startMs);
    let open: typeof sorted = [];
    const flush = () => {
      if (open.length === 0) return;
      const start = Math.min(...open.map((s) => s.startMs));
      const end = Math.max(...open.map((s) => s.endMs));
      const asleep = unionSeconds(open.filter((s) => isAsleep(s.stage)).map((s) => ({ start: s.startMs, end: s.endMs })));
      // The night is the local day its last end falls on (UTC−6 puts 01:00 local on tomorrow).
      clusters.push({ source, start, end, asleep, night: dayKey(new Date(end), tz) });
      open = [];
    };
    let lastEnd = Number.NEGATIVE_INFINITY;
    for (const s of sorted) {
      if (open.length > 0 && s.startMs - lastEnd >= CLUSTER_GAP_MS) flush();
      open.push(s);
      lastEnd = Math.max(lastEnd, s.endMs);
    }
    flush();
  }

  const byNight = new Map<string, (Run & { asleep: number })[]>();
  for (const c of clusters) {
    const list = byNight.get(c.night) ?? [];
    list.push(c);
    byNight.set(c.night, list);
  }

  const nights: SleepNight[] = [];
  for (const [night, candidates] of byNight) {
    const recording = pickRecording(candidates);
    let layout = runsOfOne(clean.filter((s) => s.source === recording.source));

    // Keep the night's own sleep: the run that ended it and runs joined to it by short gaps.
    // A run from hours earlier that ends the same day (a nap) is another sleep and stays out.
    layout = layout.filter((r) => r.end > recording.from && r.start < recording.to);

    nights.push(buildNight(night, recording.source, layout, targetHours));
  }
  return nights.sort((a, b) => a.night.localeCompare(b.night));
}

type Recording = { source: string; from: number; to: number };


/**
 * The one recording a night counts, plus any older run of the same source that ends the same sleep
 * (a Watch recording split by a 3 h gap). Never two sources' minutes.
 */
function pickRecording(candidates: (Run & { asleep: number })[]): Recording {
  const ranked = [...candidates].sort((a, b) => {
    const watch = (x: Run & { asleep: number }) => Number(isWatchSource(x.source));
    const byKind = watch(b) - watch(a);
    return byKind !== 0 ? byKind : b.asleep - a.asleep || b.end - a.end;
  });
  const [best] = ranked;
  // Runs of the same source within 3 h of the one that ended the night are the same sleep.
  const joined = ranked.filter((r) => r.source === best.source && best.end - r.end < CLUSTER_GAP_MS);
  return {
    source: best.source,
    from: Math.min(...joined.map((r) => r.start)),
    to: Math.max(...joined.map((r) => r.end)),
  };
}

/** One night's figures and score from the non-overlapping runs that make it. */
function buildNight(night: string, source: string, layout: { start: number; end: number; stage: SleepStage }[], targetHours: number): SleepNight {
  const stages = { awake: 0, rem: 0, core: 0, deep: 0, unspecified: 0 };
  let inBed = 0;
  let asleep = 0;
  for (const r of layout) {
    const seconds = Math.round((r.end - r.start) / 1000);
    if (r.stage === 'in_bed') inBed += seconds;
    else if (r.stage === 'awake') stages.awake += seconds;
    else if (r.stage === 'rem') stages.rem += seconds;
    else if (r.stage === 'core') stages.core += seconds;
    else if (r.stage === 'deep') stages.deep += seconds;
    else stages.unspecified += seconds;
    if (isAsleep(r.stage)) asleep += seconds;
  }
  const bedtime = Math.min(...layout.map((r) => r.start));
  const wake = Math.max(...layout.map((r) => r.end));
  const inBedSeconds = Math.max(inBed, Math.round((wake - bedtime) / 1000));
  const out: SleepNight = {
    night,
    bedtime: new Date(bedtime).toISOString(),
    wake: new Date(wake).toISOString(),
    inBedSeconds,
    asleepSeconds: asleep,
    stages,
    source,
    score: 0,
  };
  out.score = sleepScore(out, targetHours);
  return out;
}

/**
 * The quality score, 0–100: 50% total sleep against `targetHours` (capped), 30% the deep + REM
 * share of sleep against 40%, 20% sleep efficiency (asleep ÷ in bed). With no stage detail
 * (core, deep and rem all zero) the stage part can't be judged, so the rest is reweighted.
 */
export function sleepScore(n: Pick<SleepNight, 'asleepSeconds' | 'inBedSeconds' | 'stages'>, targetHours: number): number {
  const asleep = Math.max(0, n.asleepSeconds);
  const inBed = Math.max(0, n.inBedSeconds);
  const { deep, rem, core } = n.stages;
  const target = targetHours * 3600;
  const a = target > 0 ? Math.min(asleep / target, 1) : 0;
  const e = inBed > 0 ? Math.min(asleep / inBed, 1) : 0;
  if (deep + rem + core === 0) return Math.round((100 * (0.5 * a + 0.2 * e)) / 0.7);
  const stageShare = asleep > 0 ? Math.min((deep + rem) / asleep / 0.4, 1) : 0;
  return Math.round(100 * (0.5 * a + 0.3 * stageShare + 0.2 * e));
}

/**
 * The Shortcut's POST body: JSON `{samples: SleepSample[]}` (or a bare array), or text lines
 * `start;end;value;source`. Throws with the offending value when a line or sample is unusable.
 */
export function parseShortcutPayload(body: string, contentType: string, tz: string = systemTimeZone()): SleepSample[] {
  // The Shortcut sends text as text; a JSON body may still arrive with any content type, so the
  // content settles it first.
  const trimmed = body.trimStart();
  if (/json/i.test(contentType) || trimmed.startsWith('{') || trimmed.startsWith('[')) return parseJson(trimmed, tz);
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^start\s*;/i.test(line))
    .map((line, i) => parseLine(line, i, tz));
}

function parseJson(body: string, tz: string): SleepSample[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('The body is not valid JSON');
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { samples?: unknown } | null)?.samples;
  if (!Array.isArray(list)) throw new Error('Expected {samples: [...]}');
  return list.map((raw, i) => toSample(raw as Record<string, unknown>, `sample ${i + 1}`, tz));
}

function parseLine(line: string, i: number, tz: string): SleepSample {
  const parts = line.split(';').map((p) => p.trim());
  if (parts.length < 3) throw new Error(`Line ${i + 1}: expected start;end;value;source`);
  const [start, end, value, ...source] = parts;
  const stage = stageFrom(value);
  if (!stage) throw new Error(`Line ${i + 1}: unknown sleep value "${value}"`);
  return toSample({ start, end, stage, source: source.join(';') }, `line ${i + 1}`, tz);
}

/**
 * Validates one sample. The stage may come as `stage` or, as the iPhone Shortcut writes it, as
 * `value`; an empty source becomes `DEFAULT_SOURCE`. Dates are read by `parseShortcutDate` in `tz`.
 */
export function toSample(raw: Record<string, unknown>, where: string, tz: string = systemTimeZone()): SleepSample {
  const { start, end } = raw;
  const stage = raw.stage ?? raw.value;
  const startAt = typeof start === 'string' ? parseShortcutDate(start, tz) : null;
  const endAt = typeof end === 'string' ? parseShortcutDate(end, tz) : null;
  if (!startAt) throw new Error(`${where}: "start" is not a time (${JSON.stringify(start)})`);
  if (!endAt) throw new Error(`${where}: "end" is not a time (${JSON.stringify(end)})`);
  if (endAt.getTime() <= startAt.getTime()) throw new Error(`${where}: end is before start`);
  const mapped = typeof stage === 'string' ? stageFrom(stage) : null;
  if (!mapped) throw new Error(`${where}: unknown sleep value "${String(stage)}"`);
  const source = typeof raw.source === 'string' && raw.source.trim() !== '' ? raw.source.trim() : DEFAULT_SOURCE;
  return { start: startAt.toISOString(), end: endAt.toISOString(), stage: mapped, source };
}

