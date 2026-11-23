import { describe, expect, it } from 'vitest';
import {
  fitView,
  freeSpot,
  layerAt,
  linkPath,
  offsetIn,
  slotFor,
  stageCount,
  stageLayout,
  stageName,
  STAGE_MIN_H,
  STAGE_PAD_BOTTOM,
  STAGE_PAD_TOP,
  STEP_H,
  STEP_W,
  toWorld,
  zoomAt,
} from './geometry.ts';

const step = (id: number, layer: number, y: number) => ({ id, kind: 'step' as const, layer, x: 0, y });
const none = new Map<number, { w: number; h: number }>();

describe('skill canvas geometry', () => {
  it('always keeps one empty stage on top', () => {
    expect(stageCount([])).toBe(1);
    expect(stageCount([{ layer: 0 }])).toBe(2);
    expect(stageCount([{ layer: 0 }, { layer: 2 }])).toBe(4);
  });

  it('starts as two stages split by one line, stacked upward from y = 0', () => {
    const layout = stageLayout([step(1, 0, 60)], none);
    expect(layout.heights).toEqual([STAGE_MIN_H, STAGE_MIN_H]);
    expect(layout.tops).toEqual([-STAGE_MIN_H, -2 * STAGE_MIN_H]);
  });

  it('grows a crowded stage to hold its lowest card, and carries the stages above up with it', () => {
    const sizes = new Map([[2, { w: 240, h: 200 }]]);
    const layout = stageLayout([step(1, 0, 60), step(2, 0, 400), step(3, 1, 60)], sizes);
    expect(layout.heights[0]).toBe(400 + 200 + STAGE_PAD_BOTTOM);
    expect(layout.heights[1]).toBe(STAGE_MIN_H);
    expect(layout.tops[1]).toBe(-layout.heights[0] - STAGE_MIN_H);
  });

  it('places a drop in the stage under it, or the nearest one', () => {
    const layout = stageLayout([step(1, 0, 60)], none);
    expect(layerAt(-10, layout)).toBe(0);
    expect(layerAt(-STAGE_MIN_H - 10, layout)).toBe(1);
    expect(layerAt(-STAGE_MIN_H * 9, layout)).toBe(1);
    expect(layerAt(200, layout)).toBe(0);
  });

  it('measures a card from the top of its stage, kept under the stage name', () => {
    const layout = stageLayout([step(1, 0, 60)], none);
    expect(offsetIn(layout.tops[1] + 100, 1, layout)).toBe(100);
    expect(offsetIn(layout.tops[1] - 50, 1, layout)).toBe(STAGE_PAD_TOP);
  });

  it('shows "Stage n" until a stage is given a name', () => {
    expect(stageName(0, {})).toBe('Stage 1');
    expect(stageName(1, { 1: 'Circuits' })).toBe('Stage 2 · Circuits');
    expect(stageName(1, { 1: '   ' })).toBe('Stage 2');
  });

  it('zooms about the pointer, within limits', () => {
    const view = { tx: 100, ty: 100, k: 1 };
    const zoomed = zoomAt(view, 2, 300, 300);
    expect(toWorld(zoomed, 300, 300)).toEqual(toWorld(view, 300, 300));
    expect(zoomAt(view, 100, 0, 0).k).toBe(2);
    expect(zoomAt(view, 0.001, 0, 0).k).toBe(0.3);
  });

  it('fits every stage on screen with the foundations at the bottom', () => {
    const layout = stageLayout([step(1, 0, 60), step(2, 1, 60)], none);
    const v = fitView(layout, 1200, 800);
    expect(v.k).toBeLessThanOrEqual(1);
    expect(v.ty).toBeLessThanOrEqual(800);
    expect(toWorld(v, 600, 0).y).toBeLessThanOrEqual(layout.tops[2] + 1);
  });

  it('draws a link as one cubic curve between the two boxes', () => {
    const d = linkPath({ x: 0, y: 200, w: 100, h: 50 }, { x: 0, y: 0, w: 100, h: 100 });
    expect(d).toMatch(/^M 50 200 C .* 50 100$/);
  });
});

describe('where a linked experience settles', () => {
  it('goes under its step, three to a row, then a row further down', () => {
    const s = { x: 0, y: -280, w: STEP_W, h: STEP_H };
    expect(slotFor(s, 0)).toEqual({ x: 0, y: s.y + STEP_H + 28 });
    expect(slotFor(s, 1).x).toBeGreaterThan(0);
    expect(slotFor(s, 1).y).toBe(slotFor(s, 0).y);
    expect(slotFor(s, 3, 120)).toEqual({ x: 0, y: s.y + STEP_H + 28 + 134 });
  });
});

describe('placing a new card', () => {
  it('keeps the spot when it is clear and slides off a card that is in the way', () => {
    const want = { x: 0, y: -200, w: 248, h: 132 };
    expect(freeSpot([], want)).toEqual({ x: 0, y: -200 });
    const moved = freeSpot([{ x: 20, y: -190, w: 248, h: 132 }], want);
    expect(moved.y).toBe(-200);
    expect(Math.abs(moved.x)).toBeGreaterThanOrEqual(248);
  });
});
