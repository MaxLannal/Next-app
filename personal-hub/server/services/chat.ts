// The chat sidebar's conversations: what is stored, the snapshot of the hub that rides with
// each question, and the tool loop that asks Claude through the gateway.

import Anthropic from '@anthropic-ai/sdk';
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import type { ChatConversation, ChatEvent, ChatMessage, Goal } from '../../shared/types.ts';
import { formatDayShort, formatDuration, formatHours } from '../../web/src/lib/format.ts';
import type { AppContext } from '../context.ts';
import { estimateAccuracy, type EstimateAccuracy } from '../lib/goals.ts';
import { addDays, dayKey } from '../lib/time.ts';
import { getEssay } from '../repo/essays.ts';
import { doneGoalPlans, listGoals } from '../repo/goals.ts';
import { getSession } from '../repo/sessions.ts';
import { focusBySubject } from '../routes/stats.ts';
import { chatTools } from './chat-tools.ts';

export type { ChatEvent };

export const SYSTEM_PROMPT =
  "You are the user's assistant inside their personal hub. Answer from their data using the tools; quote figures exactly; when the data doesn't hold an answer, say so. Be brief and concrete.";

const MAX_TOOL_ROUNDS = 8;
const TITLE_LENGTH = 60;
const FOCUS_WINDOWS = [7, 30, 365];

// ── Storage ────────────────────────────────────────────────────────────────

type ConversationRow = { id: number; title: string; created_at: string; updated_at: string };
type MessageRow = { id: number; role: ChatMessage['role']; content: string; created_at: string };

/** Newest activity first. */
export function listConversations(ctx: AppContext): ChatConversation[] {
  const rows = ctx.db.prepare('SELECT * FROM chat_conversations ORDER BY updated_at DESC, id DESC').all() as ConversationRow[];
  return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }));
}

export function createConversation(ctx: AppContext): number {
  const now = ctx.now().toISOString();
  const { lastInsertRowid } = ctx.db
    .prepare("INSERT INTO chat_conversations (title, created_at, updated_at) VALUES ('', ?, ?)")
    .run(now, now);
  return Number(lastInsertRowid);
}

export function conversationExists(ctx: AppContext, id: number): boolean {
  return ctx.db.prepare('SELECT 1 FROM chat_conversations WHERE id = ?').get(id) !== undefined;
}

/** Oldest first. */
export function getMessages(ctx: AppContext, conversationId: number): ChatMessage[] {
  const rows = ctx.db
    .prepare('SELECT id, role, content, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY id')
    .all(conversationId) as MessageRow[];
  return rows.map((r) => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at }));
}

/** Deletes the conversation and its messages (cascade). */
export function deleteConversation(ctx: AppContext, id: number): boolean {
  return Number(ctx.db.prepare('DELETE FROM chat_conversations WHERE id = ?').run(id).changes) > 0;
}

/** Drops the last question and anything after it, so a retry asks it once, not twice. */
export function rewindToLastUser(ctx: AppContext, conversationId: number): void {
  ctx.db
    .prepare(
      `DELETE FROM chat_messages WHERE conversation_id = ? AND id >=
         (SELECT max(id) FROM chat_messages WHERE conversation_id = ? AND role = 'user')`,
    )
    .run(conversationId, conversationId);
}

