import type { HeatmapDay, HeatmapStats, SubjectSlice } from '@shared/types.ts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YearOfFocusPanel } from './YearOfFocusPanel.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const H = 3600;

const nov3: HeatmapDay = {
  date: '2026-11-03',
  seconds: 2 * H + 15 * 60,
  level: 4,
  subjects: [
    { subjectId: 2, name: 'Essay', seconds: 35 * 60 },
    { subjectId: 1, name: 'Algebra', seconds: H + 40 * 60 },
  ],
};

const stats: HeatmapStats = {
  days: [nov3],
  totals: { seconds: 4785, activeDays: 1, longestStreak: 1, currentStreak: 0 },
  years: [2026, 2025],
};

const algebra: SubjectSlice[] = [{ subjectId: 1, name: 'Algebra', seconds: H + 40 * 60 }];
const essay: SubjectSlice[] = [{ subjectId: 2, name: 'Essay', seconds: 35 * 60 }];

type Handler = () => Response;
function stubHub(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn(async (path: string) => {
    const handler = handlers[`GET ${path}`];
    if (!handler) throw new Error(`Unexpected request: GET ${path}`);
    return handler();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <YearOfFocusPanel />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const yearRequests = { 'GET /api/stats/heatmap?year=2026': () => json(stats), 'GET /api/stats/subjects?range=year&date=2026-01-01': () => json(algebra) };

describe('YearOfFocusPanel', () => {
  it('offers every year with focus, newest first, and opens on the current one', async () => {
    stubHub(yearRequests);
    renderPanel();

    const select = (await screen.findByRole('combobox', { name: 'Year' })) as HTMLSelectElement;
    await waitFor(() => expect([...select.options].map((o) => o.value)).toEqual(['2026', '2025']));
    expect(select.value).toBe(String(new Date().getFullYear()));
    expect(screen.getByRole('grid', { name: 'Days of 2026' })).toBeTruthy();
  });

  it('opens on the year: its ring, the day rule and the ruled tally', async () => {
    stubHub(yearRequests);
    renderPanel();

    // The year by default: the ring's label and its year, and the tally under it.
    await waitFor(() => expect(screen.getByRole('img', { name: 'Focus by subject in 2026' })).toBeTruthy());
    const tally = () => screen.getByLabelText('Year totals').textContent;
    expect(tally()).toBe('Total hours1 h 19 mActive days1Longest streak1 dayCurrent streak0 days');
    expect(new Date().getFullYear()).toBe(2026);
  });

  it('shows a day while it is hovered, and the year again once the pointer leaves', async () => {
    const user = userEvent.setup();
    const fetchMock = stubHub({
      ...yearRequests,
      'GET /api/stats/subjects?range=day&date=2026-11-03': () => json([...algebra, ...essay]),
    });
    renderPanel();

    const cell = (await screen.findByRole('grid')).querySelector('rect[data-date="2026-11-03"]');
    if (!(cell instanceof SVGElement)) throw new Error('no cell');
    expect(cell.getAttribute('aria-label')).toBe('Tue 3 Nov · 2 h 15 m focused · mostly Algebra');

    await user.hover(cell);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Focus by subject on Tue 3 Nov' })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/stats/subjects?range=day&date=2026-11-03', expect.anything());

    await user.unhover(cell);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Focus by subject in 2026' })).toBeTruthy());
  });

  it('asks for a hovered day once, then serves it from the cache', async () => {
    const user = userEvent.setup();
    const fetchMock = stubHub({
      ...yearRequests,
      'GET /api/stats/subjects?range=day&date=2026-11-03': () => json([...algebra, ...essay]),
    });
    renderPanel();

    const grid = await screen.findByRole('grid');
    const cell = grid.querySelector('rect[data-date="2026-11-03"]');
    if (!(cell instanceof SVGElement)) throw new Error('no cell');
    const dayRequests = () => fetchMock.mock.calls.filter(([path]) => path === '/api/stats/subjects?range=day&date=2026-11-03').length;

    // Hover, leave (the year again), come back: the reply is fetched only once.
    await user.hover(cell);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Focus by subject on Tue 3 Nov' })).toBeTruthy());
    await user.unhover(cell);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Focus by subject in 2026' })).toBeTruthy());
    await user.hover(cell);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Focus by subject on Tue 3 Nov' })).toBeTruthy());
    expect(dayRequests()).toBe(1);
  });

  it('shows a hovered day with no focus as an empty ring, not an error', async () => {
    const user = userEvent.setup();
    stubHub({
      ...yearRequests,
      // The grid says the day has focus; the subjects reply has none to show.
      'GET /api/stats/subjects?range=day&date=2026-11-03': () => json([]),
    });
    renderPanel();

    const grid = await screen.findByRole('grid');
    const cell = grid.querySelector('rect[data-date="2026-11-03"]');
    if (!(cell instanceof SVGElement)) throw new Error('no cell');
    await user.hover(cell);

    const ring = await screen.findByRole('img', { name: 'Focus by subject on Tue 3 Nov' });
    expect(ring.querySelectorAll('path[data-slice]')).toHaveLength(0);
    expect(ring.querySelectorAll('circle')).toHaveLength(1);
    const side = screen.getByLabelText('Year totals').parentElement;
    expect(side?.textContent).not.toContain('retry');
    expect(screen.queryByRole('listitem')).toBeNull();
    // The ring holes says the day's time; its legend, with nothing to split, is absent.
    expect(ring.querySelector('.pie__bottom')?.textContent).toBe('focus that day');
  });

  it('writes the tally in the app’s duration format', async () => {
    stubHub({
      ...yearRequests,
      'GET /api/stats/heatmap?year=2026': () => json({ ...stats, totals: { seconds: 0, activeDays: 0, longestStreak: 0, currentStreak: 0 } }),
    });
    renderPanel();

    await waitFor(() => expect(screen.getByLabelText('Year totals').textContent).toContain('Total hours0 m'));
  });

  it('pins a clicked day until Esc', async () => {
    const user = userEvent.setup();
    stubHub({
      ...yearRequests,
      'GET /api/stats/subjects?range=day&date=2026-11-03': () => json([...algebra, ...essay]),
    });
    renderPanel();

    const cell = (await screen.findByRole('grid')).querySelector('rect[data-date="2026-11-03"]');
    if (!(cell instanceof SVGElement)) throw new Error('no cell');
    await user.click(cell);

    const day = await screen.findByRole('img', { name: 'Focus by subject on Tue 3 Nov' });
    await waitFor(() => expect(document.querySelector('.yof__pin')).not.toBeNull());

    // Leaving the grid does not release a clicked day.
    await user.click(document.body);
    expect(screen.getByRole('img', { name: 'Focus by subject on Tue 3 Nov' })).toBeTruthy();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('img', { name: 'Focus by subject in 2026' })).toBeTruthy());
    expect(screen.queryByText(/pinned/)).toBeNull();
  });

  it('offers a retry when the year will not load', async () => {
    stubHub({ 'GET /api/stats/heatmap?year=2026': () => json({ error: 'The hub is resting' }, 500) });
    renderPanel();

    expect(await screen.findByText('Couldn’t load this year')).toBeTruthy();
    expect(screen.getByText('The hub is resting')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
