import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatEvent, FocusSession, Goal } from '../../shared/types.ts';
import { UnavailableError, type ClaudeClient } from '../context.ts';
import { goalProgress } from '../lib/goals.ts';
import { createEssay, saveEssay } from '../repo/essays.ts';
import { makeTestContext, TEST_NOW, type TestContext } from '../test/helpers.ts';
import {
  buildSnapshot,
  createConversation,
  getMessages,
  goalLine,
  listConversations,
  runChat,
  SYSTEM_PROMPT,
} from './chat.ts';

type TurnParams = Parameters<ClaudeClient['streamTurn']>[0];

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

/** A reply as the gateway would send it, with only the parts the loop reads. */
function reply(content: unknown[], stopReason: Anthropic.Message['stop_reason']): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-test',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Message;
}

const text = (s: string) => ({ type: 'text', text: s, citations: null });
const SAVED = { type: 'saved', messageId: expect.any(Number) };
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });

/**
 * Scripts Claude's replies in order. Each call's params are copied as they were sent, and the
 * text blocks stream through `onText` the way the real client streams them.
 */
function script(...replies: Anthropic.Message[]): TurnParams[] {
  const calls: TurnParams[] = [];
  t.fakes.claude.streamTurn = async (params, onText) => {
    calls.push({ ...params, messages: structuredClone(params.messages) });
    const next = replies.shift();
    if (!next) throw new Error('No more scripted replies');
    for (const block of next.content) if (block.type === 'text') onText(block.text);
    return next;
  };
  return calls;
}

async function chat(conversationId: number, userText: string, page?: string): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  await runChat(t, conversationId, userText, (e) => events.push(e), new AbortController().signal, page);
  return events;
}

async function seedGoal(body: Record<string, unknown>): Promise<Goal> {
  const res = await t.req('POST', '/api/goals', body);
  expect(res.status).toBe(201);
  return (await res.json()) as Goal;
}

/** A done session of `hours` from `startedAt`, through the API so it is indexed like a real one. */
async function seedSession(body: { name: string; startedAt: string; hours: number; subjectName?: string; goalId?: number; notes?: string }) {
  const ended = new Date(Date.parse(body.startedAt) + body.hours * 3_600_000).toISOString();
  const { hours: _hours, ...rest } = body;
  const res = await t.req('POST', '/api/sessions/manual', { ...rest, endedAt: ended });
  expect(res.status).toBe(201);
  return (await res.json()) as FocusSession;
}

function goalOf(over: Partial<Goal>): Goal {
  return {
    id: 1,
    title: 'Finish Ch. 4',
    createdAt: TEST_NOW,
    deadline: null,
    plannedMinutes: null,
    originalDeadline: null,
    originalPlannedMinutes: null,
    status: 'open',
    doneAt: null,
    focusedSeconds: 0,
    progress: { mode: 'none', fraction: null, fractionKind: null, projectedFinish: null, noRecentPace: false, atRisk: false },
    ...over,
  };
}