/** Stores a turn; the first question also titles an untitled conversation. */
function addMessage(ctx: AppContext, conversationId: number, role: ChatMessage['role'], content: string): number {
  const now = ctx.now().toISOString();
  const { lastInsertRowid } = ctx.db
    .prepare('INSERT INTO chat_messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(conversationId, role, content, now);
  ctx.db.prepare('UPDATE chat_conversations SET updated_at = ? WHERE id = ?').run(now, conversationId);
  if (role === 'user') {
    const title = content.trim().replace(/\s+/g, ' ').slice(0, TITLE_LENGTH);
    ctx.db.prepare("UPDATE chat_conversations SET title = ? WHERE id = ? AND title = ''").run(title, conversationId);
  }
  return Number(lastInsertRowid);
}

// ── Snapshot ───────────────────────────────────────────────────────────────

/**
 * One open goal: `- Finish Ch. 4 — 6 h of 10 h, projected 26 Nov` for an hours plan,
 * `- Essay — 3 h focused, due 2 Dec (time 50% elapsed)` for a deadline-only one, with
 * `, at risk` when flagged.
 */
export function goalLine(goal: Goal): string {
  const p = goal.progress;
  const parts: string[] = [];
  if (goal.plannedMinutes !== null) {
    parts.push(`${formatHours(goal.focusedSeconds)} of ${formatHours(goal.plannedMinutes * 60)}`);
    if (p.noRecentPace) parts.push('no recent pace');
    else if (p.projectedFinish !== null) parts.push(`projected ${formatDayShort(p.projectedFinish)}`);
    if (goal.deadline !== null) parts.push(`due ${formatDayShort(goal.deadline)}`);
  } else {
    parts.push(`${formatHours(goal.focusedSeconds)} focused`);
    if (goal.deadline === null) parts.push('no plan');
    else {
      const elapsed = p.fraction === null ? '' : ` (time ${Math.round(p.fraction * 100)}% elapsed)`;
      parts.push(`due ${formatDayShort(goal.deadline)}${elapsed}`);
    }
  }
  if (p.atRisk) parts.push('at risk');
  return `- ${goal.title} — ${parts.join(', ')}`;
}

const ratio = (r: number | null, what: string) => (r === null ? `${what} not measured` : `${what} ${r.toFixed(2)}× the plan`);

function accuracyLine(a: EstimateAccuracy): string {
  if (a.count === 0) return 'Estimate accuracy: no goal is done yet.';
  const goals = a.count === 1 ? '1 done goal' : `${a.count} done goals`;
  return `Estimate accuracy over ${goals}: ${ratio(a.hours, 'hours')}, ${ratio(a.dates, 'dates')} (1.00 is on plan).`;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const rows = (ctx: AppContext, sql: string) => (ctx.db.prepare(sql).get() as { n: number }).n;

const PAGES = new Map([
  ['/', 'the dashboard'],
  ['/essays', 'the essays list'],
  ['/database', 'the database'],
  ['/settings', 'settings'],
]);

/** "The user is looking at: …" for the page the question was asked from; null for anything unknown. */
function pageLine(ctx: AppContext, page: string | undefined): string | null {
  if (page === undefined) return null;
  const path = page.split(/[?#]/)[0].replace(/(.)\/+$/, '$1');
  const known = PAGES.get(path);
  if (known !== undefined) return `The user is looking at: ${known}`;
  const essayId = /^\/essays\/(\d{1,15})$/.exec(path)?.[1];
  if (essayId !== undefined) {
    const essay = getEssay(ctx, Number(essayId));
    if (!essay) return null;
    const what = essay.title.trim() === '' ? 'an untitled essay' : `the essay '${essay.title}'`;
    return `The user is looking at: ${what} (id ${essay.id})`;
  }
  const sessionId = /^\/database\/session\/(\d{1,15})$/.exec(path)?.[1];
  if (sessionId !== undefined) {
    const session = getSession(ctx.db, Number(sessionId), ctx.now());
    return session ? `The user is looking at: the session '${session.name}' (id ${session.id})` : null;
  }
  return null;
}

/**
 * The hub as it stands, in plain text, made fresh for every question: the date, the page the user
 * is on, open goals, estimate accuracy, focus by subject over 7, 30 and 365 days, and counts.
 */
export function buildSnapshot(ctx: AppContext, page?: string): string {
  const tz = ctx.timeZone();
  const now = ctx.now();
  const today = dayKey(now, tz);
  const local = new TZDate(now.getTime(), tz);

  const lines = [`Hub snapshot for this message. Today is ${format(local, 'EEEE d MMMM yyyy')} (${today}), ${format(local, 'HH:mm')} in ${tz}.`];
  const looking = pageLine(ctx, page);
  if (looking !== null) lines.push(looking);

  const goals = listGoals(ctx.db, 'open', today, tz, now);
  lines.push('', 'Open goals:', ...(goals.length > 0 ? goals.map(goalLine) : ['- No open goals']));
  lines.push('', accuracyLine(estimateAccuracy(doneGoalPlans(ctx.db, tz))));

  lines.push('', 'Focus by subject:');
  for (const days of FOCUS_WINDOWS) {
    const slices = focusBySubject(ctx, addDays(today, 1 - days), addDays(today, 1));
    const list = slices.map((s) => `${s.name} ${formatDuration(s.seconds)}`).join(', ');
    lines.push(`Last ${days} days: ${list === '' ? 'no focus' : list}`);
  }

  const counts = [
    count(rows(ctx, 'SELECT COUNT(*) AS n FROM focus_sessions'), 'session', 'sessions'),
    count(rows(ctx, 'SELECT COUNT(*) AS n FROM essays'), 'essay', 'essays'),
    count(rows(ctx, 'SELECT COUNT(*) AS n FROM attachments WHERE parent_id IS NULL'), 'file', 'files'),
    count(rows(ctx, 'SELECT COUNT(*) AS n FROM resources'), 'resource', 'resources'),
  ];
  lines.push('', `In the hub: ${counts.join(', ')}.`);
  return lines.join('\n');
}

// ── The loop ───────────────────────────────────────────────────────────────

/** Lower-cases the first letter of a message to follow a colon, unless it starts a name or an acronym. */
function asClause(message: string): string {
  if (/^Claude\b/.test(message) || /^[A-Z]{2}/.test(message)) return message;
  return message.charAt(0).toLowerCase() + message.slice(1);
}

/** Why Claude couldn't answer, in the hub's calm voice. Never carries the token. */
function failure(err: unknown): string {
  let reason: string;
  if (err instanceof Anthropic.APIConnectionError) reason = "the gateway didn't answer — check the connection and retry";
  else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    reason = 'the gateway refused the token — run setup again';
  } else if (err instanceof Anthropic.PaymentRequiredError) reason = 'the gateway account is out of credit — top it up, then retry';
  else if (err instanceof Anthropic.RateLimitError) reason = 'the gateway is busy — retry in a minute';
  else if (err instanceof Anthropic.APIError) {
    const detail = (err.error as { error?: { message?: unknown } } | undefined)?.error?.message;
    reason = `the gateway answered ${err.status ?? 'with an error'}${typeof detail === 'string' ? `: ${detail}` : ''}`;
  } else if (err instanceof Error && err.message !== '') reason = asClause(err.message);
  else reason = 'something went wrong';
  return `Claude couldn't answer: ${reason}`;
}

/** The stored turns before `beforeId`, as text. */
function history(ctx: AppContext, conversationId: number, beforeId: number): Anthropic.MessageParam[] {
  return getMessages(ctx, conversationId)
    .filter((m) => m.id < beforeId)
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Answers `userText` in the conversation: stores the question, asks Claude with the history and
 * a fresh snapshot, runs up to 8 rounds of tools, and stores the answer. Text streams out as
 * `text` events; a tool call as `tool`; the end as `done` (with the stored answer's id) or
 * `error`. `page` is the path the user asked from. An abort keeps what had streamed and sends nothing.
 */
export async function runChat(
  ctx: AppContext,
  conversationId: number,
  userText: string,
  emit: (e: ChatEvent) => void,
  signal: AbortSignal,
  page?: string,
): Promise<void> {
  const tools = chatTools(ctx);
  const questionId = addMessage(ctx, conversationId, 'user', userText);
  const messages: Anthropic.MessageParam[] = [
    ...history(ctx, conversationId, questionId),
    {
      role: 'user',
      content: [
        { type: 'text', text: buildSnapshot(ctx, page) },
        { type: 'text', text: userText },
      ],
    },
  ];
  const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

  let text = '';
  let newRound = false;
  const onText = (delta: string) => {
    if (delta === '' || signal.aborted) return;
    // Text from a later round starts a new paragraph.
    const out = newRound && text !== '' ? `\n\n${delta}` : delta;
    newRound = false;
    text += out;
    emit({ type: 'text', delta: out });
  };
  const keepWhatStreamed = () => {
    if (text.trim() !== '') addMessage(ctx, conversationId, 'assistant', text);
  };

  try {
    for (let round = 0; ; round++) {
      if (signal.aborted) return keepWhatStreamed();
      const message = await ctx.claude.streamTurn({ system, messages: [...messages], tools: tools.definitions, signal }, onText);

      if (message.stop_reason === 'refusal') {
        emit({ type: 'error', message: 'Claude declined this request' });
        return;
      }
      const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (message.stop_reason !== 'tool_use' || calls.length === 0) break;
      if (round === MAX_TOOL_ROUNDS) {
        emit({ type: 'error', message: `Claude couldn't answer: it needed more than ${MAX_TOOL_ROUNDS} lookups — try a narrower question` });
        return;
      }

      messages.push({ role: 'assistant', content: message.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        emit({ type: 'tool', name: call.name });
        try {
          results.push({ type: 'tool_result', tool_use_id: call.id, content: await tools.run(call.name, call.input) });
        } catch (err) {
          results.push({ type: 'tool_result', tool_use_id: call.id, content: (err as Error).message, is_error: true });
        }
      }
      messages.push({ role: 'user', content: results });
      newRound = true;
    }
  } catch (err) {
    if (signal.aborted) return keepWhatStreamed();
    emit({ type: 'error', message: failure(err) });
    return;
  }

  if (text.trim() === '') {
    emit({ type: 'error', message: "Claude couldn't answer: the reply was empty" });
    return;
  }
  emit({ type: 'done', messageId: addMessage(ctx, conversationId, 'assistant', text) });
}
