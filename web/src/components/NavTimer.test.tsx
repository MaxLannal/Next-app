import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FocusSession } from '@shared/types.ts';
import { NavTimer } from './NavTimer.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const STARTED = '2026-11-23T20:00:00.000Z';
const running: FocusSession = {
  id: 7,
  name: 'Read Lamport',
  subject: { id: 1, name: 'Distributed systems' },
  tags: [],
  goalId: null,
  notes: '',
  status: 'running',
  startedAt: STARTED,
  endedAt: null,
  focusSeconds: 600,
  autoPausedAt: null,
  attachmentCount: 0,
  events: [{ type: 'start', at: STARTED }],
};
const stopped: FocusSession = { ...running, status: 'done', endedAt: '2026-11-23T20:10:00.000Z' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the rail timer', () => {
  it('opens the wrap-up after Stop, though the session is over by then', async () => {
    let current: FocusSession | null = running;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        const key = `${init?.method ?? 'GET'} ${path}`;
        if (key === 'GET /api/sessions/current') return json(current);
        if (key === 'POST /api/sessions/7/stop') {
          current = null;
          return json(stopped);
        }
        // What the wrap-up sheet reads: subjects, goals, files. None needed here.
        if (key.startsWith('GET ')) return json([]);
        throw new Error(`Unexpected request: ${key}`);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <NavTimer />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByRole('dialog', { name: 'Wrap up' })).toBeTruthy();
  });
});
