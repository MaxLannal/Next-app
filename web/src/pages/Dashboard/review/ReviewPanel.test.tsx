import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, FocusSession, Subject } from '@shared/types.ts';
import { ReviewPanel } from './ReviewPanel.tsx';

// Dates show in the system time zone; pin it to the hub's for this file.
beforeAll(() => {
  vi.stubEnv('TZ', 'America/Chicago');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const at = (day: string, hhmm: string) => `${day}T${hhmm}:00.000-06:00`;
const next: Subject = { id: 1, name: 'Next' };
const maths: Subject = { id: 3, name: 'Mathematics' };

function session(id: number, subject: Subject, day: string, from: string, to: string): FocusSession {
  return {
    id,
    name: `Session ${id}`,
    subject,
    tags: [],
    goalId: null,
    notes: '',
    status: 'done',
    startedAt: at(day, from),
    endedAt: at(day, to),
    focusSeconds: 0,
    autoPausedAt: null,
    attachmentCount: 0,
    events: [
      { type: 'start', at: at(day, from) },
      { type: 'stop', at: at(day, to) },
    ],
  };
}

function event(id: string, day: string, from: string, to: string): CalendarEvent {
  return { id, title: `Lecture ${id}`, start: at(day, from), end: at(day, to), allDay: false, calendar: 'Classes', color: '#e0a060', location: null, notes: null, url: null };
}

// Wednesday 18 November 2026, 12:00 in Chicago; the week runs Monday 16 to Sunday 22.
const NOW = at('2026-11-18', '12:00');
const sessions = [
  session(1, maths, '2026-11-16', '09:00', '11:00'),
  session(2, next, '2026-11-16', '14:00', '15:00'),
  session(3, maths, '2026-11-17', '20:00', '21:30'),
];
const events = [event('a', '2026-11-17', '10:30', '11:20'), event('b', '2026-11-18', '11:00', '13:00'), event('c', '2026-11-20', '10:30', '11:20')];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let requested: URL[];
function serve() {
  requested = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      const url = new URL(path, 'http://localhost');
      requested.push(url);
      if (url.pathname === '/api/subjects') return json([next, { id: 2, name: 'Quarterly' }, maths]);
      if (url.pathname === '/api/sessions') return json(sessions);
      if (url.pathname === '/api/calendar') return json({ events, source: 'eventkit' });
      return json({ error: 'Not found' }, 404);
    }),
  );
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReviewPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  serve();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ReviewPanel', () => {
  it('draws the week as a bar a day, each split into its sessions and events', async () => {
    renderPanel();

    const monday = await screen.findByRole('button', { name: /^Monday 16 November: 3 h 0 m focus/ });
    expect(monday.getAttribute('aria-label')).toBe('Monday 16 November: 3 h 0 m focus. Mathematics 2 h 0 m, Next 1 h 0 m');
    expect(monday.querySelectorAll('.rv__seg.is-focus')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Tuesday 17 November: 1 h 30 m focus, 1 event. Mathematics 1 h 30 m, Classes 50 m' })).toBeTruthy();
    expect(screen.getByText('16 – 22 Nov 2026')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /November/ })).toHaveLength(7);

    // Subjects keep their colour by id: Next is the first hue, Mathematics the third.
    const [first, second] = [...monday.querySelectorAll<HTMLElement>('.rv__seg')];
    expect(first?.style.getPropertyValue('--fill')).toBe('#199d78');
    expect(second?.style.getPropertyValue('--fill')).toBe('#6e7ed4');
  });

  it('reviews only what has happened: today stops at now, days to come stay empty', async () => {
    renderPanel();

    // The 11:00–13:00 lecture today counts its first hour; Friday's lecture is still to come.
    expect(await screen.findByRole('button', { name: 'Wednesday 18 November: 1 event. Classes 1 h 0 m' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Friday 20 November: nothing logged' })).toBeTruthy();
    expect(screen.getByText('4 h 30 m focus · 2 events')).toBeTruthy();
  });

  it('totals the range by subject and calendar in the legend', async () => {
    renderPanel();

    const legend = await screen.findByRole('list', { name: 'Time by subject and calendar' });
    await waitFor(() => expect(legend.textContent).toBe('Mathematics3 h 30 mNext1 h 0 mClasses1 h 50 m'));
  });

  it('reads a day under the pointer', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.hover(await screen.findByRole('button', { name: /^Monday 16 November/ }));
    expect(screen.getByText('Monday 16 November')).toBeTruthy();
    expect(screen.getByText('Mathematics 2 h 0 m')).toBeTruthy();
  });

  it('shows the month as a thin bar for every day, and steps back a month', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('tab', { name: 'Month' }));
    expect(await screen.findByText('November 2026')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /November:/ })).toHaveLength(30);

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByText('October 2026')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /October:/ })).toHaveLength(31);
    const asked = requested.filter((u) => u.pathname === '/api/sessions').at(-1);
    expect(asked?.searchParams.get('from')).toBe('2026-09-30');
    expect(asked?.searchParams.get('to')).toBe('2026-11-01');
    expect(screen.getByRole('button', { name: 'This month' })).toBeTruthy();
  });
});
