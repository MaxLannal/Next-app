import { useSyncExternalStore } from 'react';

/** How often the shared clock reads the time: under a second, so a shown second is never skipped. */
export const TICK_MS = 250;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function snapshot(): number {
  // With nobody listening nothing ticks, so read the time afresh — at most once a tick, so two
  // reads in one render agree.
  if (timer === undefined && Date.now() - now >= TICK_MS) now = Date.now();
  return now;
}

const still = () => () => {};
const zero = () => 0;

/**
 * One clock for every reader: the same instant for all of them, read four times a second while
 * `active`. Two components that count from the same start with it always show the same time.
 * Inactive, it does not tick and reads 0.
 */
export function useNow(active: boolean): number {
  return useSyncExternalStore(active ? subscribe : still, active ? snapshot : zero);
}