describe('snapshot', () => {
  it('snapshot lists goal progress', () => {
    // 600 planned minutes, 21600 s focused, a pace of 1 h a day (14 h over the 14-day window).
    const plan = { deadline: null, plannedMinutes: 600 };
    const progress = goalProgress({ plan, createdDay: '2026-11-08', focusedSeconds: 21600, last14Seconds: 14 * 3600, today: '2026-11-22' });
    const goal = goalOf({ plannedMinutes: 600, focusedSeconds: 21600, progress });
    expect(goalLine(goal)).toBe('- Finish Ch. 4 — 6 h of 10 h, projected 26 Nov');
  });

  it('writes a deadline-only goal as time elapsed, and flags one at risk', () => {
    const plan = { deadline: '2026-12-02', plannedMinutes: null };
    const progress = goalProgress({ plan, createdDay: '2026-11-12', focusedSeconds: 3 * 3600, last14Seconds: 0, today: '2026-11-22' });
    const goal = goalOf({ title: 'Essay draft', deadline: '2026-12-02', focusedSeconds: 3 * 3600, progress });
    expect(goalLine(goal)).toBe('- Essay draft — 3 h focused, due 2 Dec (time 50% elapsed)');
    expect(goalLine({ ...goal, progress: { ...progress, atRisk: true } })).toBe(
      '- Essay draft — 3 h focused, due 2 Dec (time 50% elapsed), at risk',
    );
  });

  it('builds the snapshot from the stored goals, focus and counts', async () => {
    const goal = await seedGoal({ title: 'Finish Ch. 4', plannedMinutes: 600 });
    // Six one-hour sessions on the six days before today (Chicago).
    for (let day = 16; day <= 21; day++) {
      await seedSession({ name: 'Ch. 4 problems', subjectName: 'Algebra', goalId: goal.id, startedAt: `2026-11-${day}T15:00:00.000Z`, hours: 1 });
    }
    await seedSession({ name: 'Reading', subjectName: 'Physics', startedAt: '2026-10-01T15:00:00.000Z', hours: 2 });

    const snapshot = buildSnapshot(t);
    expect(snapshot).toContain('2026-11-22');
    expect(snapshot).toContain('America/Chicago');
    // 6 h of 14-day focus is a pace of 6/14 h a day: 4 h left takes 10 days.
    expect(snapshot).toContain('- Finish Ch. 4 — 6 h of 10 h, projected 2 Dec');
    expect(snapshot).toMatch(/Last 7 days: Algebra 6 h 0 m\n/);
    expect(snapshot).toMatch(/Last 365 days: Algebra 6 h 0 m, Physics 2 h 0 m\n/);
    expect(snapshot).toContain('Estimate accuracy: no goal is done yet');
    expect(snapshot).toContain('7 sessions, 0 essays, 0 files, 0 resources');
  });

  it('says when there are no open goals', () => {
    expect(buildSnapshot(t)).toContain('No open goals');
  });

  it('names the page The user is looking at, and ignores ids that are not there', async () => {
    const essay = createEssay(t, 'meditations');
    saveEssay(t, essay.id, { title: 'On attention', baseUpdatedAt: essay.updatedAt });
    const session = await seedSession({ name: 'Ch. 4 problems', startedAt: '2026-11-21T15:00:00.000Z', hours: 1 });

    expect(buildSnapshot(t, `/essays/${essay.id}`)).toContain(`The user is looking at: the essay 'On attention' (id ${essay.id})`);
    expect(buildSnapshot(t, `/database/session/${session.id}`)).toContain(
      `The user is looking at: the session 'Ch. 4 problems' (id ${session.id})`,
    );
    expect(buildSnapshot(t, '/')).toContain('The user is looking at: the dashboard');
    expect(buildSnapshot(t, '/essays')).toContain('The user is looking at: the essays list');
    expect(buildSnapshot(t, '/database')).toContain('The user is looking at: the database');
    expect(buildSnapshot(t, '/settings')).toContain('The user is looking at: settings');
    expect(buildSnapshot(t, '/essays/999')).not.toContain('The user is looking at');
    expect(buildSnapshot(t, '/database/session/999')).not.toContain('The user is looking at');
    expect(buildSnapshot(t, '/somewhere-else')).not.toContain('The user is looking at');
  });
});

