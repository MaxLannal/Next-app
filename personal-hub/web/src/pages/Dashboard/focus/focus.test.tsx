import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Attachment, FocusSession, Subject } from '@shared/types.ts';
import { TimerPill } from '../../../components/TimerPill.tsx';
import { FocusPanel } from './FocusPanel.tsx';
import { anchorReply, focusElapsed, useCurrentSession } from './useSessions.ts';
import { WrapUpSheet } from './WrapUpSheet.tsx';

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

function renderApp(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const STARTED = '2026-11-22T17:58:55.000Z'; // 65 s before 18:00 UTC

const running: FocusSession = {
  id: 7,
  name: 'Read Lamport',
  subject: { id: 1, name: 'Distributed systems' },
  tags: ['papers'],
  goalId: null,
  notes: '',
  status: 'running',
  startedAt: STARTED,
  endedAt: null,
  focusSeconds: 65,
  autoPausedAt: null,
  attachmentCount: 0,
  events: [{ type: 'start', at: STARTED }],
};

const clockText = () => screen.getByRole('timer').textContent;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('StartForm', () => {
  it('start needs a name', async () => {
    const fetchMock = stubHub({
      'GET /api/sessions/current': () => json(null),
      'GET /api/subjects': () => json([]),
      'GET /api/goals?status=open': () => json({ error: 'Not found' }, 404),
      'GET /api/sessions?limit=7': () => json([]),
      'GET /api/stats/subjects?range=day': () => json([]),
    });
    renderApp(<FocusPanel />);

    const start = await screen.findByRole('button', { name: 'Start' });
    expect((start as HTMLButtonElement).disabled).toBe(true);

    const name = screen.getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Read Lamport' } });
    expect((start as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(name, { target: { value: '   ' } });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined || init.method === 'GET')).toBe(true);
  });
});

/** The panel's own wiring: the real `useCurrentSession` feeding the real pill. */
function LiveTimer() {
  const { session, elapsed } = useCurrentSession();
  if (session === null) return null;
  return <TimerPill session={session} elapsed={elapsed} onPause={() => {}} onResume={() => {}} onStop={() => {}} />;
}

/** Runs React Query's timers on vitest's fake clock. */
function fakeClock() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T18:00:00.000Z'));
}

/** Lets the fake clock run the fetch the hub answers at once, and the render with it. */
async function settle() {
  for (let i = 0; i < 5 && screen.queryByRole('timer') === null; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
  }
}

