import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { dropIndex, shiftFor, slotOffset } from './rank.ts';

/** A mouse can grab a row anywhere but its controls; touch and pen grab the grip, so a list still scrolls. */
const CONTROLS = 'button, input, select, textarea, a, label, [role="group"]';
/** How far a press has to travel before it is a drag rather than a click. */
const START_PX = 5;
/** How long the dropped row takes to glide into its slot. */
const SETTLE_MS = 160;

type Grab = { pointerId: number; from: number; startY: number; mids: number[]; heights: number[]; minDy: number; maxDy: number; live: boolean };
type Drag = { from: number; to: number; dy: number; height: number; settling: boolean };

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Drag a row of a list to rank it. The row follows the pointer, the rows it passes slide aside
 * to make room, and on release it glides into its slot before `onDrop(from, to)` reorders the list.
 */
export function useDragRank(onDrop: (from: number, to: number) => void) {
  const listRef = useRef<HTMLUListElement>(null);
  const grab = useRef<Grab | null>(null);
  const live = useRef<Drag | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [dropped, setDropped] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setDrag = (next: Drag | null) => {
    live.current = next;
    setDragState(next);
  };

  useEffect(
    () => () => {
      if (settle.current !== null) clearTimeout(settle.current);
    },
    [],
  );

  // For one frame after a drop the rows move without transitions, or they'd slide back from their old offsets.
  useEffect(() => {
    if (!dropped) return;
    const frame = requestAnimationFrame(() => setDropped(false));
    return () => cancelAnimationFrame(frame);
  }, [dropped]);

  const start = (index: number) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || live.current !== null) return;
    const target = e.target as HTMLElement;
    const onGrip = target.closest('[data-grip]') !== null;
    if (!onGrip && (e.pointerType !== 'mouse' || target.closest(CONTROLS) !== null)) return;
    const rects = Array.from(listRef.current?.children ?? [], (row) => row.getBoundingClientRect());
    const self = rects[index];
    const first = rects[0];
    const last = rects[rects.length - 1];
    if (self === undefined || first === undefined || last === undefined) return;
    // No text selection while a mouse drags the row.
    if (e.pointerType === 'mouse' && !onGrip) e.preventDefault();
    grab.current = {
      pointerId: e.pointerId,
      from: index,
      startY: e.clientY,
      mids: rects.map((r) => r.top + r.height / 2),
      heights: rects.map((r) => r.height),
      minDy: first.top - self.top,
      maxDy: last.bottom - self.bottom,
      live: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const move = (e: PointerEvent<HTMLElement>) => {
    const g = grab.current;
    if (g === null || e.pointerId !== g.pointerId) return;
    const travelled = e.clientY - g.startY;
    if (!g.live && Math.abs(travelled) < START_PX) return;
    g.live = true;
    const dy = Math.min(g.maxDy, Math.max(g.minDy, travelled));
    // Held against either end of the list, it goes to that end, whatever the rows' heights.
    const to = dy <= g.minDy ? 0 : dy >= g.maxDy ? g.mids.length - 1 : dropIndex(g.mids, g.from, g.mids[g.from]! + dy);
    setDrag({ from: g.from, to, dy, height: g.heights[g.from]!, settling: false });
  };

  const end = (commit: boolean) => (e: PointerEvent<HTMLElement>) => {
    const g = grab.current;
    if (g === null || e.pointerId !== g.pointerId) return;
    grab.current = null;
    const d = live.current;
    if (!g.live || d === null) return;
    if (!commit) {
      setDrag(null);
      return;
    }
    setDrag({ ...d, dy: slotOffset(g.heights, d.from, d.to), settling: true });
    settle.current = setTimeout(
      () => {
        settle.current = null;
        setDrag(null);
        setDropped(true);
        if (d.from !== d.to) onDrop(d.from, d.to);
      },
      reducedMotion() ? 0 : SETTLE_MS,
    );
  };

  return {
    listRef,
    /** The list's class while a row is up, and for the frame after it lands. */
    listState: drag !== null ? 'is-ranking' : dropped ? 'is-dropped' : '',
    dragging: drag?.from ?? null,
    handlers: (index: number) => ({
      onPointerDown: start(index),
      onPointerMove: move,
      onPointerUp: end(true),
      onPointerCancel: end(false),
    }),
    /** The row's offset: following the pointer, gliding into its slot, or sliding aside for it. */
    style: (index: number): CSSProperties | undefined => {
      if (drag === null) return undefined;
      if (index === drag.from) {
        return { transform: `translateY(${drag.dy}px)`, transition: drag.settling ? `transform ${SETTLE_MS}ms var(--ease-out)` : 'none' };
      }
      const shift = shiftFor(index, drag.from, drag.to, drag.height);
      return shift === 0 ? undefined : { transform: `translateY(${shift}px)` };
    },
  };
}
