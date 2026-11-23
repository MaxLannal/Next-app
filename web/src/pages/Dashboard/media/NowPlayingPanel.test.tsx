import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NowPlaying } from '@shared/types.ts';
import { NowPlayingPanel } from './NowPlayingPanel.tsx';

const TRACK: NowPlaying = { title: 'Pink + White', artist: 'Frank Ocean', album: 'Blonde', artwork: null, playing: true };
const ALLOW_LINE = 'Allow Hub in System Settings → Privacy & Security → Accessibility to control music';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (init?: RequestInit) => Response | Promise<Response>;

/** Answers `fetch` by "METHOD /path"; anything else fails the test. */
function stubHub(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel(ui: ReactNode = <NowPlayingPanel />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const status = (s: string): Handler => () => json({ status: s });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NowPlayingPanel', () => {
  it('stays hidden when the status is missing', async () => {
    const fetchMock = stubHub({ 'GET /api/media/status': status('missing') });
    const { container } = renderPanel();

    await waitFor(() => expect(container.childElementCount).toBe(0));
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain('/api/media/now');
  });

  it('asks for Accessibility in one line when it is not granted', async () => {
    stubHub({ 'GET /api/media/status': status('no-accessibility') });
    renderPanel();

    expect((await screen.findByText(ALLOW_LINE)).textContent).toBe(ALLOW_LINE);
  });

  it('shows controls and the track', async () => {
    stubHub({
      'GET /api/media/status': status('ready'),
      'GET /api/media/now': () => json(TRACK),
    });
    renderPanel();

    expect((await screen.findByRole('heading', { name: 'Now playing' })).textContent).toBe('Now playing');
    expect((await screen.findByText('Pink + White')).textContent).toBe('Pink + White');
    expect(screen.getByText('Frank Ocean').textContent).toBe('Frank Ocean');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
  });

  it('shows controls only when the track is unavailable', async () => {
    stubHub({
      'GET /api/media/status': status('ready'),
      'GET /api/media/now': () => json(null),
    });
    renderPanel();

    expect(await screen.findByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.queryByText('Pink + White')).toBeNull();
  });

  it('posts the media key', async () => {
    const fetchMock = stubHub({
      'GET /api/media/status': status('ready'),
      'GET /api/media/now': () => json(TRACK),
      'POST /api/media/key': () => new Response(null, { status: 204 }),
    });
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Next' }));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe('/api/media/key');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ key: 'next' });
  });

  it('polls every five seconds while visible', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = stubHub({
        'GET /api/media/status': status('ready'),
        'GET /api/media/now': () => json(TRACK),
      });
      renderPanel();
      await vi.waitFor(() => expect(screen.getByText('Pink + White').textContent).toBe('Pink + White'));
      const nowReads = () => fetchMock.mock.calls.filter(([path]) => path === '/api/media/now').length;
      expect(nowReads()).toBe(1);

      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() => expect(nowReads()).toBe(2));
    } finally {
      vi.useRealTimers();
    }
  });
});
