import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Filters } from './Filters.tsx';
import { EMPTY_FILTERS, type FilterState } from './params.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = () => Response;
type FiltersImpl = Parameters<typeof Filters>[0];

/** Answers `GET path` from `routes`; anything else fails the test loudly. */
function stubHub(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (path: string) => {
    const route = routes[path];
    if (!route) throw new Error(`Unexpected request: ${path}`);
    return route();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderFilters(routes: Record<string, Handler>) {
  const fetchMock = stubHub({ '/api/subjects': () => json([]), ...routes });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const changes: FilterState[] = [];
  const view = render(
    <QueryClientProvider client={client}>
      <Filters value={EMPTY_FILTERS} onChange={(next) => changes.push(next)} scope={[]} />
    </QueryClientProvider>,
  );
  return { ...view, fetchMock, changes };
}

const GOALS = [
  { id: 3, title: 'Finish Ch. 4' },
  { id: 7, title: 'Write the talk' },
];

describe('the goal filter', () => {
  it('offers the open goals by title and filters by the one chosen', async () => {
    const { changes } = renderFilters({ '/api/goals?status=open': () => json(GOALS) });
    const select = screen.getByLabelText<HTMLSelectElement>('Goal');

    await waitFor(() => expect(screen.getByRole('option', { name: 'Finish Ch. 4' })).toBeDefined());
    expect(screen.getByRole('option', { name: 'Write the talk' })).toBeDefined();
    expect(select.value).toBe('');
    expect(screen.getByRole('option', { name: 'Any goal' })).toBeDefined();

    await userEvent.selectOptions(select, '7');
    expect(changes.at(-1)?.goal).toBe(7);
  });

  it('stays quiet when goals are not here yet', async () => {
    const { fetchMock } = renderFilters({ '/api/goals?status=open': () => json({ error: 'Not found' }, 404) });

    await waitFor(() => expect(screen.getByText('The goals list isn’t available yet.')).toBeDefined());
    // A 404 won't change this session, so it is asked once.
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/goals?status=open')).toHaveLength(1);
    const select = screen.getByLabelText<HTMLSelectElement>('Goal');
    expect(select.value).toBe('');
    expect(screen.getByRole('option', { name: 'No goal' })).toBeDefined();
  });

  it('keeps a chosen goal the list no longer holds', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    stubHub({ '/api/goals?status=open': () => json(GOALS), '/api/subjects': () => json([]) });
    const value: FilterState = { ...EMPTY_FILTERS, goal: 99 };
    const props: FiltersImpl = { value, onChange: () => {}, scope: [] };
    render(
      <QueryClientProvider client={client}>
        <Filters {...props} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText<HTMLSelectElement>('Goal').value).toBe('99');
  });
});
