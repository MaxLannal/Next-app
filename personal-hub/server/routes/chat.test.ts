import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ChatConversation, ChatMessage } from '../../shared/types.ts';
import type { ClaudeClient } from '../context.ts';
import { makeTestContext, type TestContext } from '../test/helpers.ts';

type TurnParams = Parameters<ClaudeClient['streamTurn']>[0];

let t: TestContext;
beforeEach(() => {
  t = makeTestContext();
});
afterEach(() => {
  t.cleanup();
});

const textReply = (s: string) =>
  ({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-test',
    content: [{ type: 'text', text: s, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }) as unknown as Anthropic.Message;

/** Claude answers each turn with `answers` in order, streaming each as two deltas. */
function answer(...answers: string[]): TurnParams[] {
  const calls: TurnParams[] = [];
  t.fakes.claude.streamTurn = async (params, onText) => {
    calls.push(params);
    const next = answers.shift();
    if (next === undefined) throw new Error('No more scripted replies');
    const half = Math.ceil(next.length / 2);
    onText(next.slice(0, half));
    onText(next.slice(half));
    return textReply(next);
  };
  return calls;
}

/** The SSE body as `[event, data]` pairs. */
function events(body: string): [string, unknown][] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const lines = chunk.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))?.slice(7) ?? '';
      const data = lines.filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
      return [event, JSON.parse(data)];
    });
}

