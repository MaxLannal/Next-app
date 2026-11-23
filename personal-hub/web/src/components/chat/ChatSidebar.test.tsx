import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatConversation, ChatEvent, ChatStatus } from '@shared/types.ts';
import { ChatSidebar } from './ChatSidebar.tsx';
import { MessageView } from './MessageView.tsx';
import { sseParser } from './useChat.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** An SSE reply carrying `events`, one chunk each, as the hub streams them. */
function sse(events: ChatEvent[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;

function stubHub(handlers: Record<string, Handler | Handler[]>) {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    const entry = handlers[key];
    const handler = Array.isArray(entry) ? entry.shift() : entry;
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const READY: ChatStatus = { configured: true, model: 'claude-opus-5-5' };
const NO_CONVERSATIONS: ChatConversation[] = [];

function stubWidth(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: desktop,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

function renderSidebar(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ChatSidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body)) as Record<string, unknown>;

beforeEach(() => {
  localStorage.clear();
  stubWidth(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('--chat-space');
});

describe('ChatSidebar', () => {
  it('offers three example questions when the chat is empty', async () => {
    stubHub({ 'GET /api/chat/status': () => json(READY), 'GET /api/chat/conversations': () => json(NO_CONVERSATIONS) });
    renderSidebar();
    expect(await screen.findByText('Ask about your goals, sessions or essays')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'How far am I on my goals?' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /\?$/ })).toHaveLength(3);
    // The page keeps room for the panel.
    expect(document.documentElement.style.getPropertyValue('--chat-space')).not.toBe('');
  });

  it('says so and points to Settings when the gateway is not set up', async () => {
    stubHub({
      'GET /api/chat/status': () => json({ configured: false, model: 'claude-opus-5-5' }),
      'GET /api/chat/conversations': () => json(NO_CONVERSATIONS),
    });
    renderSidebar();
    expect(await screen.findByText('Claude isn’t set up yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe('/settings');
  });

  it('streams an answer, saying which page the user asked from', async () => {
    const fetchMock = stubHub({
      'GET /api/chat/status': () => json(READY),
      'GET /api/chat/conversations': () => json(NO_CONVERSATIONS),
      'POST /api/chat/conversations': () => json({ id: 7 }, 201),
      'POST /api/chat/conversations/7/messages': () =>
        sse([
          { type: 'tool', name: 'goal_progress' },
          { type: 'text', delta: 'You are **60%** ' },
          { type: 'text', delta: 'through.' },
          { type: 'done', messageId: 2 },
        ]),
    });
    renderSidebar('/essays');

    await userEvent.click(await screen.findByRole('button', { name: 'How far am I on my goals?' }));

    expect(await screen.findByText('60%')).toBeTruthy();
    expect(screen.getByText('How far am I on my goals?', { selector: '.chat-msg--user *' })).toBeTruthy();
    const send = fetchMock.mock.calls.find(([path]) => path === '/api/chat/conversations/7/messages');
    expect(bodyOf(send?.[1])).toEqual({ content: 'How far am I on my goals?', page: '/essays', retry: false });
    expect(localStorage.getItem('hub:chat-conversation')).toBe('7');
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeTruthy();
  });

  it('shows an error inline and retries the same question', async () => {
    const fetchMock = stubHub({
      'GET /api/chat/status': () => json(READY),
      'GET /api/chat/conversations': () => json(NO_CONVERSATIONS),
      'POST /api/chat/conversations': () => json({ id: 3 }, 201),
      'POST /api/chat/conversations/3/messages': [
        () => sse([{ type: 'error', message: "Claude couldn't answer: the gateway is busy — retry in a minute" }]),
        () => sse([{ type: 'text', delta: 'Seven hours.' }, { type: 'done', messageId: 2 }]),
      ],
    });
    renderSidebar();

    const field = await screen.findByLabelText('Ask Claude');
    await userEvent.type(field, 'How did I sleep?{Enter}');

    expect((await screen.findByRole('alert')).textContent).toContain("Claude couldn't answer: the gateway is busy");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Seven hours.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    const sends = fetchMock.mock.calls.filter(([path]) => path === '/api/chat/conversations/3/messages');
    expect(sends.map(([, init]) => bodyOf(init).retry)).toEqual([false, true]);
    expect(screen.getAllByText('How did I sleep?')).toHaveLength(1);
  });

  it('adds a line on Shift+Enter instead of sending', async () => {
    const fetchMock = stubHub({ 'GET /api/chat/status': () => json(READY), 'GET /api/chat/conversations': () => json(NO_CONVERSATIONS) });
    renderSidebar();
    const field = (await screen.findByLabelText('Ask Claude')) as HTMLTextAreaElement;
    await userEvent.type(field, 'Line one{Shift>}{Enter}{/Shift}Line two');
    expect(field.value).toBe('Line one\nLine two');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('collapses to a rail and opens again', async () => {
    stubHub({ 'GET /api/chat/status': () => json(READY), 'GET /api/chat/conversations': () => json(NO_CONVERSATIONS) });
    renderSidebar();
    await userEvent.click(await screen.findByRole('button', { name: 'Collapse chat' }));
    expect(screen.queryByLabelText('Ask Claude')).toBeNull();
    expect(localStorage.getItem('hub:chat-open')).toBe('0');
    expect(document.documentElement.style.getPropertyValue('--chat-space')).toBe('72px');
    await userEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(await screen.findByLabelText('Ask Claude')).toBeTruthy();
  });

  it('opens as a sheet from the Ask pill on a narrow screen', async () => {
    stubWidth(false);
    stubHub({ 'GET /api/chat/status': () => json(READY), 'GET /api/chat/conversations': () => json(NO_CONVERSATIONS) });
    renderSidebar();
    expect(screen.queryByLabelText('Ask Claude')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--chat-space')).toBe('');

    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chat' });
    expect(dialog).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Ask Claude')));

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('earlier chats', () => {
  it('opens one from the ▾ list, and deletes another', async () => {
    const list: ChatConversation[] = [
      { id: 2, title: 'How did I sleep?', createdAt: '2026-11-22T10:00:00.000Z', updatedAt: '2026-11-22T10:00:00.000Z' },
      { id: 1, title: 'Algebra this week', createdAt: '2026-11-21T10:00:00.000Z', updatedAt: '2026-11-21T10:00:00.000Z' },
    ];
    const fetchMock = stubHub({
      'GET /api/chat/status': () => json(READY),
      'GET /api/chat/conversations': [() => json(list), () => json(list.slice(0, 1))],
      'GET /api/chat/conversations/2': () =>
        json([
          { id: 5, role: 'user', content: 'How did I sleep?', createdAt: '2026-11-22T10:00:00.000Z' },
          { id: 6, role: 'assistant', content: 'Seven hours on average.', createdAt: '2026-11-22T10:00:01.000Z' },
        ]),
      'DELETE /api/chat/conversations/1': () => new Response(null, { status: 204 }),
    });
    renderSidebar();

    await userEvent.click(await screen.findByRole('button', { name: 'New chat — earlier chats' }));
    await userEvent.click(screen.getByRole('button', { name: /^How did I sleep\?/ }));
    expect(await screen.findByText('Seven hours on average.')).toBeTruthy();
    expect(localStorage.getItem('hub:chat-conversation')).toBe('2');

    await userEvent.click(await screen.findByRole('button', { name: 'How did I sleep? — earlier chats' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete “Algebra this week”' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path, init]) => path === '/api/chat/conversations/1' && init?.method === 'DELETE')).toBe(true));
    // The open chat stays open.
    expect(screen.getByText('Seven hours on average.')).toBeTruthy();
  });
});

describe('MessageView', () => {
  it('says what Claude is looking at while a tool runs', () => {
    const turns = [{ key: 'a', role: 'user' as const, content: 'What did I do this week?', id: 1 }];
    render(<MessageView turns={turns} streaming tool="list_sessions" error={null} onRetry={() => {}} empty={null} />);
    expect(screen.getByRole('status').textContent).toBe('Looking at your sessions…');
    expect(screen.getByRole('log').getAttribute('aria-busy')).toBe('true');
  });
});

describe('sseParser', () => {
  it('reads events split across chunks', () => {
    const seen: ChatEvent[] = [];
    const feed = sseParser((e) => seen.push(e));
    feed('event: text\ndata: {"type":"text","del');
    feed('ta":"Hi"}\n\nevent: done\ndata: {"type":"done","messageId":4}\n');
    expect(seen).toEqual([{ type: 'text', delta: 'Hi' }]);
    feed('\n');
    expect(seen).toEqual([
      { type: 'text', delta: 'Hi' },
      { type: 'done', messageId: 4 },
    ]);
  });
});
