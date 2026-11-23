import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FocusSession } from '@shared/types.ts';
import { Stopwatch } from './Stopwatch.tsx';

const session = (over: Partial<FocusSession> = {}): FocusSession => ({
  id: 1,
  name: 'Read Lamport',
  subject: { id: 2, name: 'Distributed systems' },
  tags: [],
  goalId: null,
  notes: '',
  status: 'running',
  startedAt: '2026-11-22T17:00:00.000Z',
  endedAt: null,
  focusSeconds: 0,
  autoPausedAt: null,
  attachmentCount: 0,
  events: [],
  ...over,
});

const noop = () => {};

afterEach(() => vi.useRealTimers());

describe('Stopwatch', () => {
  it('shows nothing without a session', () => {
    const { container } = render(<Stopwatch session={null} elapsed={0} onPause={noop} onResume={noop} onStop={noop} />);
    expect(container.firstChild).toBeNull();
  });

  it('fills with the running time, the subject and Pause / Stop while it runs', () => {
    const onPause = vi.fn();
    const onStop = vi.fn();
    render(<Stopwatch session={session()} elapsed={416} onPause={onPause} onResume={noop} onStop={onStop} />);
    const watch = screen.getByRole('group', { name: 'Focus: Distributed systems' });
    expect(watch.getAttribute('data-state')).toBe('running');
    expect(screen.getByRole('timer').getAttribute('aria-label')).toBe('00:06:56');
    expect(screen.getByText('Focusing')).toBeTruthy();
    screen.getByRole('button', { name: 'Pause' }).click();
    screen.getByRole('button', { name: 'Stop' }).click();
    expect(onPause).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('sweeps its ring through the minute and starts a new lap each minute', () => {
    const { rerender, container } = render(<Stopwatch session={session()} elapsed={30} onPause={noop} onResume={noop} onStop={noop} />);
    const sweep = () => container.querySelector('.stopwatch__sweep') as SVGCircleElement;
    const full = Number(sweep().getAttribute('stroke-dasharray'));
    expect(Number(sweep().getAttribute('stroke-dashoffset'))).toBeCloseTo(full / 2, 3);
    const firstLap = sweep();
    rerender(<Stopwatch session={session()} elapsed={60} onPause={noop} onResume={noop} onStop={noop} />);
    expect(sweep()).not.toBe(firstLap);
    expect(Number(sweep().getAttribute('stroke-dashoffset'))).toBeCloseTo(full, 3);
  });

  it('waits in apricot with Resume while paused', () => {
    const onResume = vi.fn();
    render(<Stopwatch session={session({ status: 'paused' })} elapsed={90} onPause={noop} onResume={onResume} onStop={noop} />);
    expect(screen.getByRole('group').getAttribute('data-state')).toBe('paused');
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    screen.getByRole('button', { name: 'Resume' }).click();
    expect(onResume).toHaveBeenCalledOnce();
  });

  it('says so when the Mac slept', () => {
    render(<Stopwatch session={session({ status: 'paused', autoPausedAt: '2026-11-22T17:40:00.000Z' })} elapsed={90} onPause={noop} onResume={noop} onStop={noop} />);
    expect(screen.getByText('Paused while your Mac slept')).toBeTruthy();
  });

  it('drains away after Stop, then leaves the panel', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<Stopwatch session={session()} elapsed={120} onPause={noop} onResume={noop} onStop={noop} />);
    rerender(<Stopwatch session={null} elapsed={0} onPause={noop} onResume={noop} onStop={noop} />);
    // Still there, draining, with its last time and its keys off.
    const watch = screen.getByRole('group');
    expect(watch.getAttribute('data-state')).toBe('leaving');
    expect(screen.getByRole('timer').getAttribute('aria-label')).toBe('00:02:00');
    expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(container.firstChild).toBeNull();
  });
});
