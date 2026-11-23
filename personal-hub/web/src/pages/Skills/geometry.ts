// The skill canvas in world units: stages are horizontal bands stacked upward from y = 0 (stage 1,
// the foundations, sits just above it), and the view is a pan (tx, ty) plus a zoom (k).

export const STAGE_H = 300;
export const STAGE_W = 2400;
export const STAGE_LEFT = -STAGE_W / 2;
export const STEP_W = 248;
export const STEP_H = 132;
export const EXPERIENCE_W = 216;
export const EXPERIENCE_H = 78;
export const MIN_K = 0.3;
export const MAX_K = 2;

export type View = { tx: number; ty: number; k: number };
export type Box = { x: number; y: number; w: number; h: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Layers used, plus the empty one that always waits on top. */
export const stageCount = (nodes: { layer: number }[]) => nodes.reduce((top, n) => Math.max(top, n.layer + 1), 0) + 1;

/** The top edge (world y) of stage `i`, counted from 0 at the bottom. */
export const stageTop = (i: number) => -(i + 1) * STAGE_H;

/** The stage a point at world `y` falls in, kept within the stages there are. */
export const layerAt = (y: number, stages: number) => clamp(Math.floor(-y / STAGE_H), 0, stages - 1);

/** Keeps a box of height `h` inside stage `layer`, with a little air top and bottom. */
export const yInLayer = (y: number, h: number, layer: number) => clamp(y, stageTop(layer) + 36, stageTop(layer) + STAGE_H - h - 16);

const NAMES = ['Foundations', 'Deeper concepts', 'Connections and projects'];
/** "Stage 1 · Foundations" …; the empty top one invites the next. */
export function stageName(i: number, stages: number): string {
  if (i === stages - 1) return `Stage ${i + 1} · drag harder work here to open it`;
  return `Stage ${i + 1} · ${NAMES[i] ?? 'Mastery'}`;
}

/** Zooms by `factor` about the screen point (px, py), so that point stays put. */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const k = clamp(view.k * factor, MIN_K, MAX_K);
  const f = k / view.k;
  return { k, tx: px - (px - view.tx) * f, ty: py - (py - view.ty) * f };
}

/** A view that shows every stage across the width, the foundations at the bottom of the screen. */
export function fitView(stages: number, width: number, height: number): View {
  const worldH = stages * STAGE_H + 80;
  const k = clamp(Math.min(height / worldH, width / (STAGE_W * 0.55)), MIN_K, 1);
  return { k, tx: width / 2, ty: height - 40 * k };
}

/** Screen point → world point. */
export const toWorld = (view: View, sx: number, sy: number) => ({ x: (sx - view.tx) / view.k, y: (sy - view.ty) / view.k });

export const boxOf = (n: { kind: 'step' | 'experience'; x: number; y: number }): Box =>
  n.kind === 'step' ? { x: n.x, y: n.y, w: STEP_W, h: STEP_H } : { x: n.x, y: n.y, w: EXPERIENCE_W, h: EXPERIENCE_H };

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

/**
 * Where the `index`-th experience linked to a step settles: in a row under the step while the
 * stage has room, otherwise in a column to its right.
 */
export function slotFor(step: Box, index: number, layer: number): { x: number; y: number } {
  const below = step.y + step.h + 28;
  const stageBottom = stageTop(layer) + STAGE_H;
  if (below + EXPERIENCE_H <= stageBottom - 12) return { x: step.x + index * (EXPERIENCE_W + 12), y: below };
  return { x: step.x + step.w + 24, y: Math.min(step.y + index * (EXPERIENCE_H + 10), stageBottom - EXPERIENCE_H - 12) };
}

const overlaps = (a: Box, b: Box, gap = 16) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * The nearest free place for `want` among `taken`: the spot itself if it's clear, else sliding
 * right and left by a card's width, a little further each time, staying on the stage.
 */
export function freeSpot(taken: Box[], want: Box): { x: number; y: number } {
  const stride = want.w + 24;
  for (let i = 0; i < 24; i++) {
    const shift = i === 0 ? 0 : Math.ceil(i / 2) * stride * (i % 2 === 1 ? 1 : -1);
    const x = want.x + shift;
    if (x < STAGE_LEFT + 16 || x + want.w > STAGE_LEFT + STAGE_W - 16) continue;
    const box = { ...want, x };
    if (!taken.some((b) => overlaps(b, box))) return { x, y: want.y };
  }
  return { x: want.x, y: want.y };
}
