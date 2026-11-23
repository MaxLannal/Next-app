import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useResizable } from './useResizable.ts';

const OPTIONS = { min: 320, max: 640, initial: 400, storageKey: 'hub:chat-width', openKey: 'hub:chat-open' };

const pointerDown = (clientX: number) => ({ clientX, button: 0, preventDefault() {} }) as unknown as PointerEvent<HTMLElement>;
const key = (k: string) => ({ key: k, preventDefault() {} }) as unknown as KeyboardEvent<HTMLElement>;
const move = (clientX: number) => window.dispatchEvent(new MouseEvent('pointermove', { clientX }));
const up = (clientX: number) => window.dispatchEvent(new MouseEvent('pointerup', { clientX }));

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('useResizable', () => {
  it('clamps and persists', () => {
    const { result } = renderHook(() => useResizable(OPTIONS));
    expect(result.current.width).toBe(400);

    // The handle is the panel's left edge: dragging left widens it. 400 + 500 would be 900.
    act(() => result.current.handleProps.onPointerDown(pointerDown(1000)));
    act(() => move(500));
    expect(result.current.width).toBe(640);
    act(() => up(500));
    expect(localStorage.getItem('hub:chat-width')).toBe('640');

    act(() => result.current.handleProps.onPointerDown(pointerDown(500)));
    act(() => move(1200));
    act(() => up(1200));
    expect(result.current.width).toBe(320);
    expect(localStorage.getItem('hub:chat-width')).toBe('320');
  });

  it('moves 16 px per arrow key, as a separator', () => {
    const { result } = renderHook(() => useResizable(OPTIONS));
    const props = () => result.current.handleProps;
    expect(props()).toMatchObject({ role: 'separator', 'aria-orientation': 'vertical', 'aria-valuemin': 320, 'aria-valuemax': 640, 'aria-valuenow': 400, tabIndex: 0 });

    act(() => props().onKeyDown(key('ArrowLeft')));
    expect(result.current.width).toBe(416);
    act(() => props().onKeyDown(key('ArrowRight')));
    act(() => props().onKeyDown(key('ArrowRight')));
    expect(result.current.width).toBe(384);
    expect(props()['aria-valuenow']).toBe(384);
    expect(localStorage.getItem('hub:chat-width')).toBe('384');

    act(() => props().onKeyDown(key('End')));
    expect(result.current.width).toBe(640);
    act(() => props().onKeyDown(key('Home')));
    expect(result.current.width).toBe(320);
  });

  it('reads the stored width, clamped, and ignores one that is not a number', () => {
    localStorage.setItem('hub:chat-width', '2000');
    expect(renderHook(() => useResizable(OPTIONS)).result.current.width).toBe(640);
    localStorage.setItem('hub:chat-width', 'wide');
    expect(renderHook(() => useResizable(OPTIONS)).result.current.width).toBe(400);
  });

  it('starts closed when asked to, until a choice is saved', () => {
    expect(renderHook(() => useResizable({ ...OPTIONS, defaultCollapsed: true })).result.current.collapsed).toBe(true);
    localStorage.setItem('hub:chat-open', '1');
    expect(renderHook(() => useResizable({ ...OPTIONS, defaultCollapsed: true })).result.current.collapsed).toBe(false);
    localStorage.setItem('hub:chat-open', '0');
    expect(renderHook(() => useResizable({ ...OPTIONS, defaultCollapsed: false })).result.current.collapsed).toBe(true);
  });

  it('opens and closes, and remembers which', () => {
    const { result, unmount } = renderHook(() => useResizable({ ...OPTIONS, defaultCollapsed: true }));
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.setOpen(true));
    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem('hub:chat-open')).toBe('1');
    unmount();

    const again = renderHook(() => useResizable({ ...OPTIONS, defaultCollapsed: true }));
    expect(again.result.current.collapsed).toBe(false);
    act(() => again.result.current.setOpen(false));
    expect(again.result.current.collapsed).toBe(true);
    expect(localStorage.getItem('hub:chat-open')).toBe('0');
    act(() => again.result.current.toggle());
    expect(localStorage.getItem('hub:chat-open')).toBe('1');
  });
});
