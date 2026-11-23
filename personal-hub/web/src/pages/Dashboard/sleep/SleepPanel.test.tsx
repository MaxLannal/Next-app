import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SleepNight } from '@shared/types.ts';
import { SleepPanel } from './SleepPanel.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const night = (over: Partial<SleepNight>): SleepNight => ({
  night: '2026-11-22',
  bedtime: '2026-11-22T05:40:00.000Z',
  wake: '2026-11-22T13:12:00.000Z',
  inBedSeconds: 27120,
  asleepSeconds: 27000,
  stages: { awake: 1800, rem: 7200, core: 14400, deep: 5400, unspecified: 0 },
  source: 'Watch',
  score: 96,
  ...over,
});

function stubSleep(reply: unknown) {
  const fetchMock = vi.fn(async (path: string) => {
    if (path.startsWith('/api/sleep')) return json(reply);
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SleepPanel />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('SleepPanel', () => {
  it('asks the hub for the strip and last night only, not a year', async () => {
    const fetchMock = stubSleep({ nights: [], lastNight: null, lastSyncAt: null });
    renderPanel();
    await screen.findByText('Connect your iPhone');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/sleep\?nights=15$/), expect.anything());
  });

  it('asks for a calm connection until data arrives', async () => {
    stubSleep({ nights: [], lastNight: null, lastSyncAt: null });
    renderPanel();
    expect(await screen.findByText('Connect your iPhone')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open Settings' });
    expect(link.getAttribute('href')).toBe('/settings#sleep');
  });

  it('shows last night: when, total, score and the stages', async () => {
    stubSleep({ nights: [night({})], lastNight: night({}), lastSyncAt: '2026-11-22T13:12:00.000Z' });
    const { container } = renderPanel();
    const nightFigure = await waitFor(() => {
      const el = container.querySelector('[data-night="2026-11-22"]');
      if (!el) throw new Error('night not drawn');
      return el as HTMLElement;
    });
    expect(within(nightFigure).getByText(/→/).textContent).toMatch(/\d{2}:\d{2} → \d{2}:\d{2}/);
    expect(within(nightFigure).getByText('7 h 30 m')).toBeTruthy();
    expect(within(nightFigure).getByText('96')).toBeTruthy();
    const stageBar = within(nightFigure).getByRole('img', { name: /Stages for the night/ });
    expect(stageBar.querySelectorAll('[data-part]')).toHaveLength(4);
    expect(within(nightFigure).getByText('Watch')).toBeTruthy();
  });

  it('marks a short night in apricot and its score with it', async () => {
    const short = night({ asleepSeconds: 4 * 3600, score: 55, stages: { awake: 0, rem: 0, core: 0, deep: 0, unspecified: 0 } });
    stubSleep({ nights: [short], lastNight: short, lastSyncAt: null });
    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelector('.sleep__score.is-short')).not.toBeNull());
    expect(container.querySelector('.is-short')?.textContent).toContain('55');
  });

  it('draws fourteen nights in the strip and picks one on click', async () => {
    const user = userEvent.setup();
    const short = night({ night: '2026-11-20', asleepSeconds: 5 * 3600, score: 70 });
    const today = night({});
    stubSleep({ nights: [short, today], lastNight: today, lastSyncAt: null });
    const { container } = renderPanel();
    await screen.findByText('7 h 30 m');
    await waitFor(() => expect(container.querySelectorAll('.nights__svg g')).toHaveLength(14));
    // The 5 h night is under 6 h: its apricot dot says so.
    expect(container.querySelectorAll('.nights__dot').length).toBe(1);
    // Cells run oldest first: the recorded night is the second to last, then today.
    const cell = container.querySelectorAll('.nights__svg g')[
      [...container.querySelectorAll('.nights__svg g')].findIndex((g) => g.getAttribute('data-day') === '2026-11-20')
    ]?.querySelector('.nights__hit');
    if (!cell) throw new Error('no cell');
    await user.click(cell);
    await expect(screen.findByText('5 h 0 m')).resolves.toBeTruthy();
    expect(container.querySelector('[data-night="2026-11-20"]')).not.toBeNull();
  });
});
