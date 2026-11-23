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
  expect(sent).toEqual([['error', { type: 'error', message: "Claude couldn't answer: no scripted Claude reply in this test" }]]);
});

it('retries the last question instead of asking it twice', async () => {
  const id = await newConversation();
  // The first try fails: the question is kept with no answer.
  await (await t.req('POST', `/api/chat/conversations/${id}/messages`, { content: 'How did I sleep?' })).text();
  expect((await messages(id)).map((m) => m.role)).toEqual(['user']);

  answer('Seven hours.');
  await (await t.req('POST', `/api/chat/conversations/${id}/messages`, { content: 'How did I sleep?', retry: true })).text();
  expect((await messages(id)).map((m) => [m.role, m.content])).toEqual([
    ['user', 'How did I sleep?'],
    ['assistant', 'Seven hours.'],
  ]);

  // Regenerating an answered question replaces the answer.
  answer('Seven hours and ten minutes.');
  await (await t.req('POST', `/api/chat/conversations/${id}/messages`, { content: 'How did I sleep?', retry: true })).text();
  expect((await messages(id)).map((m) => m.content)).toEqual(['How did I sleep?', 'Seven hours and ten minutes.']);
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
