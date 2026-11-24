import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Goal, GoalAccuracy } from '@shared/types.ts';
import { finishLine } from './GoalRow.tsx';
import { GoalsPanel } from './GoalsPanel.tsx';
import { PlanPrompt } from './PlanPrompt.tsx';

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

    // The "+" pours the type bar out; it starts closed.
    const plus = await screen.findByRole('button', { name: 'Add a goal' });
    expect(plus.getAttribute('aria-expanded')).toBe('false');
    await user.click(plus);
    const field = screen.getByRole('textbox', { name: 'New goal' });
    await waitFor(() => expect(document.activeElement).toBe(field));
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

    await user.click(await screen.findByRole('button', { name: 'Add a goal' }));
    await user.type(screen.getByRole('textbox', { name: 'New goal' }), 'Stretch{Enter}');
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
    // The due day leads, then the pace.
    expect(within(first).getByText('Due 28 Nov · No recent pace')).toBeTruthy();
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
    const hours = within(first).getByRole('spinbutton', { name: 'How long, in hours' });
    // The prompt is prefilled with the current 10 h; retyping it to 12 sends just the hours.
    expect((hours as HTMLInputElement).value).toBe('10');
    await user.clear(hours);
    await user.type(hours, '12');
    fireEvent.submit(within(first).getByRole('form', { name: 'Plan this goal' }));
    await waitFor(() => expect(lastPatch(fetchMock)).toEqual({ plannedMinutes: 720 }));

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

  it('ranks goals from the grip with the arrow keys, and saves the order', async () => {
    const goals = [goal({ id: 1, title: 'Mechanics' }), goal({ id: 2, title: 'Calculus' }), goal({ id: 3, title: 'CollegeDeck' })];
    const orders: number[][] = [];
    stubHub({
      'GET /api/goals?status=open': () => json(goals),
      'GET /api/goals?status=done': () => json([]),
      'GET /api/goals/accuracy': () => json(NO_ACCURACY),
      'PUT /api/goals/order': (init) => {
        const { ids } = JSON.parse(String(init?.body)) as { ids: number[] };
        orders.push(ids);
        return json(ids.map((id) => goals.find((g) => g.id === id)));
      },
    });
    renderPanel();
    const titles = () =>
      within(screen.getByRole('list', { name: 'Open goals' }))
        .getAllByRole('listitem')
        .map((li) => li.querySelector('.goal__title')?.textContent);

    const grip = await screen.findByRole('button', { name: 'Move CollegeDeck' });
    grip.focus();
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    await waitFor(() => expect(orders.at(-1)).toEqual([1, 3, 2]));
    expect(titles()).toEqual(['Mechanics', 'CollegeDeck', 'Calculus']);
    expect(screen.getByRole('status').textContent).toBe('CollegeDeck moved to 2 of 3');
    // The grip keeps focus as its row moves, so the keys can go on.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move CollegeDeck' }));

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    await waitFor(() => expect(orders.at(-1)).toEqual([3, 1, 2]));
    // Already first: nothing to move, nothing sent.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(orders).toHaveLength(2);
    expect(titles()).toEqual(['CollegeDeck', 'Mechanics', 'Calculus']);
  });
});

describe('PlanPrompt', () => {
  it('takes a date or hours, saves both when given, and warns about a past day', async () => {
    const user = userEvent.setup();
    stubHub({});
    const onSave = vi.fn();
    render(
      <>
        <PlanPrompt autoFocus onSave={onSave} onSkip={() => {}} />
      </>,
    );
    const date = screen.getByLabelText('By when, a date');
    // A day already gone is allowed but flagged.
    await user.type(date, '2000-01-01');
    expect(screen.getByText('That day has passed.')).toBeTruthy();
    const hoursField = screen.getByRole('spinbutton', { name: 'How long, in hours' });
    await user.type(hoursField, '1.5');
    // The Save pill submits the prompt.
    // jsdom does not run a submit button's default action, so submit the form directly.
    fireEvent.submit(screen.getByRole('form', { name: 'Plan this goal' }));
    expect(onSave).toHaveBeenCalledWith({ deadline: '2000-01-01', plannedMinutes: 90 });
  });
});

describe('the + adder', () => {
  it('opens and closes from the +, and Esc closes it back to the +', async () => {
    const user = userEvent.setup();
    stubHub({
      'GET /api/goals?status=open': () => json([]),
      'GET /api/goals/accuracy': () => json(NO_ACCURACY),
      'GET /api/goals?status=done': () => json([]),
    });
    renderPanel();
    const plus = await screen.findByRole('button', { name: 'Add a goal' });
    await user.click(plus);
    expect(screen.getByRole('button', { name: 'Close the new goal' }).getAttribute('aria-expanded')).toBe('true');
    await user.type(screen.getByRole('textbox', { name: 'New goal' }), 'Draft');
    await user.keyboard('{Escape}');
    const closed = screen.getByRole('button', { name: 'Add a goal' });
    expect(closed.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(closed);
    // Reopened, the draft is gone.
    await user.click(closed);
    expect((screen.getByRole('textbox', { name: 'New goal' }) as HTMLInputElement).value).toBe('');
  });
});

describe('a goal\'s finish line', () => {
  it('leads with the due day, then the pace, and gives the year of a day in another one', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-23T12:00:00'));
    const both = goal({
      deadline: '2026-12-12',
      plannedMinutes: 3000,
      progress: { mode: 'both', fraction: 0.02, fractionKind: 'work', projectedFinish: '2028-12-17', noRecentPace: false, atRisk: true },
    });
    expect(finishLine(both)).toEqual({ text: 'Due 12 Dec · Projected 17 Dec 2028', tone: 'risk' });
    vi.useRealTimers();
  });
});
