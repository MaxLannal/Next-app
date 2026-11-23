// The chat's tools: read-only views over the hub's data for Claude, each validated with zod and
// answered as compact JSON. They read through the repos, libs and route helpers the pages use,
// so the chat quotes the same figures the hub shows.

import type Anthropic from '@anthropic-ai/sdk';
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { z } from 'zod';
import { plainTextOf } from '../../shared/essayText.ts';
import { isDayKey, type FocusSession, type Goal } from '../../shared/types.ts';
import { formatDuration, formatHours } from '../../web/src/lib/format.ts';
import type { AppContext } from '../context.ts';
import { estimateAccuracy } from '../lib/goals.ts';
import { RESOURCE_KINDS } from '../lib/resources.ts';
import { search } from '../lib/search.ts';
import { addDays, dayKey, rangeBounds } from '../lib/time.ts';
import { listAttachments } from '../repo/attachments.ts';
import { getEssay } from '../repo/essays.ts';
import { doneGoalPlans, getGoal, listGoals } from '../repo/goals.ts';
import { getSession, listSessions, listSubjects } from '../repo/sessions.ts';
import { exerciseReport } from '../routes/exercise.ts';
import { listResources } from '../routes/resources.ts';
import { lastIngest, nightsFrom } from '../routes/sleep.ts';
import { focusBySubject } from '../routes/stats.ts';

/** The most a tool answer may hold, in characters of JSON. */
export const TOOL_OUTPUT_LIMIT = 20_000;

const SEARCH_HITS = 20;
const DEFAULT_SESSIONS = 50;
const MAX_SESSIONS = 200;
const DEFAULT_NIGHTS = 7;
const MAX_NIGHTS = 60;
const NOTE_PREVIEW = 300;
const RANGES = ['day', 'week', 'month', 'year'] as const;

/** A tool call that can't be answered: bad input, an unknown tool, or a missing record. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

const day = z.string().refine(isDayKey, 'must be a real YYYY-MM-DD day');
const id = z.number().int().positive();
const range = z.enum(RANGES);

const DAY_PROP = { type: 'string', format: 'date' } as const;
const RANGE_PROP = {
  type: 'string',
  enum: [...RANGES],
  description: 'day, week (Monday to Sunday), month or year: the one containing `date`',
} as const;

type Spec = {
  name: string;
  description: string;
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  input: z.ZodType;
  run(input: never): unknown;
};

/** Ties one tool's JSON schema (what Claude sees) to its zod schema (what the hub accepts). */
function tool<S extends z.ZodType>(spec: Omit<Spec, 'input' | 'run'> & { input: S; run(input: z.infer<S>): unknown }): Spec {
  return spec as unknown as Spec;
}

const localTime = (iso: string, tz: string) => format(new TZDate(Date.parse(iso), tz), 'yyyy-MM-dd HH:mm');

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * The tools and how to run them. `run` answers compact JSON of at most 20 000 characters
 * (`"truncated": true` when cut), and throws `ToolError` for input it won't take.
 */