describe('TimerPill', () => {
  it('timer pill counts', async () => {
    fakeClock();
    const reply: FocusSession = running;
    const fetchMock = stubHub({ 'GET /api/sessions/current': () => json(reply) });
    renderApp(<LiveTimer />);
    await settle();
    expect(clockText()).toBe('00:01:05');

    // One local second: the ticker, not the hub, moves the clock.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(clockText()).toBe('00:01:06');
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/sessions/current').length).toBe(1);
  });

  it('a reply within a second of the count leaves the clock where it is', async () => {
    fakeClock();
    let reply: FocusSession = { ...running, focusSeconds: 70 };
    stubHub({ 'GET /api/sessions/current': () => json(reply) });
    renderApp(<LiveTimer />);
    await settle();
    expect(clockText()).toBe('00:01:10');

    // The 5 s poll says 74: the hub rounded and the reply took a moment. That is the same clock,
    // so it neither steps back to 74 nor restarts its second.
    reply = { ...running, focusSeconds: 74 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5500);
    });
    expect(clockText()).toBe('00:01:15');
  });

  it('a reply behind the count is taken: the time the Mac slept comes off', async () => {
    fakeClock();
    // Just after a wake the hub still counts the sleep, until its heartbeat pauses the session.
    let reply: FocusSession = { ...running, focusSeconds: 3000 };
    stubHub({ 'GET /api/sessions/current': () => json(reply) });
    renderApp(<LiveTimer />);
    await settle();
    expect(clockText()).toBe('00:50:00');

    // Polls land at 5 s, 10 s, …; each look comes half a second after one.
    reply = { ...running, status: 'paused', autoPausedAt: '2026-11-22T17:40:00.000Z', focusSeconds: 2000 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5500);
    });
    expect(clockText()).toBe('00:33:20');

    // Resumed: the clock runs on from the hub's figure, not from the one it showed before.
    reply = { ...running, focusSeconds: 2000 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(clockText()).toBe('00:33:20');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(clockText()).toBe('00:33:21');
  });

  it('a new session starts from zero after a longer one', async () => {
    fakeClock();
    let reply: FocusSession | null = { ...running, focusSeconds: 3021 };
    stubHub({ 'GET /api/sessions/current': () => json(reply) });
    renderApp(<LiveTimer />);
    await settle();
    expect(clockText()).toBe('00:50:21');

    reply = null;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5500);
    });
    expect(screen.queryByRole('timer')).toBeNull();

    reply = { ...running, id: 8, focusSeconds: 0, events: [{ type: 'start', at: '2026-11-22T18:00:10.000Z' }] };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(clockText()).toBe('00:00:00');
  });

  it('two clocks mounted apart always agree', async () => {
    fakeClock();
    let reply: FocusSession = { ...running, focusSeconds: 3000 };
    stubHub({ 'GET /api/sessions/current': () => json(reply) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (both: boolean) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <LiveTimer />
          {both && <LiveTimer />}
        </MemoryRouter>
      </QueryClientProvider>
    );
    // The rail's clock is up from the start; it sees the overcount, the pause and the resume.
    const { rerender } = render(tree(false));
    await settle();
    reply = { ...running, status: 'paused', autoPausedAt: '2026-11-22T17:40:00.000Z', focusSeconds: 2000 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5500);
    });
    reply = { ...running, focusSeconds: 2000 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7300);
    });

    // The Focus panel's clock arrives later, mid-second.
    rerender(tree(true));
    const clocks = () => screen.getAllByRole('timer').map((t) => t.textContent);
    expect(clocks()).toEqual(['00:33:22', '00:33:22']);
    for (const step of [130, 870, 1700, 3300, 5000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(step);
      });
      const [rail, panel] = clocks();
      expect(panel).toBe(rail);
    }
  });

  it('a reply ahead of the local count is taken, not capped below it', async () => {
    fakeClock();
    const fetchMock = stubHub({ 'GET /api/sessions/current': () => json(running) });
    renderApp(<LiveTimer />);
    await settle();
    // The heartbeat paused nothing and the Mac stayed awake: the hub runs ahead.
    fetchMock.mockImplementation(async () => json({ ...running, focusSeconds: 80 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(clockText()).toBe('00:01:20');
  });

  it('a paused session holds its figure', async () => {
    fakeClock();
    const paused: FocusSession = { ...running, status: 'paused', focusSeconds: 65 };
    stubHub({ 'GET /api/sessions/current': () => json(paused) });
    renderApp(<LiveTimer />);
    await settle();
    expect(clockText()).toBe('00:01:05');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(clockText()).toBe('00:01:05');
  });
});

describe('anchorReply', () => {
  const at = Date.parse('2026-11-22T18:00:00.000Z');

  it('keeps the start while the hub agrees within the slack, and takes it otherwise', () => {
    const first = anchorReply({ ...running, focusSeconds: 70 }, at, undefined);
    expect(first.since).toBe(at - 70_000);
    // 5 s on the hub says 74 (rounded, late): the same clock.
    expect(anchorReply({ ...running, focusSeconds: 74 }, at + 5000, first).since).toBe(first.since);
    // 5 s on the hub says 72: three seconds came off, so its figure is the clock.
    expect(anchorReply({ ...running, focusSeconds: 72 }, at + 5000, first).since).toBe(at + 5000 - 72_000);
  });

  it('a different session or a resume starts its own clock', () => {
    const first = anchorReply({ ...running, focusSeconds: 70 }, at, undefined);
    const other = anchorReply({ ...running, id: 8, focusSeconds: 71 }, at + 1000, first);
    expect(other.since).toBe(at + 1000 - 71_000);
    const paused = anchorReply({ ...running, status: 'paused', focusSeconds: 70 }, at, undefined);
    expect(anchorReply({ ...running, focusSeconds: 70 }, at + 500, paused).since).toBe(at + 500 - 70_000);
  });

  it('counts on while running, and holds the hub figure while paused', () => {
    const live = anchorReply({ ...running, focusSeconds: 70 }, at, undefined);
    expect(focusElapsed(live, at + 2999)).toBe(72);
    // A tick read just before the reply landed never counts below the reply.
    expect(focusElapsed(live, at - 200)).toBe(70);
    const paused = anchorReply({ ...running, status: 'paused', focusSeconds: 70 }, at, undefined);
    expect(focusElapsed(paused, at + 60_000)).toBe(70);
    expect(focusElapsed(undefined, at)).toBe(0);
  });
});

describe('WrapUpSheet', () => {
  it('long session warning', async () => {
    stubHub({
      'GET /api/attachments?sessionId=9': () => json([]),
    });
    const long: FocusSession = {
      ...running,
      id: 9,
      status: 'done',
      endedAt: '2026-11-23T00:00:01.000Z',
      focusSeconds: 21601,
      startedAt: '2026-11-22T18:00:00.000Z',
      events: [
        { type: 'start', at: '2026-11-22T18:00:00.000Z' },
        { type: 'stop', at: '2026-11-23T00:00:01.000Z' },
      ],
    };
    renderApp(<WrapUpSheet session={long} open onClose={() => {}} />);

    expect(await screen.findByText('Long session — check the end time')).toBeTruthy();
    // At six hours exactly, nothing is flagged.
    expect(screen.getByText('6 h 0 m')).toBeTruthy();
  });

  it('a session under six hours carries no warning', async () => {
    stubHub({ 'GET /api/attachments?sessionId=9': () => json([]) });
    const short: FocusSession = {
      ...running,
      id: 9,
      status: 'done',
      endedAt: '2026-11-22T18:00:00.000Z',
      focusSeconds: 21600,
      startedAt: '2026-11-22T12:00:00.000Z',
    };
    renderApp(<WrapUpSheet session={short} open onClose={() => {}} />);
    await screen.findByLabelText('Notes');
    expect(screen.getByText('6 h 0 m')).toBeTruthy();
    expect(screen.queryByText('Long session — check the end time')).toBeNull();
  });

  it('edits the times, the notes and the name, each by PATCH', async () => {
    const user = userEvent.setup();
    const done: FocusSession = {
      ...running,
      id: 9,
      status: 'done',
      endedAt: '2026-11-22T17:05:00.000Z',
      startedAt: '2026-11-22T16:00:00.000Z',
      focusSeconds: 3900,
    };
    const patches: { path: string; body: unknown }[] = [];
    stubHub({
      'GET /api/attachments?sessionId=9': () => json([]),
      'PATCH /api/sessions/9': (init) => {
        patches.push({ path: '/api/sessions/9', body: JSON.parse(String(init?.body)) });
        return json(done);
      },
    });
    renderApp(<WrapUpSheet session={done} open onClose={() => {}} />);

    const name = await screen.findByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Read Lamport, ch. 2' } });
    await user.tab();
    await waitFor(() => expect(patches.map((p) => p.body)).toContainEqual({ name: 'Read Lamport, ch. 2' }));

    const notes = screen.getByLabelText('Notes');
    fireEvent.change(notes, { target: { value: 'Clock sync' } });
    fireEvent.blur(notes);
    await waitFor(() => expect(patches.map((p) => p.body)).toContainEqual({ notes: 'Clock sync' }));

    const end = screen.getByLabelText('End');
    fireEvent.change(end, { target: { value: '11:10' } });
    fireEvent.blur(end);
    await waitFor(() => expect(patches.some((p) => (p.body as { endedAt?: string }).endedAt?.endsWith('Z'))).toBe(true));
    const last = patches.at(-1)!.body as { endedAt: string };
    // The end time is read in the browser's zone and sent as an instant.
    expect(new Date(last.endedAt).getHours()).toBe(11);
    expect(new Date(last.endedAt).getMinutes()).toBe(10);
  });

  it('auto-paused notice', async () => {
    stubHub({ 'GET /api/attachments?sessionId=7': () => json([]) });
    const slept: FocusSession = {
      ...running,
      status: 'paused',
      autoPausedAt: '2026-11-22T18:00:00.000Z',
      events: [
        { type: 'start', at: STARTED },
        { type: 'pause', at: '2026-11-22T18:00:00.000Z' },
      ],
    };
    renderApp(<TimerPill session={slept} elapsed={65} onPause={() => {}} onResume={() => {}} onStop={() => {}} />);

    expect(screen.getByText('Paused while your Mac slept')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });
});

describe('WrapUpSheet readings', () => {
  it('shows a rendered reading with Edit and Retry', async () => {
    const user = userEvent.setup();
    // `previewUrl` only appears once a preview exists; the shared type keeps it out of plain photos.
    const photo = {
      id: 4,
      sessionId: 9,
      parentId: null,
      kind: 'image',
      filename: 'hw.jpg',
      mime: 'image/jpeg',
      size: 2048,
      createdAt: '2026-11-22T18:00:00.000Z',
      source: 'upload',
      extractedText: 'Handwritten work',
      visionStatus: 'done',
      repoPath: null,
      repoState: null,
      url: '/api/attachments/4/file',
    } as Attachment;
    const tex: Attachment = {
      ...photo,
      id: 5,
      parentId: 4,
      kind: 'latex',
      filename: 'hw.tex',
      mime: 'text/x-tex',
      extractedText: 'x^2 = 4',
      visionStatus: null,
      url: '/api/attachments/5/file',
    };
    let attachments = [photo, tex];
    const calls: string[] = [];
    const fetchMock = stubHub({
      'GET /api/attachments?sessionId=9': () => json(attachments),
      'PATCH /api/attachments/4': () => {
        calls.push('patch');
        attachments = [photo, { ...tex, extractedText: 'x^2 = 9' }];
        return json(attachments[0]);
      },
      'POST /api/attachments/4/vision': () => {
        calls.push('retry');
        return new Response(null, { status: 202 });
      },
    });
    const done: FocusSession = {
      ...running,
      id: 9,
      status: 'done',
      endedAt: '2026-11-22T18:05:00.000Z',
      focusSeconds: 300,
    };
    renderApp(<WrapUpSheet session={done} open onClose={() => {}} />);

    expect(await screen.findByText('Handwritten work')).toBeTruthy();
    // The reading is drawn from its `.tex`, and the `.tex` itself is not listed again.
    expect(screen.getAllByText('hw.jpg').length).toBe(1);
    expect(screen.queryByText('hw.tex')).toBeNull();
    expect(screen.getByText('1 file')).toBeTruthy();
    // The reading is typeset, its LaTeX kept out of sight.
    await waitFor(() => expect(document.querySelector('.latex__body .katex')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    // The editor opens on the current source.
    expect((screen.getByLabelText('LaTeX source') as HTMLTextAreaElement).value).toBe('x^2 = 4');
    fireEvent.change(screen.getByLabelText('LaTeX source'), { target: { value: 'x^2 = 9' } });
    await screen.findByLabelText('LaTeX source');
    await user.click(screen.getByRole('button', { name: 'Save the reading' }));
    await waitFor(() => expect(calls).toContain('patch'));

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls).toContain('retry'));
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/attachments/4/vision')).toBe(true);
  });

  it('offers Retry when a reading failed', async () => {
    const failed = {
      id: 6,
      sessionId: 9,
      parentId: null,
      kind: 'image',
      filename: 'blurry.jpg',
      mime: 'image/jpeg',
      size: 1024,
      createdAt: '2026-11-22T18:00:00.000Z',
      source: 'upload',
      extractedText: '',
      visionStatus: 'failed',
      repoPath: null,
      repoState: null,
      url: '/api/attachments/6/file',
    } as Attachment;
    stubHub({ 'GET /api/attachments?sessionId=9': () => json([failed]) });
    const done: FocusSession = { ...running, id: 9, status: 'done', focusSeconds: 300 };
    renderApp(<WrapUpSheet session={done} open onClose={() => {}} />);

    expect(await screen.findByText('Couldn’t read this photo — retry')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBe(1);
  });
});

describe('FocusPanel history', () => {
  const subjects: Subject[] = [
    { id: 1, name: 'Distributed systems' },
    { id: 2, name: 'Statistics' },
  ];

  const finished: FocusSession = {
    ...running,
    id: 8,
    name: 'Problem set 4',
    subject: { id: 2, name: 'Statistics' },
    tags: ['stats'],
    status: 'done',
    startedAt: '2026-11-21T16:00:00.000Z',
    endedAt: '2026-11-21T17:25:00.000Z',
    focusSeconds: 5100,
  };

  it('lists sessions by day with totals and reopens the wrap-up on a click', async () => {
    const user = userEvent.setup();
    stubHub({
      'GET /api/sessions/current': () => json(null),
      'GET /api/subjects': () => json(subjects),
      'GET /api/goals?status=open': () => json({ error: 'Not found' }, 404),
      'GET /api/sessions?limit=7': () => json([finished]),
      'GET /api/stats/subjects?range=day': () =>
        json([{ subjectId: 2, name: 'Statistics', seconds: 60 }]),
      'GET /api/attachments?sessionId=8': () => json([]),
    });
    renderApp(<FocusPanel />);

    expect(await screen.findByText('Problem set 4')).toBeTruthy();
    expect(screen.getByText('stats')).toBeTruthy();
    // The row's time and, above it, the day's total.
    expect(screen.getAllByText('1 h 25 m').length).toBe(2);
    // The pie beside the history, by subject, with the four ranges.
    expect(screen.getByRole('img', { name: 'Focus by subject, this day' })).toBeTruthy();
    for (const tab of ['Day', 'Week', 'Month', 'Year']) expect(screen.getByRole('tab', { name: tab })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Problem set 4/ }));
    expect(await screen.findByRole('dialog', { name: 'Wrap up' })).toBeTruthy();
    expect(screen.getByText('Take photo')).toBeTruthy();
    expect(screen.getByText('Upload files')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('starts a session and shows the timer pill', async () => {
    const user = userEvent.setup();
    let current: FocusSession | null = null;
    stubHub({
      'GET /api/sessions/current': () => json(current),
      'GET /api/subjects': () => json(subjects),
      'GET /api/goals?status=open': () => json({ error: 'Not found' }, 404),
      'GET /api/sessions?limit=7': () => json([]),
      'GET /api/stats/subjects?range=day': () => json([]),
      'POST /api/sessions': (init) => {
        current = { ...running, ...(JSON.parse(String(init?.body)) as object), focusSeconds: 0 };
        return json(current, 201);
      },
    });
    renderApp(<FocusPanel />);

    const start = await screen.findByRole('button', { name: 'Start' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Read Lamport' } });
    await user.click(start);

    // The pill shows what the session is about: its subject, else its name.
    const pill = await screen.findByRole('group', { name: 'Focus: Distributed systems' });
    expect(pill.textContent).toContain('Distributed systems');
    expect(within(pill).getByRole('timer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });
});

describe('FocusPanel goals', () => {
  it('hides the goal select when goals answer 404', async () => {
    stubHub({
      'GET /api/sessions/current': () => json(null),
      'GET /api/subjects': () => json([]),
      'GET /api/goals?status=open': () => json({ error: 'Not found' }, 404),
      'GET /api/sessions?limit=7': () => json([]),
      'GET /api/stats/subjects?range=day': () => json([]),
    });
    renderApp(<FocusPanel />);

    await screen.findByRole('button', { name: 'Start' });
    await waitFor(() => expect(screen.queryByLabelText('Goal')).toBeNull());
  });

  it('shows the goal failure with Retry when the hub answers 500', async () => {
    const user = userEvent.setup();
    let answer = 500;
    const fetchMock = stubHub({
      'GET /api/sessions/current': () => json(null),
      'GET /api/subjects': () => json([]),
      'GET /api/goals?status=open': () =>
        answer === 500 ? json({ error: 'The hub fell over' }, 500) : json([]),
      'GET /api/sessions?limit=7': () => json([]),
      'GET /api/stats/subjects?range=day': () => json([]),
    });
    renderApp(<FocusPanel />);

    // Never silently hidden: the line says what failed, and offers the one step.
    expect(await screen.findByText('Couldn’t load goals —', { exact: false })).toBeTruthy();
    expect(screen.queryByLabelText('Goal')).toBeNull();

    answer = 200;
    const callsBefore = fetchMock.mock.calls.filter(([path]) => path === '/api/goals?status=open').length;
    await user.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([path]) => path === '/api/goals?status=open').length).toBe(callsBefore + 1),
    );
    await waitFor(() => expect(screen.queryByText('Couldn’t load goals —', { exact: false })).toBeNull());
  });

  it('lists open goals in the select and sends the chosen one', async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    stubHub({
      'GET /api/sessions/current': () => json(null),
      'GET /api/subjects': () => json([]),
      'GET /api/goals?status=open': () =>
        json([
          {
            id: 3,
            title: 'Finish ch. 4',
            createdAt: '2026-11-01T12:00:00.000Z',
            deadline: null,
            plannedMinutes: null,
            originalDeadline: null,
            originalPlannedMinutes: null,
            status: 'open',
            doneAt: null,
            focusedSeconds: 0,
            progress: { mode: 'none', fraction: null, fractionKind: null, projectedFinish: null, noRecentPace: false, atRisk: false },
          },
        ]),
      'GET /api/sessions?limit=7': () => json([]),
      'GET /api/stats/subjects?range=day': () => json([]),
      'POST /api/sessions': (init) => {
        posted.push(JSON.parse(String(init?.body)));
        return json({ ...running, focusSeconds: 0 }, 201);
      },
    });
    renderApp(<FocusPanel />);

    const goal = await screen.findByLabelText('Goal');
    await waitFor(() => expect(within(goal).queryByRole('option', { name: 'Finish ch. 4' })).toBeTruthy());
    await user.selectOptions(goal, '3');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Read Lamport' } });
    await user.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(posted).toEqual([{ name: 'Read Lamport', goalId: 3 }]));
  });
});

describe('StartForm chips', () => {
  it('turns commas and Enter into tags, and a typed subject is sent as its name', async () => {
    const user = userEvent.setup();
    const posted: Record<string, unknown>[] = [];
    stubHub({
      'GET /api/sessions/current': () => json(null),
      'GET /api/subjects': () => json([{ id: 1, name: 'Distributed systems' }]),
      'GET /api/goals?status=open': () => json({ error: 'Not found' }, 404),
      'GET /api/sessions?limit=7': () => json([]),
      'GET /api/stats/subjects?range=day': () => json([]),
      'POST /api/sessions': (init) => {
        posted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return json({ ...running, focusSeconds: 0 }, 201);
      },
    });
    renderApp(<FocusPanel />);

    await screen.findByRole('button', { name: 'Start' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Read Lamport' } });

    const subject = screen.getByLabelText('Subject');
    fireEvent.change(subject, { target: { value: 'Compilers' } });

    const tags = screen.getByLabelText('Tags');
    fireEvent.change(tags, { target: { value: 'papers, reading' } });
    fireEvent.keyDown(tags, { key: 'Enter' });
    fireEvent.change(tags, { target: { value: 'notes' } });
    fireEvent.keyDown(tags, { key: 'Enter' });

    expect(screen.getByText('papers')).toBeTruthy();
    expect(screen.getByText('reading')).toBeTruthy();
    expect(screen.getByText('notes')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() =>
      expect(posted).toEqual([{ name: 'Read Lamport', subjectName: 'Compilers', tags: ['papers', 'reading', 'notes'] }]),
    );
  });
});
