import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Essay } from '@shared/types.ts';
import { EssayEditor } from './EssayEditor.tsx';

const essay: Essay = {
  id: 4,
  column: 'insights',
  title: 'On attention',
  firstLine: '',
  wordCount: 0,
  createdAt: '2026-11-22T18:00:00.000Z',
  updatedAt: '2026-11-22T18:00:00.000Z',
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Attention is a practice.' }] }] },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubHub(put: (body: unknown) => Response = () => json({ updatedAt: '2026-11-22T18:00:01.000Z' })) {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/essays/4' && (init?.method ?? 'GET') === 'GET') return json(essay);
    if (path === '/api/essays/4' && init?.method === 'PUT') return put(JSON.parse(String(init.body)));
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/essays/4']}>
        <Routes>
          <Route path="/essays/:id" element={<EssayEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EssayEditor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('opens the essay with its title and a Word-like toolbar', async () => {
    stubHub();
    renderEditor();
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveProperty('value', 'On attention'));
    for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Subscript', 'Superscript', 'Align centre', 'Bulleted list', 'Checklist', 'Find and replace', 'Export .docx', 'Export PDF', 'Print']) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
    // A menu's trigger carries its label too; in a fieldset, its heading counts.
    expect(screen.getAllByLabelText('Table').length).toBe(1);
    expect(screen.getAllByLabelText('History').length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('Attention is a practice.');
  });

  it('saves 800 ms after a title change, and the status line says when', async () => {
    const fetchMock = stubHub();
    renderEditor();
    const title = await screen.findByLabelText('Title');
    const user = userEvent.setup();
    await user.type(title, '!');
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false);
    await waitFor(
      () => expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(true),
      { timeout: 3000 },
    );
    await waitFor(() => expect(screen.getByText(/^Saved \d\d:\d\d$/)).toBeTruthy());
  });

  it('offers the unsaved backup when one is newer than the essay', async () => {
    localStorage.setItem(
      'hub:essay:4:unsaved',
      JSON.stringify({
        payload: { title: 'Recovered', contentJson: { type: 'doc', content: [] }, plainText: '', baseUpdatedAt: essay.updatedAt },
        at: '2026-11-22T19:30:00.000Z',
      }),
    );
    stubHub();
    renderEditor();
    expect(await screen.findByText(/Restore unsaved changes from/)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Restore' }));
    expect(screen.getByLabelText('Title')).toHaveProperty('value', 'Recovered');
    expect(localStorage.getItem('hub:essay:4:unsaved')).toBeNull();
  });

  it('says the change was kept elsewhere on a 409', async () => {
    stubHub(() => json({ error: 'Changed elsewhere', current: { id: 4, title: 'Theirs', updatedAt: '2026-11-22T18:05:00.000Z' } }, 409));
    renderEditor();
    const title = await screen.findByLabelText('Title');
    await userEvent.setup().type(title, '?');
    expect(await screen.findByText(/Changed elsewhere — reload \/ keep mine/, {}, { timeout: 3000 })).toBeTruthy();
  });
});