export function chatTools(ctx: AppContext): {
  definitions: Anthropic.Tool[];
  run(name: string, input: unknown): Promise<string>;
} {
  const tz = () => ctx.timeZone();
  const today = () => dayKey(ctx.now(), tz());

  const sessionRow = (s: FocusSession) => ({
    id: s.id,
    name: s.name,
    subject: s.subject?.name ?? null,
    tags: s.tags,
    goalId: s.goalId,
    status: s.status,
    started: localTime(s.startedAt, tz()),
    ended: s.endedAt === null ? null : localTime(s.endedAt, tz()),
    focusSeconds: s.focusSeconds,
    focus: formatDuration(s.focusSeconds),
    files: s.attachmentCount,
  });

  const goalRow = (g: Goal) => ({
    id: g.id,
    title: g.title,
    status: g.status,
    deadline: g.deadline,
    plannedMinutes: g.plannedMinutes,
    focusedSeconds: g.focusedSeconds,
    focused: formatHours(g.focusedSeconds),
    planned: g.plannedMinutes === null ? null : formatHours(g.plannedMinutes * 60),
    percentDone: g.progress.fractionKind === 'work' && g.progress.fraction !== null ? Math.round(g.progress.fraction * 100) : null,
    percentTimeElapsed: g.progress.fractionKind === 'time' && g.progress.fraction !== null ? Math.round(g.progress.fraction * 100) : null,
    projectedFinish: g.progress.projectedFinish,
    noRecentPace: g.progress.noRecentPace,
    atRisk: g.progress.atRisk,
  });

  const specs: Spec[] = [
    tool({
      name: 'search',
      description:
        'Full-text search over focus sessions (name and notes), essays and files. Each word matches as a word prefix. Returns up to 20 hits, best first, with a snippet.',
      properties: { q: { type: 'string', description: 'The words to find' } },
      required: ['q'],
      input: z.object({ q: z.string() }).strict(),
      run: ({ q }) => ({ hits: search(ctx.db, q, SEARCH_HITS) }),
    }),
    tool({
      name: 'list_sessions',
      description:
        'Focus sessions, newest first, with subject, tags, start and end (local time), focus time and file count. Filter by local days (both inclusive), a subject name or a tag.',
      properties: {
        from: { ...DAY_PROP, description: 'First local day, YYYY-MM-DD' },
        to: { ...DAY_PROP, description: 'Last local day, YYYY-MM-DD (inclusive)' },
        subject: { type: 'string', description: 'Subject name, any case' },
        tag: { type: 'string', description: 'Tag name, any case' },
        limit: { type: 'integer', description: `At most this many (default ${DEFAULT_SESSIONS}, max ${MAX_SESSIONS})` },
      },
      required: [],
      input: z
        .object({
          from: day.optional(),
          to: day.optional(),
          subject: z.string().trim().min(1).optional(),
          tag: z.string().trim().min(1).optional(),
          limit: z.number().int().min(1).max(MAX_SESSIONS).optional(),
        })
        .strict(),
      run: (input) => {
        let subjectId: number | undefined;
        if (input.subject !== undefined) {
          const wanted = input.subject.toLowerCase();
          const found = listSubjects(ctx.db).find((s) => s.name.toLowerCase() === wanted);
          if (!found) return { sessions: [], note: `No subject named ${input.subject}` };
          subjectId = found.id;
        }
        const sessions = listSessions(
          ctx.db,
          {
            from: input.from,
            to: input.to === undefined ? undefined : addDays(input.to, 1),
            subjectId,
            tag: input.tag,
            limit: input.limit ?? DEFAULT_SESSIONS,
          },
          ctx.now(),
          tz(),
        );
        return { sessions: sessions.map((s) => ({ ...sessionRow(s), notes: clip(s.notes, NOTE_PREVIEW) })) };
      },
    }),
    tool({
      name: 'get_session',
      description: "One focus session in full: its notes, timer and every file with the file's text (OCR, LaTeX or code).",
      properties: { id: { type: 'integer', description: 'Session id' } },
      required: ['id'],
      input: z.object({ id }).strict(),
      run: (input) => {
        const s = getSession(ctx.db, input.id, ctx.now());
        if (!s) throw new ToolError(`No session with id ${input.id}`);
        const files = listAttachments(ctx, { sessionId: s.id }).map((a) => ({
          id: a.id,
          filename: a.filename,
          kind: a.kind,
          added: localTime(a.createdAt, tz()),
          extractedText: a.extractedText,
        }));
        return { ...sessionRow(s), notes: s.notes, attachments: files };
      },
    }),
    tool({
      name: 'get_essay',
      description: 'One essay as plain text, with its title, column (meditations, plans or insights) and word count.',
      properties: { id: { type: 'integer', description: 'Essay id' } },
      required: ['id'],
      input: z.object({ id }).strict(),
      run: (input) => {
        const essay = getEssay(ctx, input.id);
        if (!essay) throw new ToolError(`No essay with id ${input.id}`);
        return {
          id: essay.id,
          title: essay.title,
          column: essay.column,
          wordCount: essay.wordCount,
          created: localTime(essay.createdAt, tz()),
          updated: localTime(essay.updatedAt, tz()),
          text: plainTextOf(essay.contentJson),
        };
      },
    }),
    tool({
      name: 'goal_progress',
      description:
        'Goal progress: focus so far against the plan, percent done (hours plans) or time elapsed (deadline-only plans), the projected finish from the last 14 days of pace, and the at-risk flag. Without an id, every open goal. Also the estimate accuracy over done goals (actual ÷ planned, 1.0 is on plan).',
      properties: { id: { type: 'integer', description: 'One goal id; leave out for every open goal' } },
      required: [],
      input: z.object({ id: id.optional() }).strict(),
      run: (input) => {
        const now = ctx.now();
        let goals: Goal[];
        if (input.id === undefined) goals = listGoals(ctx.db, 'open', today(), tz(), now);
        else {
          const goal = getGoal(ctx.db, input.id, today(), tz(), now);
          if (!goal) throw new ToolError(`No goal with id ${input.id}`);
          goals = [goal];
        }
        return { goals: goals.map(goalRow), accuracy: estimateAccuracy(doneGoalPlans(ctx.db, tz())) };
      },
    }),
    tool({
      name: 'stats',
      description: 'Focus time per subject over a day, week, month or year, largest first, with the total.',
      properties: { range: RANGE_PROP, date: { ...DAY_PROP, description: 'A local day in the range (default today)' } },
      required: ['range'],
      input: z.object({ range, date: day.optional() }).strict(),
      run: (input) => {
        const { days } = rangeBounds(input.range, input.date ?? today(), tz());
        const last = days[days.length - 1];
        const slices = focusBySubject(ctx, days[0], addDays(last, 1));
        const totalSeconds = slices.reduce((sum, s) => sum + s.seconds, 0);
        return {
          range: input.range,
          from: days[0],
          to: last,
          totalSeconds,
          total: formatDuration(totalSeconds),
          subjects: slices.map((s) => ({ name: s.name, seconds: s.seconds, time: formatDuration(s.seconds) })),
        };
      },
    }),
    tool({
      name: 'sleep',
      description:
        'The latest nights of sleep, oldest first: bedtime and wake (local time), time asleep and in bed, stages in seconds, the source and the 0–100 score. Also how the last iPhone upload went.',
      properties: { nights: { type: 'integer', description: `How many nights (default ${DEFAULT_NIGHTS}, max ${MAX_NIGHTS})` } },
      required: [],
      input: z.object({ nights: z.number().int().min(1).max(MAX_NIGHTS).optional() }).strict(),
      run: (input) => ({
        nights: nightsFrom(ctx)
          .slice(-(input.nights ?? DEFAULT_NIGHTS))
          .map((n) => ({
            night: n.night,
            bedtime: localTime(n.bedtime, tz()),
            wake: localTime(n.wake, tz()),
            asleepSeconds: n.asleepSeconds,
            asleep: formatDuration(n.asleepSeconds),
            inBed: formatDuration(n.inBedSeconds),
            stages: n.stages,
            source: n.source,
            score: n.score,
          })),
        lastIngest: lastIngest(ctx.db),
      }),
    }),
    tool({
      name: 'exercise',
      description:
        "Push-ups and squats: today's counts, then for the range containing `date` the total, the daily average and the non-empty buckets (hours of a day, days of a week or month, months of a year).",
      properties: { range: RANGE_PROP, date: { ...DAY_PROP, description: 'A local day in the range (default today)' } },
      required: ['range'],
      input: z.object({ range, date: day.optional() }).strict(),
      run: (input) => {
        const report = exerciseReport(ctx, input.range, input.date);
        const series = Object.fromEntries(
          Object.entries(report.series).map(([kind, s]) => [kind, { ...s, buckets: s.buckets.filter((b) => b.value > 0) }]),
        );
        return { range: input.range, date: input.date ?? today(), today: report.today, series };
      },
    }),
    tool({
      name: 'resources',
      description: 'Saved resources (PDFs, videos, courses, links), newest first, with whether each is done.',
      properties: { kind: { type: 'string', enum: [...RESOURCE_KINDS], description: 'Only this kind' } },
      required: [],
      input: z.object({ kind: z.enum(RESOURCE_KINDS as readonly ['pdf', 'video', 'course', 'link']).optional() }).strict(),
      run: (input) => ({
        resources: listResources(ctx.db, input.kind).map((r) => ({ title: r.title, url: r.url, kind: r.kind, done: r.done })),
      }),
    }),
  ];

  const definitions: Anthropic.Tool[] = specs.map((spec, i) => ({
    name: spec.name,
    description: spec.description,
    strict: true,
    input_schema: { type: 'object', properties: spec.properties, required: spec.required, additionalProperties: false },
    // The tools never change, so they and the system prompt after them are one cached prefix.
    ...(i === specs.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }));

  return {
    definitions,
    async run(name, input) {
      const spec = specs.find((s) => s.name === name);
      if (!spec) throw new ToolError(`No tool named ${name}`);
      const parsed = spec.input.safeParse(input);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'} ${i.message}`).join('; ');
        throw new ToolError(`Invalid input for ${name}: ${issues}`);
      }
      return compactJson(spec.run(parsed.data as never));
    },
  };
}

