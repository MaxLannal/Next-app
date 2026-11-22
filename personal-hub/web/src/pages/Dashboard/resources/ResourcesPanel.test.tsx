import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Resource } from '@shared/types.ts';
import { ResourcesPanel } from './ResourcesPanel.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const resource = (over: Partial<Resource>): Resource => ({
  id: 1,
  url: 'https://example.com/ladr.pdf',
  title: 'Linear Algebra Done Right',
  kind: 'pdf',
  domain: 'example.com',
  thumbnail: null,
  note: '',
  done: false,
  createdAt: '2026-11-22T18:00:00.000Z',
  ...over,
});

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

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ResourcesPanel />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ResourcesPanel', () => {
  it('shows a pending row while the title is fetched', async () => {
    const user = userEvent.setup();
    let answer: (res: Response) => void = () => {};
    stubHub({
      'GET /api/resources': () => json([]),
      'POST /api/resources': () => new Promise((resolve) => (answer = resolve)),
    });
    renderPanel();

    expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
    await user.type(screen.getByPlaceholderText('Paste a link, press Enter'), 'https://example.com/ladr.pdf{Enter}');

    const pending = await screen.findByText('https://example.com/ladr.pdf');
    expect(pending.closest('li')?.textContent).toContain('Fetching the title');
    expect((screen.getByPlaceholderText('Paste a link, press Enter') as HTMLInputElement).value).toBe('');

    answer(json(resource({ id: 7 }), 201));
    const link = await screen.findByRole('link', { name: 'Linear Algebra Done Right' });
    expect(link.getAttribute('href')).toBe('https://example.com/ladr.pdf');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(screen.queryByText('Fetching the title…', { selector: 'li *' })).toBeNull();
  });

  it("shows the hub's answer when a paste isn't a link", async () => {
    const user = userEvent.setup();
    stubHub({
      'GET /api/resources': () => json([]),
      'POST /api/resources': () => json({ error: "That doesn't look like a link" }, 400),
    });
    renderPanel();

    await user.type(await screen.findByPlaceholderText('Paste a link, press Enter'), 'javascript:alert(1){Enter}');

    expect((await screen.findByRole('alert')).textContent).toBe("That doesn't look like a link");
    expect((screen.getByPlaceholderText('Paste a link, press Enter') as HTMLInputElement).value).toBe('javascript:alert(1)');
  });

  it('filters by kind', async () => {
    const user = userEvent.setup();
    stubHub({
      'GET /api/resources': () =>
        json([
          resource({ id: 2, kind: 'video', title: 'Essence of linear algebra', url: 'https://youtu.be/x', domain: 'youtu.be' }),
          resource({ id: 1 }),
        ]),
    });
    renderPanel();

    expect(await screen.findByRole('link', { name: 'Essence of linear algebra' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'PDF' }));
    expect(screen.queryByRole('link', { name: 'Essence of linear algebra' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Linear Algebra Done Right' })).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Course' }));
    expect(screen.getByText('No courses yet')).toBeTruthy();
  });

  it('marks done and edits the title, note and kind inline', async () => {
    const user = userEvent.setup();
    const fetchMock = stubHub({
      'GET /api/resources': () => json([resource({ id: 1 })]),
      'PATCH /api/resources/1': (init) => json(resource({ id: 1, ...(JSON.parse(String(init?.body)) as Partial<Resource>) })),
    });
    renderPanel();

    const done = await screen.findByRole('button', { name: 'Done' });
    expect(done.getAttribute('aria-pressed')).toBe('false');
    await user.click(done);
    expect(JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body))).toEqual({ done: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' }).getAttribute('aria-pressed')).toBe('true'));

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const title = screen.getByRole('textbox', { name: 'Title' });
    expect(document.activeElement).toBe(title);
    await user.clear(title);
    await user.type(title, 'Axler, 3rd edition');
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Chapter 3 first');
    await user.click(screen.getByRole('radio', { name: 'Course' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body))).toEqual({
      title: 'Axler, 3rd edition',
      note: 'Chapter 3 first',
      kind: 'course',
    });
    const row = (await screen.findByRole('link', { name: 'Axler, 3rd edition' })).closest('li');
    expect(row?.textContent).toContain('Chapter 3 first');
  });

  it('asks before deleting', async () => {
    const user = userEvent.setup();
    const fetchMock = stubHub({
      'GET /api/resources': () => json([resource({ id: 1 })]),
      'DELETE /api/resources/1': () => new Response(null, { status: 204 }),
    });
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const row = screen.getByRole('link', { name: 'Linear Algebra Done Right' }).closest('li') as HTMLElement;
    expect(row.textContent).toContain('Delete?');
    await user.click(within(row).getByRole('button', { name: 'Keep' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(row).getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
    expect(fetchMock.mock.lastCall?.[1]?.method).toBe('DELETE');
  });
});
