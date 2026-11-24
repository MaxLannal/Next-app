import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURN_PX, usePager } from './usePager.ts';

function stubPaged(paged: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: paged, media: query, addEventListener: () => {}, removeEventListener: () => {} })),
  );
}

/** Three pages, a list inside the first that can scroll, and what the pager says. */
function Pages() {
  const pager = usePager(3);
  return (
    <div ref={pager.ref} data-testid="frame">
      <output data-testid="page">{pager.page}</output>
      <output data-testid="lean">{pager.lean}</output>
      <output data-testid="paged">{String(pager.paged)}</output>
      <div data-testid="list" style={{ overflowY: 'auto' }}>
        <input aria-label="Note" />
      </div>
    </div>
  );
}

const page = () => Number(screen.getByTestId('page').textContent);
const lean = () => Number(screen.getByTestId('lean').textContent);
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

/** One swipe: `steps` wheel events of `dy` each, a frame apart, over `target`. */
function swipe(target: Element, steps: number, dy = 40) {
  for (let i = 0; i < steps; i++) {
    fireEvent.wheel(target, { deltaY: dy });
    act(() => vi.advanceTimersByTime(16));
  }
}

/** Gives the list `room` px left to scroll down, as a browser's layout would. */
function scrollRoom(list: HTMLElement, room: number) {
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 100 });
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 100 + room });
  list.scrollTop = 0;
}

describe('turning the dashboard pages', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    stubPaged(true);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('leans toward a small push without turning, and springs back once it stops', () => {
    render(<Pages />);
    swipe(screen.getByTestId('frame'), 1, 60);
    expect(page()).toBe(0);
    expect(lean()).toBeLessThan(0);
    wait(300);
    expect(lean()).toBe(0);
    expect(page()).toBe(0);
  });

  it('turns one page for a firm push, however long the swipe runs on', () => {
    render(<Pages />);
    swipe(screen.getByTestId('frame'), 40);
    expect(page()).toBe(1);
    wait(300);
    // A fresh push, once the last has gone quiet, turns the next.
    swipe(screen.getByTestId('frame'), Math.ceil(TURN_PX / 40));
    expect(page()).toBe(2);
  });

  it('never turns past the last page, and turns back with a push up', () => {
    render(<Pages />);
    for (let i = 0; i < 4; i++) {
      swipe(screen.getByTestId('frame'), 6);
      wait(1000);
    }
    expect(page()).toBe(2);
    swipe(screen.getByTestId('frame'), 6, -40);
    expect(page()).toBe(1);
  });

  it('lets a list inside the page take a push, and never turns the page as well once the list runs out', () => {
    render(<Pages />);
    const list = screen.getByTestId('list');
    scrollRoom(list, 80);
    swipe(list, 3);
    expect(page()).toBe(0);
    // The list has reached its end, and the same push keeps coming.
    list.scrollTop = 80;
    swipe(list, 20);
    expect(page()).toBe(0);
    wait(300);
    swipe(list, Math.ceil(TURN_PX / 40));
    expect(page()).toBe(1);
  });

  it('turns with the keys, but not while typing', () => {
    render(<Pages />);
    fireEvent.keyDown(window, { key: 'PageDown' });
    expect(page()).toBe(1);
    fireEvent.keyDown(window, { key: 'End' });
    expect(page()).toBe(2);
    fireEvent.keyDown(window, { key: 'Home' });
    expect(page()).toBe(0);
    screen.getByLabelText('Note').focus();
    fireEvent.keyDown(window, { key: 'PageDown' });
    expect(page()).toBe(0);
  });

  it('leaves a small window to scroll as one long page', () => {
    stubPaged(false);
    render(<Pages />);
    expect(screen.getByTestId('paged').textContent).toBe('false');
    swipe(screen.getByTestId('frame'), 40);
    fireEvent.keyDown(window, { key: 'PageDown' });
    expect(page()).toBe(0);
  });
});
