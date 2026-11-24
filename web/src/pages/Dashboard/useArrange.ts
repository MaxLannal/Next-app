import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  COLS,
  findPanel,
  fitRect,
  MIN_H,
  MIN_W,
  placePanel,
  roomy,
  ROWS,
  showPanel,
  type DashboardLayout,
  type PanelId,
  type PanelKey,
  type Rect,
} from '@shared/layout.ts';

/** The gap between panels, as pages.css draws it (--gap). */
export const GAP = 24;
/** A press that moves less than this is a click, not a drag. */
const SLOP = 4;
/** Holding a dragged panel over a page's dot this long turns to that page. */
const TURN_HOLD_MS = 450;
const DOT_REACH = 18;

export type Edges = { n?: boolean; s?: boolean; e?: boolean; w?: boolean };

type Drag = {
  id: PanelKey;
  kind: 'move' | 'resize';
  /** The layout as it was when the press began; every step is laid out afresh from it. */
  start: DashboardLayout;
  /** The page it came from, or null for a hidden panel taken from the bar. */
  from: number | null;
  page: number;
  rect: Rect;
  /** Where the lifted panel is drawn, in pixels on its page, while it follows the pointer. */
  lifted: { left: number; top: number; width: number; height: number } | null;
  moved: boolean;
};

type Press = { x: number; y: number; grab: { dx: number; dy: number }; edges: Edges | null; r0: Rect };
type Pager = { page: number; go: (page: number) => void };

const canvasOf = (page: number) => document.querySelector<HTMLElement>(`.dash-page[data-page="${page}"] .dash-canvas`);

/**
 * Arranging the dashboard by hand: press a panel and drag it anywhere on its page, out to the
 * window's edges, or onto another (hold it over a page's dot, or turn the page with the wheel as
 * you go), and drag its edges or corners to size it. It snaps to the page's grid as it goes, and the
 * panels in its way flow aside and back. `preview` is the layout to draw meanwhile; the drop
 * saves it. Arrow keys on a panel's grip move it a cell, and with Shift size it.
 */
