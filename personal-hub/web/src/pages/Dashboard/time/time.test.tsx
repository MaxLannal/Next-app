import { act, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { TimePanel } from './TimePanel.tsx';

// The panel uses the system time zone; pin it to the hub's for this file.
beforeAll(() => {
  vi.stubEnv('TZ', 'America/Chicago');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T20:59:12Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

it('shows the date, a live clock, the ISO week and the days left', () => {
  render(<TimePanel />);

  expect(screen.getByText('Sunday, 22 November')).toBeTruthy();
  const clock = screen.getByText('14:59:12');
  expect(clock.closest('[aria-live]')?.getAttribute('aria-live')).toBe('off');
  expect(screen.getByText('Week 47 · 39 days left in 2026')).toBeTruthy();
});

it('ticks every second', () => {
  render(<TimePanel />);

  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.getByText('14:59:13')).toBeTruthy();
});

it('rolls over at midnight', () => {
  vi.setSystemTime(new Date('2026-12-28T05:59:59Z')); // Sunday 27 December, 23:59:59 in Chicago
  render(<TimePanel />);
  expect(screen.getByText('Week 52 · 4 days left in 2026')).toBeTruthy();

  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.getByText('Monday, 28 December')).toBeTruthy();
  expect(screen.getByText('00:00:00')).toBeTruthy();
  expect(screen.getByText('Week 53 · 3 days left in 2026')).toBeTruthy();
});
