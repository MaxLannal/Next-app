import { describe, expect, it } from 'vitest';
import {
  addPage,
  COLS,
  DEFAULT_LAYOUT,
  deletePage,
  findPanel,
  hiddenPanels,
  hidePanel,
  MAX_PAGES,
  MIN_H,
  MIN_W,
  normalizeLayout,
  overlaps,
  placePanel,
  renamePage,
  roomy,
  ROWS,
  showPanel,
  type DashboardLayout,
} from '@shared/layout.ts';

const rect = (layout: DashboardLayout, id: Parameters<typeof findPanel>[1]) => {
  const { id: _id, ...r } = findPanel(layout, id)!.rect;
  return r;
};

/** No two panels on any page cover the same cell, and every one is on its page. */
function tidy(layout: DashboardLayout) {
  for (const page of layout.pages) {
    for (const p of page.panels) {
      expect(p.x >= 0 && p.y >= 0 && p.x + p.w <= COLS && p.y + p.h <= ROWS).toBe(true);
      for (const q of page.panels) if (p !== q) expect(overlaps(p, q)).toBe(false);
    }
  }
}

describe('arranging the dashboard by hand', () => {
  it('starts with Today (the clock and agenda over Goals and Focus), Progress and Plans', () => {
    expect(DEFAULT_LAYOUT.pages.map((p) => p.name)).toEqual(['Today', 'Progress', 'Plans']);
    expect(DEFAULT_LAYOUT.pages[0]!.panels.map((p) => p.id)).toEqual(['time', 'agenda', 'goals', 'focus']);
    tidy(DEFAULT_LAYOUT);
  });

  it('puts a panel anywhere on its page; the one it covers takes the nearest free place, here where it left', () => {
    // Year of focus dropped across the top-left of Progress, over the skill tracker.
    const moved = placePanel(DEFAULT_LAYOUT, 'heatmap', 1, { x: 0, y: 0, w: 16, h: 20 });
    expect(rect(moved, 'heatmap')).toEqual({ x: 0, y: 0, w: 16, h: 20 });
    expect(rect(moved, 'skills')).toEqual({ x: 16, y: 0, w: 8, h: 25 });
    // Those it doesn't touch stay put.
    expect(rect(moved, 'sleep')).toEqual({ x: 0, y: 25, w: 12, h: 23 });
    tidy(moved);
  });

  it('leaves a gap where the panel was: nothing flows up to fill it', () => {
    const moved = placePanel(DEFAULT_LAYOUT, 'skills', 1, { x: 0, y: 30, w: 8, h: 12 });
    expect(rect(moved, 'heatmap')).toEqual({ x: 8, y: 0, w: 16, h: 25 });
    tidy(moved);
  });

  it('sizes a panel by its edges, no smaller than a panel can be, and never off the page', () => {
    const page = addPage(DEFAULT_LAYOUT);
    const wide = placePanel(page, 'skills', 3, { x: 0, y: 0, w: 30, h: 60 });
    expect(rect(wide, 'skills')).toEqual({ x: 0, y: 0, w: COLS, h: ROWS });
    const tiny = placePanel(page, 'skills', 3, { x: 22, y: 47, w: 1, h: 1 });
    expect(rect(tiny, 'skills')).toEqual({ x: COLS - MIN_W, y: ROWS - MIN_H, w: MIN_W, h: MIN_H });
    tidy(wide);
    tidy(tiny);
  });

  it('says when a page has no room left for every panel on it', () => {
    expect(roomy(DEFAULT_LAYOUT, 1)).toBe(true);
    // The skill tracker over the whole of Progress: the others have nowhere to go.
    expect(roomy(placePanel(DEFAULT_LAYOUT, 'skills', 1, { x: 0, y: 0, w: COLS, h: ROWS }), 1)).toBe(false);
  });

  it('moves a panel to another page, the clock included', () => {
    const moved = placePanel(DEFAULT_LAYOUT, 'time', 2, { x: 0, y: 0, w: 10, h: 10 });
    expect(findPanel(moved, 'time')!.page).toBe(2);
    expect(moved.pages[0]!.panels.map((p) => p.id)).toEqual(['agenda', 'goals', 'focus']);
    tidy(moved);
  });

  it('shrinks a covered panel into the nearest gap when nothing its size is free', () => {
    // A full-width panel across the middle of Progress leaves only strips above and below.
    const moved = placePanel(DEFAULT_LAYOUT, 'skills', 1, { x: 0, y: 12, w: 24, h: 30 });
    tidy(moved);
    expect(moved.pages[1]!.panels).toHaveLength(4);
  });

  it('hides a panel and puts it back where a good size of it fits', () => {
    const hidden = hidePanel(DEFAULT_LAYOUT, 'sleep');
    expect(hiddenPanels(hidden)).toEqual(['sleep']);
    const back = showPanel(hidden, 'sleep', 1);
    expect(findPanel(back, 'sleep')!.page).toBe(1);
    tidy(back);
  });

  it('adds pages up to the most there can be, and deletes any while one is left, hiding its panels', () => {
    let layout = DEFAULT_LAYOUT;
    for (let i = 0; i < 10; i++) layout = addPage(layout);
    expect(layout.pages).toHaveLength(MAX_PAGES);
    expect(layout.pages[3]).toEqual({ name: 'Page 4', panels: [] });
    const fewer = deletePage(DEFAULT_LAYOUT, 0);
    expect(fewer.pages.map((p) => p.name)).toEqual(['Progress', 'Plans']);
    expect(hiddenPanels(fewer)).toEqual(['time', 'agenda', 'goals', 'focus']);
    const one = { version: 2 as const, pages: [DEFAULT_LAYOUT.pages[0]!] };
    expect(deletePage(one, 0)).toBe(one);
  });

  it('renames a page', () => {
    expect(renamePage(DEFAULT_LAYOUT, 2, 'Week ahead').pages[2]!.name).toBe('Week ahead');
  });

  it('draws the default for anything that is not a layout, and lays out an old ordered one on the grid', () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout({ pages: [] })).toEqual(DEFAULT_LAYOUT);
    const old = normalizeLayout({
      pages: [
        { name: 'Today', panels: [{ id: 'goals', w: 3, h: 1 }, { id: 'focus', w: 3, h: 1 }] },
        { name: 'Progress', panels: [{ id: 'skills', w: 2, h: 1 }, { id: 'heatmap', w: 4, h: 1 }, { id: 'sleep', w: 3, h: 1 }, { id: 'exercise', w: 3, h: 1 }] },
      ],
    });
    expect(old.pages[0]!.panels.map((p) => p.id)).toEqual(['time', 'agenda', 'goals', 'focus']);
    expect(rect(old, 'goals')).toEqual({ x: 0, y: 19, w: 12, h: 29 });
    expect(rect(old, 'heatmap')).toEqual({ x: 8, y: 0, w: 16, h: 24 });
    expect(rect(old, 'exercise')).toEqual({ x: 12, y: 24, w: 12, h: 24 });
    tidy(old);
  });

  it('pushes apart a stored layout whose panels overlap', () => {
    const fixed = normalizeLayout({
      version: 2,
      pages: [{ name: 'A', panels: [{ id: 'goals', x: 0, y: 0, w: 12, h: 12 }, { id: 'focus', x: 4, y: 4, w: 12, h: 12 }, { id: 'goals', x: 0, y: 30, w: 4, h: 4 }] }],
    });
    expect(fixed.pages[0]!.panels).toHaveLength(2);
    tidy(fixed);
  });
});
