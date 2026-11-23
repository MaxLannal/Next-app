import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@shared/types.ts';
import { CalendarPanel } from './CalendarPanel.tsx';
import { TodayAgenda } from './TodayAgenda.tsx';

// Dates show in the system time zone; pin it to the hub's for this file.
beforeAll(() => {
  vi.stubEnv('TZ', 'America/Chicago');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const event = (over: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'title' | 'start' | 'end'>): CalendarEvent => ({
  allDay: false,
  calendar: 'Classes',
  color: '#e0a060',
  location: null,
  notes: null,
  url: null,
  ...over,
});

// Times in Chicago: lecture 10:30, office hours 15:00, dinner Wednesday 18:00.
const lecture = event({ id: 'a', title: 'STAT 251 lecture', start: '2026-11-22T16:30:00.000Z', end: '2026-11-22T17:20:00.000Z', location: 'Ryerson 251' });
const office = event({ id: 'b', title: 'Office hours', start: '2026-11-22T21:00:00.000Z', end: '2026-11-22T22:00:00.000Z' });
const reading = event({ id: 'c', title: 'Reading week', start: '2026-11-22T06:00:00.000Z', end: '2026-11-23T05:59:59.000Z', allDay: true, calendar: 'Home', color: '#60b080' });
const dinner = event({
  id: 'd',
  title: 'Thanksgiving dinner',
  start: '2026-11-26T00:00:00.000Z',
  end: '2026-11-26T02:00:00.000Z',
  calendar: 'Home',
  location: 'Hyde Park',
  notes: 'Bring the pie',
  url: 'https://example.com/dinner',
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

let requested: URL[];
function serve(reply: () => Response) {
  requested = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      requested.push(new URL(path, 'http://localhost'));
      return reply();
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T18:00:00Z')); // Sunday 22 November, 12:00 in Chicago
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TodayAgenda', () => {
  it("lists today's events, marks the next one and reads today's range", async () => {
    serve(() => json({ events: [lecture, office, reading], source: 'eventkit' }));
    renderWithQuery(<TodayAgenda />);

    const rows = await screen.findAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'All dayReading week',
      '10:30STAT 251 lectureRyerson 251',
      'Next15:00Office hours',
    ]);
    expect(rows[2]?.classList.contains('is-next')).toBe(true);
    expect(requested[0]?.searchParams.get('from')).toBe('2026-11-22T06:00:00.000Z');
    expect(requested[0]?.searchParams.get('to')).toBe('2026-11-23T06:00:00.000Z');
  });

  it('says when the day is empty', async () => {
    serve(() => json({ events: [], source: 'eventkit' }));
    renderWithQuery(<TodayAgenda />);

    expect(await screen.findByText('Nothing on the calendar today')).toBeTruthy();
  });

  it('shows the fix when calendar access is refused', async () => {
    serve(() => json({ error: 'Calendar access not granted', fix: 'Run npm run setup in Terminal on the Mac' }, 503));
    renderWithQuery(<TodayAgenda />);

    expect(await screen.findByText('Run npm run setup in Terminal on the Mac')).toBeTruthy();
    expect(screen.getByText('Calendar access not granted')).toBeTruthy();
  });
});

it('says when events come from the Calendar app', async () => {
  serve(() => json({ events: [office], source: 'calendar-app' }));
  renderWithQuery(
    <>
      <TodayAgenda />
      <CalendarPanel />
    </>,
  );

  await waitFor(() => expect(screen.getAllByText('From the Calendar app — repeating events may be missing')).toHaveLength(2));
});

describe('CalendarPanel', () => {
  it('shows an empty range with no events and no source note', async () => {
    serve(() => json({ events: [], source: 'eventkit' }));
    renderWithQuery(<CalendarPanel />);

    const today = await screen.findByRole('button', { name: 'Sunday 22 November, no events' });
    expect(today.getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByText('Nothing on')).toBeTruthy();
    expect(screen.queryByText('From the Calendar app — repeating events may be missing')).toBeNull();
    // The grid is still there: every day of the shown month has no events.
    expect(screen.getByRole('button', { name: 'Monday 2 November, no events' })).toBeTruthy();
  });

  it('lists the selected day and opens an event', async () => {
    const user = userEvent.setup();
    serve(() => json({ events: [lecture, office, reading, dinner], source: 'eventkit' }));
    renderWithQuery(<CalendarPanel />);

    // Today is selected first.
    const today = await screen.findByRole('button', { name: 'Sunday 22 November, 3 events' });
    expect(today.getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByRole('button', { name: /Office hours/ })).toBeTruthy();
    expect(requested[0]?.searchParams.get('from')).toBe('2026-10-26T05:00:00.000Z');
    expect(requested[0]?.searchParams.get('to')).toBe('2026-12-07T06:00:00.000Z');

    await user.click(screen.getByRole('button', { name: 'Wednesday 25 November, 1 event' }));
    expect(screen.queryByRole('button', { name: /Office hours/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Thanksgiving dinner/ }));

    const dialog = screen.getByRole('dialog', { name: 'Thanksgiving dinner' });
    expect(within(dialog).getByText('Wednesday 25 November, 18:00–20:00')).toBeTruthy();
    expect(within(dialog).getByText('Hyde Park')).toBeTruthy();
    expect(within(dialog).getByText('Bring the pie')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'https://example.com/dinner' })).toBeTruthy();
  });

  it('lists the week grouped by day', async () => {
    const user = userEvent.setup();
    serve(() => json({ events: [lecture, office, reading], source: 'eventkit' }));
    renderWithQuery(<CalendarPanel />);

    await user.click(screen.getByRole('tab', { name: 'Week' }));

    const sunday = await screen.findByRole('group', { name: 'Sun 22 Nov' });
    await waitFor(() => expect(within(sunday).getAllByRole('button')).toHaveLength(3));
    expect(within(screen.getByRole('group', { name: 'Mon 16 Nov' })).getByText('Nothing on')).toBeTruthy();
    expect(requested.at(-1)?.searchParams.get('from')).toBe('2026-11-16T06:00:00.000Z');
    expect(requested.at(-1)?.searchParams.get('to')).toBe('2026-11-23T06:00:00.000Z');
  });
});
