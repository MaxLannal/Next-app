import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

type Options = {
  min: number;
  max: number;
  initial: number;
  /** Where the width is kept (`hub:chat-width`). */
  storageKey: string;
  /** Where open or collapsed is kept (`hub:chat-open`): `'1'` or `'0'`. */
  openKey?: string;
  /** Collapsed or not before anything is saved; a saved choice wins. */
  defaultCollapsed?: boolean;
};

const STEP = 16;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or a full disk: the width just isn't remembered.
  }
}

/**
 * A right-hand panel's width, set by dragging its left edge or by the arrow keys (±16 px) on
 * that edge, clamped to `[min, max]` and remembered; and whether it is collapsed to its rail.
 * A `max` that shrinks with the window narrows the panel without forgetting the chosen width.
 */
export function useResizable({ min, max, initial, storageKey, openKey = 'hub:chat-open', defaultCollapsed = false }: Options) {
  const [chosen, setChosen] = useState(() => {
    const stored = Number(read(storageKey) ?? Number.NaN);
    return Number.isFinite(stored) && stored > 0 ? clamp(stored, min, max) : initial;
  });
  const [collapsed, setCollapsed] = useState(() => {
    const saved = read(openKey);
    return saved === null ? defaultCollapsed : saved === '0';
  });
  const [dragging, setDragging] = useState(false);
  const width = clamp(chosen, min, max);
  const latest = useRef(width);
  latest.current = width;
  const stopDrag = useRef<(() => void) | null>(null);

  const commit = useCallback(
    (next: number) => {
      const value = Math.round(clamp(next, min, max));
      setChosen(value);
      write(storageKey, String(value));
    },
    [min, max, storageKey],
  );

  useEffect(() => () => stopDrag.current?.(), []);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = latest.current;
    // The edge is on the panel's left: moving the pointer left widens it.
    const at = (clientX: number) => clamp(startWidth + (startX - clientX), min, max);
    const move = (ev: MouseEvent) => setChosen(Math.round(at(ev.clientX)));
    const up = (ev: MouseEvent) => {
      stop();
      commit(at(ev.clientX));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
      document.documentElement.classList.remove('is-resizing');
      stopDrag.current = null;
      setDragging(false);
    };
    stopDrag.current?.();
    stopDrag.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
    document.documentElement.classList.add('is-resizing');
    setDragging(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const next =
      e.key === 'ArrowLeft' ? width + STEP
      : e.key === 'ArrowRight' ? width - STEP
      : e.key === 'Home' ? min
      : e.key === 'End' ? max
      : null;
    if (next === null) return;
    e.preventDefault();
    commit(next);
  };

  const toggle = useCallback(() => {
    setCollapsed((was) => {
      write(openKey, was ? '1' : '0');
      return !was;
    });
  }, [openKey]);

  return {
    width,
    collapsed,
    dragging,
    toggle,
    handleProps: {
      role: 'separator' as const,
      'aria-orientation': 'vertical' as const,
      'aria-valuenow': width,
      'aria-valuemin': min,
      'aria-valuemax': max,
      tabIndex: 0,
      onPointerDown,
      onKeyDown,
    },
  };
}
