// The skill canvas in world units. Stages are horizontal bands stacked upward from y = 0 (stage 1,
// the foundations, sits just above it). Each stage is as tall as what it holds, never shorter
// than STAGE_MIN_H, and the empty one on top keeps that minimum. A node's `y` is measured from
// the top of its own stage, so a stage that grows carries the stages above it up with their cards.
// The view is a pan (tx, ty) plus a zoom (k).

export const STAGE_MIN_H = 300;
export const STAGE_W = 2400;
export const STAGE_LEFT = -STAGE_W / 2;
/** Room above the first card in a stage, under the stage's name. */
export const STAGE_PAD_TOP = 48;
/** Room under the lowest card in a stage. */
export const STAGE_PAD_BOTTOM = 32;
/** A step card grows with its text between these widths, then wraps. */
export const STEP_MIN_W = 220;
export const STEP_MAX_W = 340;
/** Sizes used until a card has been measured. */
export const STEP_W = 248;
export const STEP_H = 132;
export const EXPERIENCE_W = 240;
export const EXPERIENCE_H = 78;
export const MIN_K = 0.3;
export const MAX_K = 2;

export type View = { tx: number; ty: number; k: number };
export type Box = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };
/** Where each stage sits: `tops[i]` is the world y of stage i's top edge, `heights[i]` its height. */
export type Layout = { tops: number[]; heights: number[] };

type Placed = { id: number; kind: 'step' | 'experience'; layer: number; x: number; y: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Layers used, plus the empty one that always waits on top. */
export const stageCount = (nodes: { layer: number }[]) => nodes.reduce((top, n) => Math.max(top, n.layer + 1), 0) + 1;

/** A node's measured size, or the default for its kind until it has been measured. */
export const sizeOf = (n: Placed, sizes: ReadonlyMap<number, Size>): Size =>
  sizes.get(n.id) ?? (n.kind === 'step' ? { w: STEP_W, h: STEP_H } : { w: EXPERIENCE_W, h: EXPERIENCE_H });

/** Each stage as tall as its lowest card needs, and at least STAGE_MIN_H; stacked upward from y = 0. */
export function stageLayout(nodes: Placed[], sizes: ReadonlyMap<number, Size>): Layout {
  const count = stageCount(nodes);
  const heights = Array.from({ length: count }, () => STAGE_MIN_H);
  for (const n of nodes) heights[n.layer] = Math.max(heights[n.layer], n.y + sizeOf(n, sizes).h + STAGE_PAD_BOTTOM);
  const tops: number[] = [];
  let edge = 0;
  for (const h of heights) {
    edge -= h;
    tops.push(edge);
  }
  return { tops, heights };
}

/** The stage a point at world `y` falls in; above the top stage or below the foundations, the nearest. */
export function layerAt(y: number, layout: Layout): number {
  const { tops, heights } = layout;
  for (let i = 0; i < tops.length; i++) if (y >= tops[i] && y < tops[i] + heights[i]) return i;
  return y >= 0 ? 0 : tops.length - 1;
}

/** A world y turned into a y within stage `layer`, kept under the stage's name. */
export const offsetIn = (worldY: number, layer: number, layout: Layout) => Math.max(STAGE_PAD_TOP, worldY - layout.tops[layer]);

/** A node's box in world units. */
export function boxOf(n: Placed, sizes: ReadonlyMap<number, Size>, layout: Layout): Box {
  const { w, h } = sizeOf(n, sizes);
  return { x: n.x, y: (layout.tops[n.layer] ?? 0) + n.y, w, h };
}

/** "Stage 1", or "Stage 1 · Foundations" once it has been given a name. */
export function stageName(i: number, names: Record<number, string>): string {
  const name = names[i]?.trim();
  return name ? `Stage ${i + 1} · ${name}` : `Stage ${i + 1}`;
}

/** Zooms by `factor` about the screen point (px, py), so that point stays put. */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const k = clamp(view.k * factor, MIN_K, MAX_K);
  const f = k / view.k;
  return { k, tx: px - (px - view.tx) * f, ty: py - (py - view.ty) * f };
}

/** Screen room kept under the foundations by a fit, so the zoom buttons and "+" don't cover cards. */
const FIT_BOTTOM = 84;

/** A view that shows every stage across the width, the foundations at the bottom of the screen. */
export function fitView(layout: Layout, width: number, height: number): View {
  const worldH = -(layout.tops.at(-1) ?? -STAGE_MIN_H);
  const k = clamp(Math.min((height - FIT_BOTTOM - 16) / worldH, width / (STAGE_W * 0.55)), MIN_K, 1);
  return { k, tx: width / 2, ty: height - FIT_BOTTOM };
}

/** Screen point → world point. */
export const toWorld = (view: View, sx: number, sy: number) => ({ x: (sx - view.tx) / view.k, y: (sy - view.ty) / view.k });

export const contains = (b: Box, x: number, y: number) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/**
 * A soft curve from an experience to its step: from the experience's nearer vertical edge to the
 * step's, bowing like a hanging thread.
 */
export function linkPath(exp: Box, step: Box): string {
  const ex = exp.x + exp.w / 2;
  const sx = step.x + step.w / 2;
  const below = exp.y > step.y + step.h / 2;
  const ey = below ? exp.y : exp.y + exp.h;
  const sy = below ? step.y + step.h : step.y;
  const bend = Math.max(40, Math.abs(ey - sy) * 0.5);
  const dir = below ? -1 : 1;
  return `M ${ex} ${ey} C ${ex} ${ey + dir * bend}, ${sx} ${sy - dir * bend}, ${sx} ${sy}`;
}

/** Experiences settle under their step three to a row; the stage grows to hold more rows. */
export const SLOTS_PER_ROW = 3;

/** Where the `index`-th experience linked to a step settles (world units); `rowH` is the tallest of them. */
export function slotFor(step: Box, index: number, rowH = EXPERIENCE_H): { x: number; y: number } {
  const col = index % SLOTS_PER_ROW;
  const row = Math.floor(index / SLOTS_PER_ROW);
  return { x: step.x + col * (EXPERIENCE_W + 12), y: step.y + step.h + 28 + row * (rowH + 14) };
}

const overlaps = (a: Box, b: Box, gap = 16) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * The nearest free place for `want` among `taken`: the spot itself if it's clear, else sliding
 * right and left by a card's width, a little further each time, staying on the stage; when a row
 * is full, the same a row further down (the stage grows to hold it).
 */
export function freeSpot(taken: Box[], want: Box): { x: number; y: number } {
  const stride = want.w + 24;
  for (let row = 0; row < 8; row++) {
    const y = want.y + row * (want.h + 24);
    for (let i = 0; i < 24; i++) {
      const shift = i === 0 ? 0 : Math.ceil(i / 2) * stride * (i % 2 === 1 ? 1 : -1);
      const x = want.x + shift;
      if (x < STAGE_LEFT + 16 || x + want.w > STAGE_LEFT + STAGE_W - 16) continue;
      const box = { ...want, x, y };
      if (!taken.some((b) => overlaps(b, box))) return { x, y };
    }
  }
  return { x: want.x, y: want.y };
}
