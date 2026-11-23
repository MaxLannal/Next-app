import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Goal, GoalAccuracy } from '@shared/types.ts';
import { GoalsPanel } from './GoalsPanel.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: 1,
    title: 'Finish Ch. 4',
    createdAt: '2026-11-01T12:00:00.000Z',
    deadline: null,
    plannedMinutes: 600,
    originalDeadline: null,
    originalPlannedMinutes: 600,
    status: 'open',
    doneAt: null,
    focusedSeconds: 6 * 3600,
    progress: {
      mode: 'hours',
      fraction: 0.6,
      fractionKind: 'work',
      projectedFinish: '2026-11-26',
      noRecentPace: false,
      atRisk: false,
    },
    ...over,
  };
}

const NO_ACCURACY: GoalAccuracy = { hours: null, dates: null, count: 0 };

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
      <GoalsPanel />
    </QueryClientProvider>,
  );
}

const row = (title: string) => screen.getByRole('listitem', { name: title });
const bodyOf = (mock: ReturnType<typeof stubHub>, method: string) =>
  JSON.parse(String(mock.mock.calls.find(([, init]) => init?.method === method)?.[1]?.body ?? 'null'));
/** The body of the newest request with that method. */
const lastBody = (mock: ReturnType<typeof stubHub>, method: string) =>
  JSON.parse(String(mock.mock.calls.filter(([, init]) => init?.method === method).at(-1)?.[1]?.body ?? 'null'));
