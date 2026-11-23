import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExerciseReply } from '@shared/types.ts';
import { ExercisePanel } from './ExercisePanel.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const hourBuckets = () =>
  Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, '0'), value: h === 12 ? 45 : 0 }));

const reply = (over: { pushups?: number; squats?: number } = {}): ExerciseReply => {
  const pushups = over.pushups ?? 45;
  const squats = over.squats ?? 0;
  return {
    today: { pushups, squats },
    series: {
      pushups: { buckets: hourBuckets(), total: pushups, dailyAverage: pushups },
      squats: { buckets: hourBuckets().map(() => ({ label: '00', value: 0 })), total: squats, dailyAverage: squats },
    },
  };
};

type Handler = (init?: RequestInit) => Response | Promise<Response>;

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

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ExercisePanel />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const pushupRow = () => screen.getByRole('group', { name: 'Push-ups' });

describe('ExercisePanel', () => {
  it('shows today’s totals, the tabs and both charts', async () => {
    stubHub({ 'GET /api/exercise?range=day': () => json(reply()) });
    renderPanel();

    await waitFor(() => expect(within(pushupRow()).getByText('45')).toBeTruthy());
    expect(within(screen.getByRole('group', { name: 'Squats' })).getByText('0')).toBeTruthy();

    for (const name of ['Day', 'Week', 'Month', 'Year']) {
      expect(screen.getByRole('tab', { name })).toBeTruthy();
    }
    expect(screen.getByRole('tab', { name: 'Day' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('img', { name: 'Push-ups by day' })).toBeTruthy();
    // A ruled tally per chart, no stat tiles.
    const tally = screen.getAllByRole('term').map((t) => t.textContent);
    expect(tally).toContain('Total');
    expect(tally).toContain('Daily average');
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual(['45', '45']);
    // Nothing logged means no chart, never a flat one.
    expect(screen.queryByRole('img', { name: 'Squats by day' })).toBeNull();
    expect(screen.getByText('Nothing yet')).toBeTruthy();
  });

  it('quick-add buttons post a count and refresh', async () => {
    const user = userEvent.setup();
    let posts = 0;
    const fetchMock = stubHub({
      'GET /api/exercise?range=day': () => json(reply({ pushups: posts === 0 ? 45 : 50 })),
      'POST /api/exercise': () => {
        posts++;
        return json({ kind: 'pushups', count: 5 }, 201);
      },
    });
    renderPanel();
    await waitFor(() => expect(within(pushupRow()).getByText('45')).toBeTruthy());

    await user.click(within(pushupRow()).getByRole('button', { name: '+5' }));
    await waitFor(() => expect(within(pushupRow()).getByText('50')).toBeTruthy());

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe('/api/exercise');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ kind: 'pushups', count: 5 });
  });

  it('a typed count posts on Enter', async () => {
    const user = userEvent.setup();
    const fetchMock = stubHub({
      'GET /api/exercise?range=day': () => json(reply()),
      'POST /api/exercise': () => json({ kind: 'squats', count: 12 }, 201),
    });
    renderPanel();
    await waitFor(() => expect(within(pushupRow()).getByText('45')).toBeTruthy());

    const squashRow = screen.getByRole('group', { name: 'Squats' });
    const field = within(squashRow).getByRole('spinbutton', { name: 'Custom amount' });
    await user.type(field, '12{Enter}');

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ kind: 'squats', count: 12 });
    await waitFor(() => expect((field as HTMLInputElement).value).toBe(''));
  });

  it('does not post an empty or bad custom count', async () => {
    const user = userEvent.setup();
    const fetchMock = stubHub({ 'GET /api/exercise?range=day': () => json(reply()) });
    renderPanel();
    await waitFor(() => expect(within(pushupRow()).getByText('45')).toBeTruthy());

    const field = within(pushupRow()).getByRole('spinbutton', { name: 'Custom amount' });
    await user.type(field, '0{Enter}');
    await user.type(field, '{Enter}');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    // The bad value stays put for editing rather than vanishing.
    expect((field as HTMLInputElement).value).toBe('0');
    await user.clear(field);
    await user.type(field, '20000{Enter}');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('undo deletes the last of today', async () => {
    const user = userEvent.setup();
    const fetchMock = stubHub({
      'GET /api/exercise?range=day': () => json(reply()),
      'DELETE /api/exercise/last?kind=pushups': () => new Response(null, { status: 204 }),
    });
    renderPanel();
    await waitFor(() => expect(within(pushupRow()).getByText('45')).toBeTruthy());

    await user.click(within(pushupRow()).getByRole('button', { name: 'Undo last' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
  });

  it('says so when there is nothing to undo', async () => {
    const user = userEvent.setup();
    stubHub({
      'GET /api/exercise?range=day': () => json(reply()),
      'DELETE /api/exercise/last?kind=pushups': () => json({ error: 'Nothing logged today' }, 404),
    });
    renderPanel();
    await waitFor(() => expect(within(pushupRow()).getByText('45')).toBeTruthy());

    await user.click(within(pushupRow()).getByRole('button', { name: 'Undo last' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Nothing logged today to undo');
  });

  it('switching the range asks for that range and names the chart', async () => {
    const user = userEvent.setup();
    const fetchMock = stubHub({
      'GET /api/exercise?range=day': () => json(reply()),
      'GET /api/exercise?range=week': () => json(reply()),
    });
    renderPanel();
    await waitFor(() => expect(screen.getByRole('img', { name: 'Push-ups by day' })).toBeTruthy());

    await user.click(screen.getByRole('tab', { name: 'Week' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Push-ups by week' })).toBeTruthy());
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/exercise?range=week')).toBe(true);
  });

  it('keeps the count when the hub rejects it', async () => {
    const user = userEvent.setup();
    stubHub({
      'GET /api/exercise?range=day': () => json(reply()),
      'POST /api/exercise': () => json({ error: "Couldn't save that — retry" }, 500),
    });
    renderPanel();
    await waitFor(() => expect(within(pushupRow()).getByText('45')).toBeTruthy());

    await user.click(within(pushupRow()).getByRole('button', { name: '+10' }));
    expect((await screen.findByRole('alert')).textContent).toContain('retry');
  });
});