type Container = Record<string, unknown> | unknown[];

const isContainer = (v: unknown): v is Container => typeof v === 'object' && v !== null;
const sizeOf = (v: unknown) => JSON.stringify(v)?.length ?? 0;

/**
 * Shortens the biggest part of `node` by about `over` characters: a long string is cut, a long
 * list loses items from its end, and a list whose bulk is one item (a file with its text) is
 * shortened inside that item. False when nothing is left to shorten.
 */
function shrink(node: Container, over: number): boolean {
  const entries: [string | number, unknown][] = Array.isArray(node) ? node.map((v, i) => [i, v]) : Object.entries(node);
  let best: { key: string | number; value: unknown; size: number } | null = null;
  for (const [key, value] of entries) {
    const size = sizeOf(value);
    if (best === null || size > best.size) best = { key, value, size };
  }
  if (best === null) return false;

  const cut = (key: string | number, s: string) => {
    if (s.length <= 1) return false;
    (node as Record<string | number, unknown>)[key] = `${s.slice(0, Math.max(0, s.length - over - 1))}…`;
    return true;
  };
  const inside = (b: { key: string | number; value: unknown }) =>
    typeof b.value === 'string' ? cut(b.key, b.value) : isContainer(b.value) && shrink(b.value, over);

  if (!Array.isArray(node)) return inside(best);
  if (best.size > sizeOf(node) / 2 && inside(best)) return true;
  if (node.length === 0) return false;
  const perItem = sizeOf(node) / node.length;
  node.splice(-Math.min(node.length, Math.max(1, Math.ceil(over / perItem))));
  return true;
}

/** `value` as compact JSON of at most `limit` characters, cut where it is longest and marked `"truncated": true`. */
export function compactJson(value: unknown, limit = TOOL_OUTPUT_LIMIT): string {
  const whole = JSON.stringify(value);
  if (whole.length <= limit) return whole;
  const copy: Container = { ...(structuredClone(value) as Record<string, unknown>), truncated: true };
  for (let out = JSON.stringify(copy); ; out = JSON.stringify(copy)) {
    if (out.length <= limit) return out;
    if (!shrink(copy, out.length - limit)) return JSON.stringify({ truncated: true });
  }
}
