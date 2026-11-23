import { describe, expect, it } from 'vitest';
import { fitView, layerAt, linkPath, stageCount, stageName, stageTop, STAGE_H, toWorld, yInLayer, zoomAt } from './geometry.ts';

describe('skill canvas geometry', () => {
  it('always keeps one empty stage on top', () => {
    expect(stageCount([])).toBe(1);
    expect(stageCount([{ layer: 0 }])).toBe(2);
    expect(stageCount([{ layer: 0 }, { layer: 2 }])).toBe(4);
  });

  it('stacks stages upward from y = 0 and places a drop in the right one', () => {
    expect(stageTop(0)).toBe(-STAGE_H);
    expect(layerAt(-10, 3)).toBe(0);
    expect(layerAt(-STAGE_H - 10, 3)).toBe(1);
    // Above the top stage, or below the foundations, a drop lands in the nearest stage.
    expect(layerAt(-STAGE_H * 9, 3)).toBe(2);
    expect(layerAt(200, 3)).toBe(0);
  });

  it('keeps a box inside its stage', () => {
    const y = yInLayer(50, 100, 0);
    expect(y).toBeGreaterThanOrEqual(stageTop(0));
    expect(y + 100).toBeLessThanOrEqual(0);
  });

  it('names the stages and invites the empty top one', () => {
    expect(stageName(0, 3)).toBe('Stage 1 · Foundations');
    expect(stageName(2, 3)).toMatch(/^Stage 3 · drag harder work here/);
  });

  it('zooms about the pointer, within limits', () => {
    const view = { tx: 100, ty: 100, k: 1 };
    const zoomed = zoomAt(view, 2, 300, 300);
    // The world point under the pointer stays under it.
    expect(toWorld(zoomed, 300, 300)).toEqual(toWorld(view, 300, 300));
    expect(zoomAt(view, 100, 0, 0).k).toBe(2);
    expect(zoomAt(view, 0.001, 0, 0).k).toBe(0.3);
  });

  it('fits every stage on screen with the foundations at the bottom', () => {
    const v = fitView(3, 1200, 800);
    expect(v.k).toBeLessThanOrEqual(1);
    expect(v.ty).toBeLessThanOrEqual(800);
    expect(toWorld(v, 600, 0).y).toBeLessThanOrEqual(-3 * STAGE_H + 1);
  });

  it('draws a link as one cubic curve between the two boxes', () => {
    const d = linkPath({ x: 0, y: 200, w: 100, h: 50 }, { x: 0, y: 0, w: 100, h: 100 });
    expect(d).toMatch(/^M 50 200 C .* 50 100$/);
  });
});

describe('where a linked experience settles', () => {
  it('goes under its step when the stage has room, else beside it', async () => {
    const { slotFor, stageTop: top, STEP_H: h, STEP_W: w } = await import('./geometry.ts');
    const roomy = { x: 0, y: top(0) + 20, w, h };
    expect(slotFor(roomy, 0, 0)).toEqual({ x: 0, y: roomy.y + h + 28 });
    expect(slotFor(roomy, 1, 0).x).toBeGreaterThan(0);
    const low = { x: 0, y: top(0) + 150, w, h };
    expect(slotFor(low, 0, 0).x).toBe(w + 24);
  });
});

describe('placing a new card', () => {
  it('keeps the spot when it is clear and slides off a card that is in the way', async () => {
    const { freeSpot } = await import('./geometry.ts');
    const want = { x: 0, y: -200, w: 248, h: 132 };
    expect(freeSpot([], want)).toEqual({ x: 0, y: -200 });
    const moved = freeSpot([{ x: 20, y: -190, w: 248, h: 132 }], want);
    expect(moved.y).toBe(-200);
    expect(Math.abs(moved.x)).toBeGreaterThanOrEqual(248);
  });
});