export function useArrange(layout: DashboardLayout, change: (next: DashboardLayout) => void, pager: Pager) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef<{ drag: Drag | null; press: Press | null }>({ drag: null, press: null });
  const turn = useRef<{ to: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const pagerRef = useRef(pager);
  pagerRef.current = pager;
  const changeRef = useRef(change);
  changeRef.current = change;

  const preview = drag ? placePanel(drag.start, drag.id, drag.page, drag.rect) : layout;

  const update = (next: Drag | null) => {
    live.current.drag = next;
    setDrag(next);
  };

  useEffect(() => {
    if (!drag) return;

    /** Where the pointer puts the panel on the page it's over. */
    const follow = (d: Drag, x: number, y: number): Drag => {
      const press = live.current.press!;
      const canvas = canvasOf(d.page);
      if (!canvas) return d;
      const box = canvas.getBoundingClientRect();
      const col = (box.width + GAP) / COLS;
      const row = (box.height + GAP) / ROWS;
      if (d.kind === 'move') {
        const left = x - box.left - press.grab.dx;
        const top = y - box.top - press.grab.dy;
        const rect = fitRect({ x: Math.round(left / col), y: Math.round(top / row), w: d.rect.w, h: d.rect.h });
        return { ...d, rect, lifted: { left, top, width: d.rect.w * col - GAP, height: d.rect.h * row - GAP } };
      }
      const { r0, edges } = press;
      const dx = Math.round((x - press.x) / col);
      const dy = Math.round((y - press.y) / row);
      let { x: rx, y: ry, w, h } = r0;
      if (edges?.e) w = Math.max(MIN_W, Math.min(COLS - rx, r0.w + dx));
      if (edges?.s) h = Math.max(MIN_H, Math.min(ROWS - ry, r0.h + dy));
      if (edges?.w) {
        rx = Math.max(0, Math.min(r0.x + r0.w - MIN_W, r0.x + dx));
        w = r0.x + r0.w - rx;
      }
      if (edges?.n) {
        ry = Math.max(0, Math.min(r0.y + r0.h - MIN_H, r0.y + dy));
        h = r0.y + r0.h - ry;
      }
      return { ...d, rect: { x: rx, y: ry, w, h } };
    };

    /** Which page a dragged panel held here asks for: the page of the dot it's over. */
    const pageAsked = (x: number, y: number): number | null => {
      // A dot is small: anywhere near one counts.
      for (const dot of document.querySelectorAll<HTMLElement>('.dash__dot')) {
        const r = dot.getBoundingClientRect();
        if (x > r.left - DOT_REACH && x < r.right + DOT_REACH && y > r.top - DOT_REACH / 2 && y < r.bottom + DOT_REACH / 2) return Number(dot.dataset.index);
      }
      return null;
    };

    const holdTurn = (to: number | null, d: Drag) => {
      if (to === null || to < 0 || to >= d.start.pages.length || to === d.page) {
        if (turn.current) clearTimeout(turn.current.timer);
        turn.current = null;
        return;
      }
      if (turn.current?.to === to) return;
      if (turn.current) clearTimeout(turn.current.timer);
      turn.current = {
        to,
        timer: setTimeout(() => {
          turn.current = null;
          const now = live.current.drag;
          if (!now || now.kind !== 'move') return;
          pagerRef.current.go(to);
          update({ ...now, page: to });
        }, TURN_HOLD_MS),
      };
    };

    const onMove = (e: PointerEvent) => {
      const d = live.current.drag;
      const press = live.current.press;
      if (!d || !press) return;
      if (!d.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) < SLOP) return;
      e.preventDefault();
      let next = follow({ ...d, moved: true }, e.clientX, e.clientY);
      // Where the others would have nowhere left to go, it goes no further.
      if (!roomy(placePanel(next.start, next.id, next.page, next.rect), next.page)) next = { ...next, rect: d.rect };
      update(next);
      if (next.kind === 'move') holdTurn(pageAsked(e.clientX, e.clientY), next);
    };
    const finish = (commit: boolean) => {
      const d = live.current.drag;
      if (turn.current) clearTimeout(turn.current.timer);
      turn.current = null;
      live.current.press = null;
      update(null);
      if (!d || !commit) return;
      // A click on a hidden panel in the bar puts it back on the page showing.
      if (!d.moved) {
        if (d.from === null) changeRef.current(showPanel(d.start, d.id as PanelId, pagerRef.current.page));
        return;
      }
      changeRef.current(placePanel(d.start, d.id, d.page, d.rect));
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
    // The listeners read the drag from `live`: they need only be in place while there is one.
  }, [drag !== null]);

  // The wheel turned the page under a panel being carried: it goes onto that page.
  useEffect(() => {
    const d = live.current.drag;
    if (d && d.kind === 'move' && d.moved && d.page !== pager.page) update({ ...d, page: pager.page });
  }, [pager.page]);

  /** A press on a panel: a move, or a resize when it's on one of its edges. */
  const press = (e: ReactPointerEvent<HTMLElement>, id: PanelKey, edges: Edges | null = null) => {
    if (e.button !== 0) return;
    const found = findPanel(layout, id);
    if (!found) return;
    e.preventDefault();
    e.stopPropagation();
    const slot = (e.currentTarget.closest('.slot') ?? e.currentTarget).getBoundingClientRect();
    const { id: _id, ...rect } = found.rect;
    live.current.press = { x: e.clientX, y: e.clientY, grab: { dx: e.clientX - slot.left, dy: e.clientY - slot.top }, edges, r0: rect };
    update({ id, kind: edges ? 'resize' : 'move', start: layout, from: found.page, page: found.page, rect, lifted: null, moved: false });
  };

  /** A press on a hidden panel in the bar: dragged out, it becomes a panel on the page under it. */
  const pressHidden = (e: ReactPointerEvent<HTMLElement>, id: PanelId) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = { x: 0, y: 0, w: 21, h: 16 };
    live.current.press = { x: e.clientX, y: e.clientY, grab: { dx: 60, dy: 24 }, edges: null, r0: rect };
    update({ id, kind: 'move', start: layout, from: null, page: pager.page, rect, lifted: null, moved: false });
  };

  /** Arrow keys on a panel's grip: a cell at a time; with Shift, its size. */
  const nudge = (e: ReactKeyboardEvent, id: PanelKey) => {
    const step = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
    const found = findPanel(layout, id);
    if (!step || !found) return;
    e.preventDefault();
    e.stopPropagation();
    const { x, y, w, h } = found.rect;
    const [dx, dy] = step;
    const next = e.shiftKey ? { x, y, w: Math.min(COLS - x, w + dx), h: Math.min(ROWS - y, h + dy) } : { x: x + dx, y: y + dy, w, h };
    change(placePanel(layout, id, found.page, next));
  };

  return { drag, preview, press, pressHidden, nudge };
}