describe('runChat', () => {
  it('tool round trip', async () => {
    await seedGoal({ title: 'Finish Ch. 4', plannedMinutes: 600 });
    const calls = script(
      reply([toolUse('tu_1', 'goal_progress', {})], 'tool_use'),
      reply([text("You're 60% through.")], 'end_turn'),
    );
    const id = createConversation(t);

    const events = await chat(id, 'How far am I on my goals?');

    expect(events.map((e) => e.type)).toEqual(['saved', 'tool', 'text', 'done']);
    expect(events[1]).toEqual({ type: 'tool', name: 'goal_progress' });
    expect(events[2]).toEqual({ type: 'text', delta: "You're 60% through." });
    const stored = getMessages(t, id);
    expect(stored.map((m) => [m.role, m.content])).toEqual([
      ['user', 'How far am I on my goals?'],
      ['assistant', "You're 60% through."],
    ]);
    expect(events[0]).toEqual({ type: 'saved', messageId: stored[0].id });
    expect(events[3]).toEqual({ type: 'done', messageId: stored[1].id });

    // The tool's answer goes back as one user message holding one tool_result.
    expect(calls).toHaveLength(2);
    const last = calls[1].messages.at(-1) as Anthropic.MessageParam;
    expect(last.role).toBe('user');
    const results = last.content as Anthropic.ToolResultBlockParam[];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' });
    expect(results[0].is_error).toBeFalsy();
    expect(JSON.parse(results[0].content as string).goals[0].title).toBe('Finish Ch. 4');
  });

  it('sends the cached system prompt and tools, and the snapshot in the newest user turn', async () => {
    const calls = script(reply([text('Hello.')], 'end_turn'));
    const id = createConversation(t);
    await chat(id, 'Hi', '/');

    const [params] = calls;
    expect(params.system).toEqual([{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]);
    expect(params.tools.at(-1)?.cache_control).toEqual({ type: 'ephemeral' });
    expect(params.tools.slice(0, -1).every((tool) => tool.cache_control === undefined)).toBe(true);
    const [turn] = params.messages;
    const blocks = turn.content as Anthropic.TextBlockParam[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toContain('2026-11-22');
    expect(blocks[0].text).toContain('The user is looking at: the dashboard');
    expect(blocks[1].text).toBe('Hi');
  });

  it('sends earlier turns as plain text, without their snapshot', async () => {
    const calls = script(reply([text('First answer.')], 'end_turn'), reply([text('Second answer.')], 'end_turn'));
    const id = createConversation(t);
    await chat(id, 'First question');
    await chat(id, 'Second question');

    const { messages } = calls[1];
    expect(messages.slice(0, 2)).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer.' },
    ]);
    const newest = messages[2].content as Anthropic.TextBlockParam[];
    expect(newest.map((b) => b.text).at(-1)).toBe('Second question');
  });

  it('invalid tool input is an error result', async () => {
    const calls = script(
      reply([toolUse('tu_1', 'get_session', { id: 'x' })], 'tool_use'),
      reply([text('I could not read that session.')], 'end_turn'),
    );
    const id = createConversation(t);

    const events = await chat(id, 'What was in session x?');

    expect(events.map((e) => e.type)).toEqual(['saved', 'tool', 'text', 'done']);
    const results = calls[1].messages.at(-1)?.content as Anthropic.ToolResultBlockParam[];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: true });
    expect(getMessages(t, id)).toHaveLength(2);
  });

  it('answers every tool call of a round in one user message', async () => {
    const calls = script(
      reply([text('Let me look.'), toolUse('a', 'goal_progress', {}), toolUse('b', 'sleep', {})], 'tool_use'),
      reply([text('Done.')], 'end_turn'),
    );
    const id = createConversation(t);
    const events = await chat(id, 'Goals and sleep?');

    expect(events.filter((e) => e.type === 'tool').map((e) => (e as { name: string }).name)).toEqual(['goal_progress', 'sleep']);
    const results = calls[1].messages.at(-1)?.content as Anthropic.ToolResultBlockParam[];
    expect(results.map((r) => r.tool_use_id)).toEqual(['a', 'b']);
    // The text of both rounds is what the user saw, so it is what is kept.
    expect(getMessages(t, id)[1].content).toBe('Let me look.\n\nDone.');
  });

  it('refusal stops', async () => {
    script(reply([], 'refusal'));
    const id = createConversation(t);

    const events = await chat(id, 'Something it declines');

    expect(events).toEqual([SAVED, { type: 'error', message: 'Claude declined this request' }]);
    expect(getMessages(t, id).map((m) => m.role)).toEqual(['user']);
  });

  it('says Claude couldn’t answer when the gateway fails, and keeps no reply', async () => {
    t.fakes.claude.streamTurn = async () => {
      throw new UnavailableError('Model not found on the gateway');
    };
    const id = createConversation(t);

    const events = await chat(id, 'How far am I on my goals?');

    expect(events).toEqual([SAVED, { type: 'error', message: 'Claude couldn’t answer: model not found on the gateway' }]);
    expect(getMessages(t, id).map((m) => m.role)).toEqual(['user']);
  });

  it('says what went wrong at the gateway in plain words', async () => {
    const cases: [Error, string][] = [
      [
        new Anthropic.PaymentRequiredError(402, { error: { message: 'Wallet balance too low' } }, '402 balance', new Headers()),
        'Claude couldn’t answer: the gateway account is out of credit — top it up, then retry',
      ],
      [new Anthropic.APIConnectionError({ message: 'Connection error.' }), 'Claude couldn’t answer: the gateway didn’t answer — check the connection and retry'],
      [new Anthropic.AuthenticationError(401, {}, '401', new Headers()), 'Claude couldn’t answer: the gateway refused the token — run setup again'],
      [
        new Anthropic.InternalServerError(500, { error: { message: 'Overloaded' } }, '500', new Headers()),
        'Claude couldn’t answer: the gateway answered 500: Overloaded',
      ],
    ];
    for (const [err, message] of cases) {
      t.fakes.claude.streamTurn = async () => {
        throw err;
      };
      const events = await chat(createConversation(t), 'Hi');
      expect(events).toEqual([SAVED, { type: 'error', message }]);
    }
  });

  it('stops after 8 tool rounds', async () => {
    const replies = Array.from({ length: 9 }, (_, i) => reply([toolUse(`tu_${i}`, 'goal_progress', {})], 'tool_use'));
    const calls = script(...replies);
    const id = createConversation(t);

    const events = await chat(id, 'Keep looking');

    expect(calls).toHaveLength(9);
    expect(events.filter((e) => e.type === 'tool')).toHaveLength(8);
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Claude couldn’t answer: it needed more than 8 lookups — try a narrower question' });
    expect(getMessages(t, id).map((m) => m.role)).toEqual(['user']);
  });

  it('keeps the text of an answer cut off at max_tokens', async () => {
    script(reply([text('A long answer that ran')], 'max_tokens'));
    const id = createConversation(t);
    const events = await chat(id, 'Tell me everything');
    expect(events.map((e) => e.type)).toEqual(['saved', 'text', 'done']);
    expect(getMessages(t, id)[1].content).toBe('A long answer that ran');
  });

  it('keeps what streamed before a stop, and sends no error', async () => {
    const controller = new AbortController();
    t.fakes.claude.streamTurn = async (_params, onText) => {
      onText('Half an ans');
      controller.abort();
      throw new Error('Request was aborted.');
    };
    const id = createConversation(t);
    const events: ChatEvent[] = [];
    await runChat(t, id, 'Question', (e) => events.push(e), controller.signal);

    expect(events).toEqual([SAVED, { type: 'text', delta: 'Half an ans' }]);
    expect(getMessages(t, id).map((m) => [m.role, m.content])).toEqual([
      ['user', 'Question'],
      ['assistant', 'Half an ans'],
    ]);
  });

  it('sends at most the last 40 stored turns, starting with a question', async () => {
    const id = createConversation(t);
    const insert = t.db.prepare('INSERT INTO chat_messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)');
    for (let i = 0; i < 45; i++) insert.run(id, i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`, TEST_NOW);
    const calls = script(reply([text('Noted.')], 'end_turn'));

    await chat(id, 'And now?');

    const earlier = calls[0].messages.slice(0, -1);
    expect(earlier.length).toBeLessThanOrEqual(40);
    expect(earlier[0]).toEqual({ role: 'user', content: 'turn 6' });
    expect(earlier.at(-1)).toEqual({ role: 'user', content: 'turn 44' });
  });

  it('reports a failure to store the question as an error, never a throw', async () => {
    const events = await chat(999, 'A conversation that is gone');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error' });
    expect((events[0] as { message: string }).message).toMatch(/^Claude couldn’t answer: /);
  });

  it('titles a new conversation with the first 60 characters of the first message', async () => {
    script(reply([text('One.')], 'end_turn'), reply([text('Two.')], 'end_turn'));
    const id = createConversation(t);
    const first = 'How many hours did I spend on algebra over the last month, and how does it compare?';
    await chat(id, first);
    await chat(id, 'And physics?');
    expect(listConversations(t).find((c) => c.id === id)?.title).toBe(first.slice(0, 60));
  });
});
