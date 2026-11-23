import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Skill } from '@shared/types.ts';
import { SkillTrackerPanel } from './SkillTrackerPanel.tsx';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const skill: Skill = { id: 4, name: 'Quantum Computing', createdAt: '', updatedAt: '', steps: 3, experiences: 5, stages: 3, layerSteps: [2, 1] };

function renderWith(skills: Skill[]) {
  vi.stubGlobal('fetch', vi.fn(async () => json(skills)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SkillTrackerPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('the dashboard skill tracker', () => {
  it('names the skill you are mastering and opens it', async () => {
    renderWith([skill]);
    expect(await screen.findByText('“Quantum Computing”')).toBeTruthy();
    expect(screen.getByText('You are on your way to mastering')).toBeTruthy();
    expect(screen.getByText(/Stage 2 of 3 · 3 steps · 5 experiences/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Enter skill tracker' }).getAttribute('href')).toBe('/skills?skill=4');
  });

  it('invites a first skill when there is none', async () => {
    renderWith([]);
    expect(await screen.findByText('No skill yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start one' }).getAttribute('href')).toBe('/skills');
  });
});
