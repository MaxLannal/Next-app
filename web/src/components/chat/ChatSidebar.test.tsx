import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/** Renders the chat at `path`; `open` (the default) starts it open, as a saved choice would. */
function renderSidebar(path = '/', { open = true }: { open?: boolean } = {}) {
  if (open) localStorage.setItem('hub:chat-open', '1');
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

/** An SSE reply that sends `first`, then stays open until the request is aborted. */
function openStream(init: RequestInit | undefined, first: ChatEvent[] = []): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of first) controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

const QUIET = { 'GET /api/chat/status': () => json(READY), 'GET /api/chat/conversations': () => json(NO_CONVERSATIONS) };

beforeEach(() => {
  localStorage.clear();
  stubWidth(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChatSidebar', () => {
  it('offers three example questions when the chat is empty', async () => {
    stubHub({ 'GET /api/chat/status': () => json(READY), 'GET /api/chat/conversations': () => json(NO_CONVERSATIONS) });
    renderSidebar();
    expect(await screen.findByText('Ask about your goals, sessions or essays')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'How far am I on my goals?' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /\?$/ })).toHaveLength(3);
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
          { type: 'saved', messageId: 1 },
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
    expect(bodyOf(send?.[1])).toEqual({ content: 'How far am I on my goals?', page: '/essays' });
    expect(localStorage.getItem('hub:chat-conversation')).toBe('7');
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeTruthy();
  });

  it('shows an error inline and retries from the saved question', async () => {
    const fetchMock = stubHub({
      'GET /api/chat/status': () => json(READY),
      'GET /api/chat/conversations': () => json(NO_CONVERSATIONS),
      'POST /api/chat/conversations': () => json({ id: 3 }, 201),
      'POST /api/chat/conversations/3/messages': [
        () => sse([{ type: 'saved', messageId: 11 }, { type: 'error', message: 'Claude couldn’t answer: the gateway is busy — retry in a minute' }]),
        () => sse([{ type: 'saved', messageId: 12 }, { type: 'text', delta: 'Seven hours.' }, { type: 'done', messageId: 13 }]),
      ],
    });
    renderSidebar();

    const field = await screen.findByLabelText('Ask Claude');
    await userEvent.type(field, 'How did I sleep?{Enter}');

    expect((await screen.findByRole('alert')).textContent).toContain('Claude couldn’t answer: the gateway is busy');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Seven hours.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    const sends = fetchMock.mock.calls.filter(([path]) => path === '/api/chat/conversations/3/messages');
    expect(sends.map(([, init]) => bodyOf(init).replaceFrom)).toEqual([undefined, 11]);
    expect(screen.getAllByText('How did I sleep?')).toHaveLength(1);
  });

  it('asks again without replacing anything when the question never reached the hub', async () => {
    const fetchMock = stubHub({
      ...QUIET,
      'POST /api/chat/conversations': () => json({ id: 3 }, 201),
      'POST /api/chat/conversations/3/messages': [
        () => {
          throw new TypeError('Failed to fetch');
        },
        () => sse([{ type: 'saved', messageId: 12 }, { type: 'text', delta: 'Seven hours.' }, { type: 'done', messageId: 13 }]),
      ],
    });
    renderSidebar();
    await userEvent.type(await screen.findByLabelText('Ask Claude'), 'How did I sleep?{Enter}');

    expect((await screen.findByRole('alert')).textContent).toBe('Couldn’t reach the hub');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Seven hours.')).toBeTruthy();
    const sends = fetchMock.mock.calls.filter(([path]) => path === '/api/chat/conversations/3/messages');
    expect(sends.map(([, init]) => 'replaceFrom' in bodyOf(init))).toEqual([false, false]);
    expect(screen.getAllByText('How did I sleep?')).toHaveLength(1);
  });

  it('says the answer stopped early when the stream ends without a finish', async () => {
    stubHub({
      ...QUIET,
      'POST /api/chat/conversations': () => json({ id: 3 }, 201),
      'POST /api/chat/conversations/3/messages': () => sse([{ type: 'saved', messageId: 11 }, { type: 'text', delta: 'Half an' }]),
    });
    renderSidebar();
    await userEvent.type(await screen.findByLabelText('Ask Claude'), 'How did I sleep?{Enter}');
    expect((await screen.findByRole('alert')).textContent).toBe('The answer stopped early — retry');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('starts a new chat and asks once more when the open one was deleted elsewhere', async () => {
    localStorage.setItem('hub:chat-conversation', '7');
    const fetchMock = stubHub({
      ...QUIET,
      'GET /api/chat/conversations/7': () => json([]),
      'POST /api/chat/conversations/7/messages': () => json({ error: 'Not found' }, 404),
      'POST /api/chat/conversations': () => json({ id: 8 }, 201),
      'POST /api/chat/conversations/8/messages': () => sse([{ type: 'saved', messageId: 1 }, { type: 'text', delta: 'Seven hours.' }, { type: 'done', messageId: 2 }]),
    });
    renderSidebar();
    await userEvent.type(await screen.findByLabelText('Ask Claude'), 'How did I sleep?{Enter}');

    expect(await screen.findByText('Seven hours.')).toBeTruthy();
    expect(localStorage.getItem('hub:chat-conversation')).toBe('8');
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/chat/conversations/8/messages')).toHaveLength(1);
  });

  it('offers Retry after Stop pressed before any of the answer arrived', async () => {
    const fetchMock = stubHub({
      ...QUIET,
      'POST /api/chat/conversations': () => json({ id: 3 }, 201),
      'POST /api/chat/conversations/3/messages': [
        (init) => openStream(init, [{ type: 'saved', messageId: 11 }]),
        () => sse([{ type: 'saved', messageId: 12 }, { type: 'text', delta: 'Seven hours.' }, { type: 'done', messageId: 13 }]),
      ],
    });
    renderSidebar();
    await userEvent.type(await screen.findByLabelText('Ask Claude'), 'How did I sleep?{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));

    expect(await screen.findByText('Stopped before Claude answered')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Seven hours.')).toBeTruthy();
    const sends = fetchMock.mock.calls.filter(([path]) => path === '/api/chat/conversations/3/messages');
    expect(bodyOf(sends[1][1]).replaceFrom).toBe(11);
  });

  it('adds a line on Shift+Enter instead of sending', async () => {
    const fetchMock = stubHub({ 'GET /api/chat/status': () => json(READY), 'GET /api/chat/conversations': () => json(NO_CONVERSATIONS) });
    renderSidebar();
    const field = (await screen.findByLabelText('Ask Claude')) as HTMLTextAreaElement;
    await userEvent.type(field, 'Line one{Shift>}{Enter}{/Shift}Line two');
    expect(field.value).toBe('Line one\nLine two');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('opens as a sheet from the pill on a narrow screen', async () => {
    stubWidth(false);
    stubHub(QUIET);
    renderSidebar('/', { open: false });
    expect(screen.queryByLabelText('Ask Claude')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Chat' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chat' });
    expect(dialog).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Ask Claude')));

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Chat' })));
  });
});

describe('the pill and the overlay', () => {
  it('starts closed as the pill alone, and never pads the page', async () => {
    stubHub(QUIET);
    renderSidebar('/', { open: false });
    const pill = screen.getByRole('button', { name: 'Chat' });
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByLabelText('Ask Claude')).toBeNull();
    expect(document.body.style.paddingRight).toBe('');
    expect(document.documentElement.style.getPropertyValue('--chat-space')).toBe('');

    await userEvent.click(pill);
    expect(await screen.findByRole('complementary', { name: 'Chat' })).toBeTruthy();
    expect(document.body.style.paddingRight).toBe('');
    expect(document.documentElement.style.getPropertyValue('--chat-space')).toBe('');
  });

  it('opens over the page from the pill; × and Esc close it, with focus back on the pill', async () => {
    stubHub(QUIET);
    renderSidebar('/', { open: false });
    const pill = screen.getByRole('button', { name: 'Chat' });

    await userEvent.click(pill);
    const panel = await screen.findByRole('complementary', { name: 'Chat' });
    expect(panel.className).toContain('chat--overlay');
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Ask Claude')));
    expect(screen.getByRole('separator').getAttribute('aria-valuemin')).toBe('320');
    expect(screen.getByRole('separator').getAttribute('aria-valuemax')).toBe('640');

    await userEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).toBe(pill);

    await userEvent.click(pill);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Ask Claude')));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).toBe(pill);
  });

  it('stays open when the user clicks elsewhere on the page', async () => {
    stubHub(QUIET);
    renderSidebar();
    expect(await screen.findByRole('complementary', { name: 'Chat' })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    expect(screen.getByRole('complementary', { name: 'Chat' })).toBeTruthy();
  });

  it('remembers open and closed across reloads', async () => {
    stubHub(QUIET);
    const first = renderSidebar('/', { open: false });
    await userEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(localStorage.getItem('hub:chat-open')).toBe('1');
    first.unmount();

    const second = renderSidebar('/essays', { open: false });
    expect(await screen.findByRole('complementary', { name: 'Chat' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(localStorage.getItem('hub:chat-open')).toBe('0');
    second.unmount();

    renderSidebar('/', { open: false });
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('narrow sheet before setup', () => {
  it('puts focus on the sheet heading, and Open Settings closes the sheet', async () => {
    stubWidth(false);
    const fetchMock = stubHub({
      'GET /api/chat/status': () => json({ configured: false, model: 'claude-opus-5-5' }),
      'GET /api/chat/conversations': () => json(NO_CONVERSATIONS),
    });
    renderSidebar('/', { open: false });
    // The status has arrived, so the field is off when the sheet opens.
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path === '/api/chat/status')).toBe(true));
    await act(async () => {});

    await userEvent.click(screen.getByRole('button', { name: 'Chat' }));
    const heading = await screen.findByRole('heading', { name: 'Chat' });
    await waitFor(() => expect(document.activeElement).toBe(heading));

    await userEvent.click(screen.getByRole('link', { name: 'Open Settings' }));
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

describe('small screens and input methods', () => {
  it('never reopens the sheet by itself on a narrow screen, even when open was saved', async () => {
    stubWidth(false);
    stubHub(QUIET);
    renderSidebar('/', { open: true });
    const pill = await screen.findByRole('button', { name: 'Chat' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(pill);
    expect(await screen.findByRole('dialog', { name: 'Chat' })).toBeTruthy();
  });

  it('keeps the overlay open when Esc only dismisses an input method candidate', async () => {
    stubWidth(true);
    stubHub(QUIET);
    renderSidebar('/', { open: true });
    const field = await screen.findByLabelText('Ask Claude');
    fireEvent.keyDown(field, { key: 'Escape', isComposing: true });
    expect(screen.getByLabelText('Ask Claude')).toBeTruthy();
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByLabelText('Ask Claude')).toBeNull());
  });
});