async function newConversation(): Promise<number> {
  const res = await t.req('POST', '/api/chat/conversations');
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function messages(id: number): Promise<ChatMessage[]> {
  const res = await t.req('GET', `/api/chat/conversations/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ChatMessage[];
}

it('creates, lists, reads and deletes conversations', async () => {
  const id = await newConversation();
  const list = (await (await t.req('GET', '/api/chat/conversations')).json()) as ChatConversation[];
  expect(list).toEqual([expect.objectContaining({ id, title: '' })]);
  expect(await messages(id)).toEqual([]);

  expect((await t.req('DELETE', `/api/chat/conversations/${id}`)).status).toBe(204);
  expect((await t.req('GET', `/api/chat/conversations/${id}`)).status).toBe(404);
  expect((await t.req('DELETE', `/api/chat/conversations/${id}`)).status).toBe(404);
});

it('streams an answer as server-sent events and stores both turns', async () => {
  answer('You are 60% through.');
  const id = await newConversation();

  const res = await t.req('POST', `/api/chat/conversations/${id}/messages`, { content: 'How far am I on my goals?' });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const sent = events(await res.text());

  const stored = await messages(id);
  expect(stored.map((m) => [m.role, m.content])).toEqual([
    ['user', 'How far am I on my goals?'],
    ['assistant', 'You are 60% through.'],
  ]);
  expect(sent).toEqual([
    ['saved', { type: 'saved', messageId: stored[0].id }],
    ['text', { type: 'text', delta: 'You are 60' }],
    ['text', { type: 'text', delta: '% through.' }],
    ['done', { type: 'done', messageId: stored[1].id }],
  ]);
  const list = (await (await t.req('GET', '/api/chat/conversations')).json()) as ChatConversation[];
  expect(list[0].title).toBe('How far am I on my goals?');
});

it('tells Claude which page The user is looking at', async () => {
  const calls = answer('Hello.');
  const id = await newConversation();
  await (await t.req('POST', `/api/chat/conversations/${id}/messages`, { content: 'Hi', page: '/essays' })).text();
  const blocks = calls[0].messages.at(-1)?.content as Anthropic.TextBlockParam[];
  expect(blocks[0].text).toContain('The user is looking at: the essays list');
});

it('sends an error event when Claude is not set up', async () => {
  // The test context's default Claude has no scripted reply and fails like an unset gateway.
  const id = await newConversation();
  const res = await t.req('POST', `/api/chat/conversations/${id}/messages`, { content: 'Hi' });
  const sent = events(await res.text());
  expect(sent).toEqual([
    ['saved', { type: 'saved', messageId: expect.any(Number) }],
    ['error', { type: 'error', message: 'Claude couldn’t answer: no scripted Claude reply in this test' }],
  ]);
});

/** Sends a question and returns the id its `saved` event named. */
async function ask(id: number, body: Record<string, unknown>): Promise<number | undefined> {
  const sent = events(await (await t.req('POST', `/api/chat/conversations/${id}/messages`, body)).text());
  return (sent.find(([event]) => event === 'saved')?.[1] as { messageId: number } | undefined)?.messageId;
}

it('retries from the saved question instead of asking it twice', async () => {
  const id = await newConversation();
  answer('Seven hours.');
  await ask(id, { content: 'How did I sleep?' });
  // The next question fails at the gateway: it is stored, with no answer.
  const saved = await ask(id, { content: 'And this week?' });
  expect((await messages(id)).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);

  answer('Fifty hours.');
  const again = await ask(id, { content: 'And this week?', replaceFrom: saved });
  expect((await messages(id)).map((m) => [m.role, m.content])).toEqual([
    ['user', 'How did I sleep?'],
    ['assistant', 'Seven hours.'],
    ['user', 'And this week?'],
    ['assistant', 'Fifty hours.'],
  ]);

  // Regenerating an answered question replaces just that answer.
  answer('Fifty hours and ten minutes.');
  await ask(id, { content: 'And this week?', replaceFrom: again });
  expect((await messages(id)).map((m) => m.content)).toEqual(['How did I sleep?', 'Seven hours.', 'And this week?', 'Fifty hours and ten minutes.']);
});

it('keeps the earlier turns when retrying a question the hub never stored', async () => {
  const id = await newConversation();
  answer('Seven hours.', 'Fifty hours.');
  await ask(id, { content: 'How did I sleep?' });
  // "And this week?" never reached the hub (the connection dropped), so the sidebar has no saved
  // id for it, and its Retry is a plain question.
  await ask(id, { content: 'And this week?' });
  expect((await messages(id)).map((m) => m.content)).toEqual(['How did I sleep?', 'Seven hours.', 'And this week?', 'Fifty hours.']);
});

it('rewinds only from a question of this conversation', async () => {
  const id = await newConversation();
  const other = await newConversation();
  answer('Seven hours.', 'Elsewhere.', 'Fifty hours.', 'Sixty hours.');
  await ask(id, { content: 'How did I sleep?' });
  const otherQuestion = await ask(other, { content: 'Another chat' });
  const [, answerRow] = await messages(id);

  await ask(id, { content: 'And this week?', replaceFrom: answerRow.id });
  await ask(id, { content: 'And this month?', replaceFrom: otherQuestion });
  expect((await messages(id)).map((m) => m.content)).toEqual([
    'How did I sleep?',
    'Seven hours.',
    'And this week?',
    'Fifty hours.',
    'And this month?',
    'Sixty hours.',
  ]);
  expect((await messages(other)).map((m) => m.content)).toEqual(['Another chat', 'Elsewhere.']);
});

it('refuses an empty message and an unknown conversation', async () => {
  const id = await newConversation();
  expect((await t.req('POST', `/api/chat/conversations/${id}/messages`, { content: '   ' })).status).toBe(400);
  expect((await t.req('POST', `/api/chat/conversations/${id}/messages`, {})).status).toBe(400);
  expect((await t.req('POST', '/api/chat/conversations/999/messages', { content: 'Hi' })).status).toBe(404);
  expect((await t.req('GET', '/api/chat/conversations/abc')).status).toBe(404);
});

it('says whether the gateway is configured', async () => {
  expect(await (await t.req('GET', '/api/chat/status')).json()).toEqual({ configured: false, model: 'claude-opus-5-5' });
  t.config.update({ anthropic: { baseURL: 'https://gateway.example', authToken: 'secret' } });
  expect(await (await t.req('GET', '/api/chat/status')).json()).toEqual({ configured: true, model: 'claude-opus-5-5' });
});