const lastPatch = (mock: ReturnType<typeof stubHub>) => lastBody(mock, 'PATCH');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GoalsPanel', () => {
  it('shows hours focused over planned, the projection and a work bar', async () => {
    stubHub({
      'GET /api/goals?status=open': () => json([goal()]),
      'GET /api/goals/accuracy': () => json(NO_ACCURACY),
      'GET /api/goals?status=done': () => json([]),
    });
    renderPanel();

    const first = await screen.findByRole('listitem', { name: 'Finish Ch. 4' });
    expect(within(first).getByText('6 h / 10 h')).toBeTruthy();
    expect(within(first).getByText('Projected 26 Nov')).toBeTruthy();
    const bar = within(first).getByRole('progressbar', { name: /work/i });
    expect(bar.getAttribute('aria-valuenow')).toBe('0.6');
    expect(first.className).not.toContain('is-risk');
  });

  it('creates a goal on Enter, then asks by when or how long', async () => {
    const user = userEvent.setup();
    const fetchMock = stubHub({
      'GET /api/goals?status=open': () => json([]),
      'GET /api/goals/accuracy': () => json(NO_ACCURACY),
      'GET /api/goals?status=done': () => json([]),
      'POST /api/goals': () => json(goal({ id: 7, title: 'Read Ch. 5', plannedMinutes: null, progress: { mode: 'none', fraction: null, fractionKind: null, projectedFinish: null, noRecentPace: false, atRisk: false } }), 201),
      'PATCH /api/goals/7': () => json(goal({ id: 7, title: 'Read Ch. 5', plannedMinutes: 180 })),
    });
    renderPanel();

    const field = await screen.findByRole('textbox', { name: 'New goal' });
    await user.type(field, 'Read Ch. 5{Enter}');
    await waitFor(() => expect(bodyOf(fetchMock, 'POST')).toEqual({ title: 'Read Ch. 5' }));

    // The plan prompt appears for the new goal and saves hours on Enter.
    const hours = await screen.findByRole('spinbutton', { name: 'How long, in hours' });
    await user.type(hours, '3{Enter}');
    await waitFor(() => expect(bodyOf(fetchMock, 'PATCH')).toEqual({ plannedMinutes: 180 }));
  });

  it('Esc skips the plan prompt without saving', async () => {
    const user = userEvent.setup();
    const fetchMock = stubHub({
      'GET /api/goals?status=open': () => json([]),
      'GET /api/goals/accuracy': () => json(NO_ACCURACY),
      'GET /api/goals?status=done': () => json([]),
      'POST /api/goals': () => json(goal({ id: 8, title: 'Stretch', plannedMinutes: null }), 201),
    });
    renderPanel();

    await user.type(await screen.findByRole('textbox', { name: 'New goal' }), 'Stretch{Enter}');
    const prompt = await screen.findByText('By when?');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(prompt.isConnected).toBe(false));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('a deadline-only row labels its bar as time', async () => {
    stubHub({
      'GET /api/goals?status=open': () =>
        json([
          goal({
            title: 'Ship essay',
            plannedMinutes: null,
            deadline: '2026-12-02',
            progress: {
              mode: 'deadline',
              fraction: 0.5,
              fractionKind: 'time',
              projectedFinish: null,
              noRecentPace: false,
              atRisk: false,
            },
          }),
        ]),
      'GET /api/goals/accuracy': () => json(NO_ACCURACY),
      'GET /api/goals?status=done': () => json([]),
    });
    renderPanel();

    const first = await screen.findByRole('listitem', { name: 'Ship essay' });
    expect(within(first).getByText('6 h focused')).toBeTruthy();
    expect(within(first).getByText('Due 2 Dec')).toBeTruthy();
    expect(within(first).getByRole('progressbar', { name: /time/i })).toBeTruthy();
  });

  it('no recent pace reads so, and an at-risk goal turns apricot', async () => {
    stubHub({
      'GET /api/goals?status=open': () =>
        json([
          goal({
            id: 2,
            title: 'Late goal',
            deadline: '2026-11-28',
            progress: {
              mode: 'both',
              fraction: 0.6,
              fractionKind: 'work',
              projectedFinish: null,
              noRecentPace: true,
              atRisk: true,
            },
          }),
        ]),
      'GET /api/goals/accuracy': () => json(NO_ACCURACY),
      'GET /api/goals?status=done': () => json([]),
    });
    renderPanel();

    const first = await screen.findByRole('listitem', { name: 'Late goal' });
    expect(within(first).getByText('No recent pace')).toBeTruthy();
    expect(first.className).toContain('is-risk');
  });

  it('Done finishes a goal', async () => {
    const user = userEvent.setup();
    const fetchMock = stubHub({
      'GET /api/goals?status=open': () => json([goal()]),
      'GET /api/goals/accuracy': () => json(NO_ACCURACY),
      'GET /api/goals?status=done': () => json([]),
      'PATCH /api/goals/1': () => json(goal({ status: 'done', doneAt: '2026-11-22T12:00:00.000Z' })),
    });
    renderPanel();

    await user.click(within(await screen.findByRole('listitem', { name: 'Finish Ch. 4' })).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(bodyOf(fetchMock, 'PATCH')).toEqual({ status: 'done' }));
  });

  it('⋯ renames, re-plans, archives, and deletes after a confirm', async () => {
    const user = userEvent.setup();
    const fetchMock = stubHub({
      'GET /api/goals?status=open': () => json([goal()]),
      'GET /api/goals/accuracy': () => json(NO_ACCURACY),
      'GET /api/goals?status=done': () => json([]),
      'PATCH /api/goals/1': () => json(goal()),
      'DELETE /api/goals/1': () => new Response(null, { status: 204 }),
    });
    renderPanel();
    const first = await screen.findByRole('listitem', { name: 'Finish Ch. 4' });
    const menu = within(first).getByRole('button', { name: 'More actions' });

    await user.click(menu);
    await user.click(within(first).getByRole('button', { name: 'Rename' }));
    const title = within(first).getByRole('textbox', { name: 'Goal title' });
    await user.clear(title);
    await user.type(title, 'Finish Ch. 6{Enter}');
    await waitFor(() => expect(bodyOf(fetchMock, 'PATCH')).toEqual({ title: 'Finish Ch. 6' }));

    await user.click(within(first).getByRole('button', { name: 'More actions' }));
    await user.click(within(first).getByRole('button', { name: 'Re-plan' }));
    await user.type(within(first).getByRole('spinbutton', { name: 'How long, in hours' }), '12{Enter}');
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH').length).toBe(2));

    await user.click(within(first).getByRole('button', { name: 'More actions' }));
    await user.click(within(first).getByRole('button', { name: 'Delete' }));
    expect(within(first).getByText('Delete?')).toBeTruthy();
    // Nothing goes until the confirm is answered.
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    await user.click(within(first).getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
  });

  it('archives a goal so it leaves the open list', async () => {
    const user = userEvent.setup();
    const fetchMock = stubHub({
      'GET /api/goals?status=open': () => json([goal()]),
      'GET /api/goals/accuracy': () => json(NO_ACCURACY),
      'GET /api/goals?status=done': () => json([]),
      'PATCH /api/goals/1': () => json(goal({ status: 'archived' })),
    });
    renderPanel();
    const first = await screen.findByRole('listitem', { name: 'Finish Ch. 4' });
    await user.click(within(first).getByRole('button', { name: 'More actions' }));
    await user.click(within(first).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(lastPatch(fetchMock)).toEqual({ status: 'archived' }));
  });

  it('folds the completed list with planned versus actual and the accuracy tally', async () => {
    const user = userEvent.setup();
    const done = goal({
      id: 3,
      title: 'Read Ch. 1',
      status: 'done',
      doneAt: '2026-11-10T12:00:00.000Z',
      deadline: '2026-11-10',
      originalDeadline: '2026-11-10',
      focusedSeconds: 12 * 3600,
      progress: { mode: 'hours', fraction: 1, fractionKind: 'work', projectedFinish: '2026-11-10', noRecentPace: false, atRisk: false },
    });
    stubHub({
      'GET /api/goals?status=open': () => json([]),
      'GET /api/goals/accuracy': () => json({ hours: 1.4, dates: 1.4, count: 3 }),
      'GET /api/goals?status=done': () => json([done]),
    });
    renderPanel();

    const toggle = await screen.findByRole('button', { name: /completed/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(screen.getByText('Hours ×1.4 · Dates ×1.4 · 3 goals')).toBeTruthy());
    expect(screen.getByText('12 h of 10 h')).toBeTruthy();
  });
});
