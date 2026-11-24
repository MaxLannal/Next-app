import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** How far one push of the wheel or trackpad has to travel before the page turns. */
export const TURN_PX = 160;
/** A push has ended once the wheel has been quiet this long. */
const QUIET_MS = 200;
/** How long a turn takes; matches `--page-turn` in base.css. */
const TURN_MS = 760;
/** How far a page leans toward a push before it turns, at most. */
const LEAN_MAX = 44;
/** A swipe on a touch screen this long turns the page. */
const SWIPE_PX = 80;
/**
 * Paging needs room for a whole page: wide enough for the second page's panels side by side in
 * their compact form, and tall enough that they fit it. A smaller window scrolls as one long page.
 */
export const PAGED_QUERY = '(min-width: 1180px) and (min-height: 680px)';

const typing = (el: Element | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** Whether something between `target` and `root` can still scroll the way the wheel is going. */
function innerScroller(target: EventTarget | null, root: HTMLElement, dy: number): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 1) continue;
    const { overflowY } = getComputedStyle(el);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    if (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
  }
  return false;
}

const query = () => (typeof window.matchMedia === 'function' ? window.matchMedia(PAGED_QUERY) : null);
const subscribe = (onChange: () => void) => {
  const list = query();
  list?.addEventListener('change', onChange);
  return () => list?.removeEventListener('change', onChange);
};
const matches = () => query()?.matches ?? false;

/** Whether the dashboard is in pages right now: its panels take their compact form when it is. */
export function usePaged(): boolean {
  return useSyncExternalStore(subscribe, matches, () => false);
}

/**
 * Whole-screen pages turned with some force: a push of the wheel or trackpad leans the page toward
 * where it's going and turns it once it has travelled far enough, springing back if it stops
 * short; the rest of that push is swallowed, so one swipe never turns two pages. The keys, a swipe
 * on a touch screen and Tab into another page turn it too. Lists inside a page scroll first, and a
 * push that scrolled one never turns the page as well, even once the list runs out.
 */
export function usePager(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const paged = usePaged();
  // The page asked for, which may be one that only exists once the layout catches up (a page just
  // added); the page shown is the nearest one there is.
  const [wanted, setWanted] = useState(0);
  const page = Math.min(wanted, Math.max(0, count - 1));
  const [lean, setLean] = useState(0);
  const live = useRef({ page, push: 0, held: false, inner: false, quiet: 0 as ReturnType<typeof setTimeout> | 0, turnedAt: -Infinity });
  live.current.page = page;

  const go = useCallback((to: number) => {
    live.current.turnedAt = performance.now();
    setLean(0);
    setWanted(Math.max(0, to));
  }, []);

  useEffect(() => {
    const root = ref.current;
    if (!root || !paged) return;
    const state = live.current;

    const settle = () => {
      state.push = 0;
      state.held = false;
      state.inner = false;
      setLean(0);
    };
    const restartQuiet = () => {
      if (state.quiet) clearTimeout(state.quiet);
      state.quiet = setTimeout(settle, QUIET_MS);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * root.clientHeight : e.deltaY;
      if (Math.abs(dy) < Math.abs(e.deltaX)) return;
      if (innerScroller(e.target, root, dy)) {
        // A list inside the page takes this push, and keeps it: when the list runs out, the rest
        // of the push is momentum, not a turn.
        state.inner = true;
        restartQuiet();
        return;
      }
      e.preventDefault();
      restartQuiet();
      // After a turn, or once a list has had the push, the rest of it is momentum: let it run out.
      if (state.held || state.inner || performance.now() - state.turnedAt < TURN_MS) {
        state.held = true;
        return;
      }
      state.push += dy;
      const dir = Math.sign(state.push);
      const canGo = dir > 0 ? state.page < count - 1 : state.page > 0;
      const reach = Math.abs(state.push);
      // The page leans toward the push, harder the further it goes; at the ends it barely gives.
      setLean(-dir * Math.min(reach * (canGo ? 0.22 : 0.06), canGo ? LEAN_MAX : 14));
      if (canGo && reach >= TURN_PX) {
        state.push = 0;
        state.held = true;
        go(state.page + dir);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(document.activeElement)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const to =
        e.key === 'PageDown' || e.key === 'ArrowDown' || (e.key === ' ' && !e.shiftKey) ? state.page + 1
        : e.key === 'PageUp' || e.key === 'ArrowUp' || (e.key === ' ' && e.shiftKey) ? state.page - 1
        : e.key === 'Home' ? 0
        : e.key === 'End' ? count - 1
        : null;
      if (to === null) return;
      e.preventDefault();
      go(to);
    };

    let touchY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches.length === 1 && !innerScroller(e.target, root, 0) ? e.touches[0]!.clientY : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (touchY === null) return;
      const dy = touchY - e.touches[0]!.clientY;
      const canGo = dy > 0 ? state.page < count - 1 : state.page > 0;
      setLean(-Math.sign(dy) * Math.min(Math.abs(dy) * (canGo ? 0.3 : 0.08), canGo ? LEAN_MAX * 1.5 : 14));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (touchY === null) return;
      const dy = touchY - (e.changedTouches[0]?.clientY ?? touchY);
      touchY = null;
      if (Math.abs(dy) >= SWIPE_PX) go(state.page + Math.sign(dy));
      else setLean(0);
    };

    // Tab into a page that isn't showing, and it turns to show it.
    const onFocus = (e: FocusEvent) => {
      const page = (e.target as Element | null)?.closest<HTMLElement>('[data-page]');
      const index = page ? Number(page.dataset.page) : NaN;
      if (Number.isInteger(index) && index !== state.page) go(index);
    };
    // A link to a panel's id would scroll the clipped frame; the pages move by turning only.
    const onScroll = () => {
      if (root.scrollTop !== 0) root.scrollTop = 0;
    };

    root.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: true });
    root.addEventListener('touchend', onTouchEnd);
    root.addEventListener('focusin', onFocus);
    root.addEventListener('scroll', onScroll);
    return () => {
      if (state.quiet) clearTimeout(state.quiet);
      root.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('focusin', onFocus);
      root.removeEventListener('scroll', onScroll);
    };
  }, [paged, count, go]);

  return { ref, paged, page, lean, go };
}
