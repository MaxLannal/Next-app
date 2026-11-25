import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarResponse, FocusSession, Subject } from '@shared/types.ts';
import { DayTimeline } from './DayTimeline.tsx';

// Dates show in the system time zone; pin it to the hub's for this file.
beforeAll(() => {
  vi.stubEnv('TZ', 'America/Chicago');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const at = (hhmm: string, day = '2026-11-22') => `${day}T${hhmm}:00.000-06:00`;
const maths: Subject = { id: 3, name: 'Mathematics' };

function session(over: Partial<FocusSession> & Pick<FocusSession, 'id' | 'name' | 'events'>): FocusSession {
  return {
    subject: maths,
    tags: [],
    goalId: null,
    notes: '',
    status: 'done',
    startedAt: over.events[0]!.at,
    endedAt: null,
    focusSeconds: 0,
    autoPausedAt: null,
    attachmentCount: 0,
    ...over,
  };
}

function event(over: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'title' | 'start' | 'end'>): CalendarEvent {
  return { allDay: false, calendar: 'Classes', color: '#e0a060', location: null, notes: null, url: null, ...over };
}

// Sunday 22 November, 12:00 in Chicago. Homework 09:00–10:30 with a pause, a lecture 10:30–11:20.
const homework = session({
  id: 7,
  name: 'HW7 Question 1',
  events: [
    { type: 'start', at: at('09:00') },
    { type: 'pause', at: at('09:40') },
    { type: 'resume', at: at('10:00') },
    { type: 'stop', at: at('10:30') },
  ],
});
const lecture = event({ id: 'l', title: 'STAT 251 lecture', start: at('10:30'), end: at('11:20'), location: 'Ryerson 251' });
const reading = event({ id: 'r', title: 'Reading week', start: '2026-11-22T06:00:00.000Z', end: '2026-11-23T06:00:00.000Z', allDay: true, calendar: 'Home' });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Replies = { sessions?: () => Response; calendar?: () => Response };
let requested: URL[];
function serve({ sessions = () => json([]), calendar = () => json({ events: [], source: 'eventkit' } satisfies CalendarResponse) }: Replies) {
  requested = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      const url = new URL(path, 'http://localhost');
      requested.push(url);
      if (url.pathname === '/api/subjects') return json([{ id: 1, name: 'Next' }, maths]);
      if (url.pathname === '/api/sessions') return sessions();
      if (url.pathname === '/api/calendar') return calendar();
      return json({ error: 'Not found' }, 404);
    }),
  );
}

function renderTimeline(ui: ReactNode = <DayTimeline />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(at('12:00')));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('DayTimeline', () => {
  it('fills in each stretch of focus and each event, and totals the day', async () => {
    serve({ sessions: () => json([homework]), calendar: () => json({ events: [lecture, reading], source: 'eventkit' }) });
    renderTimeline();

    const stretches = await screen.findAllByRole('link', { name: /HW7 Question 1/ });
    expect(stretches.map((s) => s.getAttribute('aria-label'))).toEqual([
      'HW7 Question 1, focus, Mathematics, 09:00–09:40',
      'HW7 Question 1, focus, Mathematics, 10:00–10:30',
    ]);
    expect(stretches[0]?.getAttribute('href')).toBe('/database/session/7');
    expect(screen.getByRole('button', { name: 'STAT 251 lecture, event, Classes, 10:30–11:20' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reading week' })).toBeTruthy();
    expect(screen.getByText('1 h 10 m focus · 2 events')).toBeTruthy();
  });

  it('asks for sessions from the day before, so one running past midnight is drawn', async () => {
    serve({});
    renderTimeline();

    await screen.findByText('Focus sessions and calendar events fill in here as the day goes.');
    const sessions = requested.find((u) => u.pathname === '/api/sessions');
    expect(sessions?.searchParams.get('from')).toBe('2026-11-21');
    expect(sessions?.searchParams.get('to')).toBe('2026-11-23');
    const calendar = requested.find((u) => u.pathname === '/api/calendar');
    expect(calendar?.searchParams.get('from')).toBe('2026-11-22T06:00:00.000Z');
  });

  it('grows the running session to the now line', async () => {
    const running = session({ id: 8, name: 'Quantum notes', status: 'running', events: [{ type: 'start', at: at('11:15') }] });
    serve({ sessions: () => json([running]) });
    renderTimeline();

    const block = await screen.findByRole('link', { name: 'Quantum notes, focus, Mathematics, 11:15–now' });
    expect(block.classList.contains('is-live')).toBe(true);
    expect(screen.getByText('Now,')).toBeTruthy();
  });

  it('opens an event’s details', async () => {
    const user = userEvent.setup();
    serve({ calendar: () => json({ events: [lecture], source: 'eventkit' }) });
    renderTimeline();

    await user.click(await screen.findByRole('button', { name: /STAT 251 lecture/ }));
    expect(screen.getByRole('dialog', { name: 'STAT 251 lecture' }).textContent).toContain('Ryerson 251');
  });

  it('still draws focus when the Mac refuses calendar access', async () => {
    serve({
      sessions: () => json([homework]),
      calendar: () => json({ error: 'Calendar access not granted', fix: 'Run npm run setup in Terminal on the Mac' }, 503),
    });
    renderTimeline();

    expect(await screen.findByText('Run npm run setup in Terminal on the Mac')).toBeTruthy();
    expect((await screen.findAllByRole('link', { name: /HW7 Question 1/ })).length).toBe(2);
  });

  it('says when events come from the Calendar app', async () => {
    serve({ calendar: () => json({ events: [lecture], source: 'calendar-app' }) });
    renderTimeline();

    expect(await screen.findByText('From the Calendar app — repeating events may be missing')).toBeTruthy();
  });
});
