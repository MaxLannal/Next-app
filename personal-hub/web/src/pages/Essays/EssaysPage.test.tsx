import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Essay, EssaySummary } from '@shared/types.ts';
import { EssaysPage } from './EssaysPage.tsx';
import { plainTextOf, wordCountOf } from './essayText.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const summary = (over: Partial<EssaySummary>): EssaySummary => ({
  id: 1,
  column: 'meditations',
  title: 'On attention',
  firstLine: 'Attention is a practice',
  wordCount: 4,
  createdAt: '2026-11-22T18:00:00.000Z',
  updatedAt: '2026-11-22T18:00:00.000Z',
  ...over,
});

type Handler = (init?: RequestInit) => Response;
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/essays']}>
        <Routes>
          <Route path="/essays" element={<EssaysPage />} />
          <Route path="/essays/:id" element={<p>Editor</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const columnOf = (label: string) => screen.getByRole('heading', { level: 3, name: new RegExp(`^${label}`) }).closest('section') as HTMLElement;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('plainTextOf', () => {
  it('reads one line per block and counts words', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Two' }, { type: 'hardBreak' }, { type: 'text', text: 'lines' }] },
        { type: 'paragraph', content: [] },
      ],
    };
    expect(plainTextOf(doc)).toBe('First\nTwo\nlines');
    expect(wordCountOf(plainTextOf(doc))).toBe(3);
    expect(plainTextOf({ type: 'doc', content: [] })).toBe('');
    expect(wordCountOf('   ')).toBe(0);
  });
});

describe('EssaysPage', () => {
  it('shows three columns with counts, cards and empty states', async () => {
    stubHub({
      'GET /api/essays': () =>
        json([
          summary({ id: 2, column: 'plans', title: '', firstLine: '', wordCount: 0 }),
          summary({ id: 1 }),
        ]),
    });
    renderPage();

    expect(await screen.findByRole('link', { name: 'On attention' })).toBeTruthy();
    const meditations = columnOf('Personal meditations');
    expect(meditations.textContent).toContain('On attention');
    expect(meditations.textContent).toContain('Attention is a practice');
    expect(meditations.textContent).toContain('4 words');
    const plans = columnOf('Plans');
    expect(within(plans).getByRole('link', { name: 'Untitled' })).toBeTruthy();
    expect(columnOf('Insights').textContent).toContain('Nothing here yet');
    expect(screen.getByRole('button', { name: 'New essay in Insights' })).toBeTruthy();
  });

  it('creates in a column and opens the essay', async () => {
    const user = userEvent.setup();
    const created: Essay = { ...summary({ id: 9, column: 'insights', title: '', firstLine: '', wordCount: 0 }), contentJson: { type: 'doc', content: [] } };
    const fetchMock = stubHub({
      'GET /api/essays': () => json([]),
      'POST /api/essays': () => json(created, 201),
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'New essay in Insights' }));
    expect(JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body))).toEqual({ column: 'insights' });
    expect(await screen.findByText('Editor')).toBeTruthy();
  });

  it('moves a card with its "Move to…" menu', async () => {
    const user = userEvent.setup();
    const fetchMock = stubHub({
      'GET /api/essays': () => json([summary({ id: 1 })]),
      'PUT /api/essays/1': () => json({ updatedAt: '2026-11-22T18:30:00.000Z' }),
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'More for On attention' }));
    const menu = screen.getByRole('menu', { name: 'Move to…' });
    // The column the card is in is left out.
    expect(within(menu).queryByRole('menuitem', { name: 'Personal meditations' })).toBeNull();
    await user.click(within(menu).getByRole('menuitem', { name: 'Insights' }));

    expect(JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body))).toEqual({
      column: 'insights',
      baseUpdatedAt: '2026-11-22T18:00:00.000Z',
    });
    await waitFor(() => expect(columnOf('Insights').textContent).toContain('On attention'));
    expect(columnOf('Personal meditations').textContent).not.toContain('On attention');
  });

  it('closes the menu on Escape and says when a move fails', async () => {
    const user = userEvent.setup();
    stubHub({
      'GET /api/essays': () => json([summary({ id: 1 })]),
      'PUT /api/essays/1': () => json({ error: 'Changed elsewhere' }, 409),
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'More for On attention' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'More for On attention' }));
    await user.click(screen.getByRole('menuitem', { name: 'Plans' }));
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't move it — try again.");
    await waitFor(() => expect(columnOf('Personal meditations').textContent).toContain('On attention'));
  });
});
