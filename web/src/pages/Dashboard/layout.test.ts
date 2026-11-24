import { describe, expect, it } from 'vitest';
import {
  addPage,
  DEFAULT_LAYOUT,
  deletePage,
  hiddenPanels,
  hidePanel,
  MAX_PAGES,
  movePanel,
  normalizeLayout,
  renamePage,
  resizePanel,
  type DashboardLayout,
} from '@shared/layout.ts';

const ids = (layout: DashboardLayout) => layout.pages.map((p) => p.panels.map((x) => x.id));

describe('editing the dashboard layout', () => {
  it('moves a panel within its page, before the one it was dropped on', () => {
    // Progress: skills, heatmap, sleep, exercise.
    expect(ids(movePanel(DEFAULT_LAYOUT, 'exercise', 1, 0))[1]).toEqual(['exercise', 'skills', 'heatmap', 'sleep']);
    expect(ids(movePanel(DEFAULT_LAYOUT, 'skills', 1, 3))[1]).toEqual(['heatmap', 'sleep', 'skills', 'exercise']);
    expect(ids(movePanel(DEFAULT_LAYOUT, 'skills', 1, 99))[1]).toEqual(['heatmap', 'sleep', 'exercise', 'skills']);
  });

  it('moves a panel to another page, keeping its size', () => {
    const moved = movePanel(DEFAULT_LAYOUT, 'calendar', 0, 1);
    expect(ids(moved)[0]).toEqual(['goals', 'calendar', 'focus']);
    expect(ids(moved)[2]).toEqual(['resources', 'media']);
    expect(moved.pages[0]!.panels[1]).toEqual({ id: 'calendar', w: 4, h: 2 });
  });

  it('hides a panel and puts it back', () => {
    const hidden = hidePanel(DEFAULT_LAYOUT, 'sleep');
    expect(hiddenPanels(hidden)).toEqual(['sleep']);
    const back = movePanel(hidden, 'sleep', 2, 99);
    expect(hiddenPanels(back)).toEqual([]);
    expect(ids(back)[2]).toEqual(['calendar', 'resources', 'media', 'sleep']);
  });

  it('sizes a panel through a third, a half, two thirds and all of the page, and one row or two', () => {
    let layout = DEFAULT_LAYOUT;
    const width = () => layout.pages[1]!.panels.find((p) => p.id === 'skills')!.w;
    layout = resizePanel(layout, 'skills', { step: -1 });
    expect(width()).toBe(2);
    for (const w of [3, 4, 6, 6]) {
      layout = resizePanel(layout, 'skills', { step: 1 });
      expect(width()).toBe(w);
    }
    layout = resizePanel(layout, 'skills', { h: 2 });
    expect(layout.pages[1]!.panels[0]).toEqual({ id: 'skills', w: 6, h: 2 });
  });

  it('adds pages up to the most there can be, and deletes any but the first, hiding its panels', () => {
    let layout = DEFAULT_LAYOUT;
    for (let i = 0; i < 10; i++) layout = addPage(layout);
    expect(layout.pages).toHaveLength(MAX_PAGES);
    expect(layout.pages[3]).toEqual({ name: 'Page 4', panels: [] });

    const fewer = deletePage(DEFAULT_LAYOUT, 1);
    expect(fewer.pages.map((p) => p.name)).toEqual(['Today', 'Plans']);
    expect(hiddenPanels(fewer)).toEqual(['skills', 'heatmap', 'sleep', 'exercise']);
    expect(deletePage(DEFAULT_LAYOUT, 0)).toBe(DEFAULT_LAYOUT);
  });

  it('renames a page', () => {
    expect(renamePage(DEFAULT_LAYOUT, 2, 'Week ahead').pages[2]!.name).toBe('Week ahead');
  });

  it('leaves the default untouched', () => {
    movePanel(DEFAULT_LAYOUT, 'goals', 2, 0);
    resizePanel(DEFAULT_LAYOUT, 'goals', { step: 1 });
    expect(normalizeLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT);
    expect(ids(DEFAULT_LAYOUT)[0]).toEqual(['goals', 'focus']);
  });

  it('draws the default for anything that is not a layout', () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout({ pages: [] })).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout('pages')).toEqual(DEFAULT_LAYOUT);
  });
});
