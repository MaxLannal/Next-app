import { describe, expect, it } from 'vitest';
import {
  addPage,
  baseOf,
  COLS,
  copyPanel,
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
  withReview,
  withTallToday,
  type DashboardLayout,
} from '@shared/layout.ts';

/** The three pages as they first came, before the review panel: the arranging below was worked out on them. */
const FIRST: DashboardLayout = {
  version: 4,
  pages: [
    { name: 'Today', panels: [{ id: 'time', x: 3, y: 9, w: 21, h: 13 }, { id: 'agenda', x: 24, y: 9, w: 21, h: 13 }, { id: 'goals', x: 3, y: 22, w: 21, h: 20 }, { id: 'focus', x: 24, y: 22, w: 21, h: 20 }] },
    { name: 'Progress', panels: [{ id: 'skills', x: 3, y: 9, w: 14, h: 17 }, { id: 'heatmap', x: 17, y: 9, w: 28, h: 17 }, { id: 'sleep', x: 3, y: 26, w: 21, h: 16 }, { id: 'exercise', x: 24, y: 26, w: 21, h: 16 }] },
    { name: 'Plans', panels: [{ id: 'calendar', x: 3, y: 9, w: 28, h: 33 }, { id: 'resources', x: 31, y: 9, w: 14, h: 21 }, { id: 'media', x: 31, y: 30, w: 14, h: 12 }] },
  ],
};

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
  it('starts with Today (the clock and agenda over Goals and Focus), Progress (the review along its foot) and Plans', () => {
    expect(DEFAULT_LAYOUT.pages.map((p) => p.name)).toEqual(['Today', 'Progress', 'Plans']);
    expect(DEFAULT_LAYOUT.pages[0]!.panels.map((p) => p.id)).toEqual(['time', 'agenda', 'goals', 'focus']);
    expect(DEFAULT_LAYOUT.pages[1]!.panels.map((p) => p.id)).toEqual(['skills', 'heatmap', 'sleep', 'exercise', 'review']);
    expect(rect(DEFAULT_LAYOUT, 'review')).toEqual({ x: 3, y: 32, w: 42, h: 16 });
    expect(hiddenPanels(DEFAULT_LAYOUT)).toEqual([]);
    tidy(DEFAULT_LAYOUT);
  });

  it('puts a panel anywhere on its page; the one it covers takes the nearest free place, here where it left', () => {
    // Year of focus dropped across the top-left of Progress, over the skill tracker.
    const moved = placePanel(FIRST, 'heatmap', 1, { x: 3, y: 9, w: 28, h: 14 });
    expect(rect(moved, 'heatmap')).toEqual({ x: 3, y: 9, w: 28, h: 14 });
    expect(rect(moved, 'skills')).toEqual({ x: 31, y: 9, w: 14, h: 17 });
    // Those it doesn't touch stay put.
    expect(rect(moved, 'sleep')).toEqual({ x: 3, y: 26, w: 21, h: 16 });
    tidy(moved);
  });

  it('leaves a gap where the panel was: nothing flows up to fill it', () => {
    const moved = placePanel(FIRST, 'skills', 1, { x: 3, y: 30, w: 14, h: 8 });
    expect(rect(moved, 'heatmap')).toEqual({ x: 17, y: 9, w: 28, h: 17 });
    tidy(moved);
  });

  it('sizes a panel by its edges, no smaller than a panel can be, and never off the page', () => {
    const page = addPage(DEFAULT_LAYOUT);
    const wide = placePanel(page, 'skills', 3, { x: 0, y: 0, w: 99, h: 99 });
    expect(rect(wide, 'skills')).toEqual({ x: 0, y: 0, w: COLS, h: ROWS });
    const tiny = placePanel(page, 'skills', 3, { x: 46, y: 47, w: 1, h: 1 });
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
    const moved = placePanel(FIRST, 'skills', 1, { x: 0, y: 15, w: 48, h: 25 });
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
    const one = { version: 4 as const, pages: [DEFAULT_LAYOUT.pages[0]!] };
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
    expect(rect(old, 'goals')).toEqual({ x: 3, y: 22, w: 21, h: 20 });
    // Laid out as before (heatmap at 17, 9, 28 × 17; exercise at 24, 26, 21 × 16), then shortened
    // in proportion for the review along the foot, and Today grown up into the rows free above it.
    expect(rect(old, 'heatmap')).toEqual({ x: 17, y: 9, w: 28, h: 12 });
    expect(rect(old, 'exercise')).toEqual({ x: 24, y: 21, w: 21, h: 11 });
    expect(rect(old, 'review')).toEqual({ x: 3, y: 32, w: 42, h: 16 });
    expect(rect(old, 'agenda')).toEqual({ x: 24, y: 2, w: 21, h: 20 });
    tidy(old);
  });

  it('keeps a layout arranged within the middle box where it was, now that panels reach the edges', () => {
    const before = normalizeLayout({
      version: 2,
      pages: [{ name: 'Progress', panels: [{ id: 'heatmap', x: 0, y: 0, w: 16, h: 24 }, { id: 'skills', x: 16, y: 0, w: 8, h: 24 }, { id: 'sleep', x: 0, y: 24, w: 12, h: 24 }] }],
    });
    // Across, where they were; down, shortened for the review its only page now carries.
    expect(rect(before, 'heatmap')).toEqual({ x: 3, y: 9, w: 28, h: 12 });
    expect(rect(before, 'skills')).toEqual({ x: 31, y: 9, w: 14, h: 12 });
    expect(rect(before, 'sleep')).toEqual({ x: 3, y: 21, w: 21, h: 11 });
    expect(rect(before, 'review')).toEqual({ x: 3, y: 32, w: 42, h: 16 });
  });

  it('gives a layout from before the review its review, along the foot of the second page', () => {
    // As the hub kept it: Progress full from row 6 to row 43.
    const kept = {
      version: 3,
      pages: [
        { name: 'Today', panels: [{ id: 'focus', x: 24, y: 26, w: 21, h: 15 }, { id: 'goals', x: 5, y: 17, w: 19, h: 15 }, { id: 'agenda', x: 24, y: 13, w: 15, h: 10 }, { id: 'time', x: 10, y: 2, w: 14, h: 14 }] },
        { name: 'Progress', panels: [{ id: 'skills', x: 34, y: 6, w: 11, h: 16 }, { id: 'sleep', x: 2, y: 6, w: 32, h: 16 }, { id: 'exercise', x: 2, y: 22, w: 14, h: 21 }, { id: 'heatmap', x: 16, y: 22, w: 29, h: 21 }] },
        { name: 'Plans', panels: [{ id: 'calendar', x: 2, y: 9, w: 28, h: 33 }, { id: 'resources', x: 30, y: 9, w: 14, h: 33 }] },
      ],
    };
    const now = normalizeLayout(kept);
    expect(now.version).toBe(4);
    // The four keep their arrangement, shortened in proportion; the review runs as wide as they do.
    expect(rect(now, 'sleep')).toEqual({ x: 2, y: 6, w: 32, h: 11 });
    expect(rect(now, 'skills')).toEqual({ x: 34, y: 6, w: 11, h: 11 });
    expect(rect(now, 'exercise')).toEqual({ x: 2, y: 17, w: 14, h: 15 });
    expect(rect(now, 'heatmap')).toEqual({ x: 16, y: 17, w: 29, h: 15 });
    expect(rect(now, 'review')).toEqual({ x: 2, y: 32, w: 43, h: 16 });
    // Today, now the day's timeline, grows down to Focus and then up, to 20 rows; nothing else moves.
    expect(rect(now, 'agenda')).toEqual({ x: 24, y: 6, w: 15, h: 20 });
    expect(rect(now, 'time')).toEqual({ x: 10, y: 2, w: 14, h: 14 });
    expect(now.pages[2]).toEqual(kept.pages[2]);
    tidy(now);
    // Read back, it stays as it is.
    expect(normalizeLayout(JSON.parse(JSON.stringify(now)))).toEqual(now);
  });

  it('leaves a review hidden by hand hidden, and puts it where it fits when a page can’t make room', () => {
    const hidden = hidePanel(DEFAULT_LAYOUT, 'review');
    expect(normalizeLayout(JSON.parse(JSON.stringify(hidden)))).toEqual(hidden);
    expect(hiddenPanels(hidden)).toEqual(['review']);
    // A panel low on the page would have to shrink past reading: the review takes a good size where one fits.
    const low = { version: 4 as const, pages: [{ name: 'One', panels: [] }, { name: 'Two', panels: [{ id: 'sleep' as const, x: 0, y: 20, w: 24, h: 28 }] }] };
    const placed = withReview(low);
    expect(rect(placed, 'review')).toEqual({ x: 0, y: 0, w: 21, h: 16 });
    expect(rect(placed, 'sleep')).toEqual({ x: 0, y: 20, w: 24, h: 28 });
    tidy(placed);
    // With room below the panels, it goes right under them, as wide, and nothing moves.
    const spacious = { version: 4 as const, pages: [{ name: 'One', panels: [] }, { name: 'Two', panels: [{ id: 'sleep' as const, x: 4, y: 2, w: 30, h: 20 }] }] };
    expect(rect(withReview(spacious), 'review')).toEqual({ x: 4, y: 22, w: 30, h: 16 });
  });

  it('grows Today only into rows free across its width', () => {
    const boxed = { version: 4 as const, pages: [{ name: 'Today', panels: [{ id: 'time' as const, x: 0, y: 0, w: 48, h: 10 }, { id: 'agenda' as const, x: 10, y: 10, w: 20, h: 8 }, { id: 'focus' as const, x: 0, y: 22, w: 48, h: 20 }] }] };
    expect(rect(withTallToday(boxed), 'agenda')).toEqual({ x: 10, y: 10, w: 20, h: 12 });
    expect(withTallToday(DEFAULT_LAYOUT)).toEqual(withTallToday(withTallToday(DEFAULT_LAYOUT)));
  });

  it('starts in the middle of the screen, with room around it to move into', () => {
    const all = DEFAULT_LAYOUT.pages.flatMap((p) => p.panels);
    expect(Math.min(...all.map((p) => p.x))).toBe(3);
    expect(Math.max(...all.map((p) => p.x + p.w))).toBe(45);
    expect(Math.min(...all.map((p) => p.y))).toBe(9);
    // The review runs along the foot of Progress, out to the screen's edge.
    expect(Math.max(...all.filter((p) => p.id !== 'review').map((p) => p.y + p.h))).toBe(42);
    expect(Math.max(...all.map((p) => p.y + p.h))).toBe(ROWS);
    const corner = placePanel(DEFAULT_LAYOUT, 'skills', 1, { x: 0, y: 0, w: 10, h: 8 });
    expect(rect(corner, 'skills')).toEqual({ x: 0, y: 0, w: 10, h: 8 });
  });

  it('pushes apart a stored layout whose panels overlap', () => {
    const fixed = normalizeLayout({
      version: 4,
      pages: [{ name: 'A', panels: [{ id: 'goals', x: 0, y: 0, w: 12, h: 12 }, { id: 'focus', x: 4, y: 4, w: 12, h: 12 }, { id: 'goals', x: 0, y: 30, w: 4, h: 4 }] }],
    });
    expect(fixed.pages[0]!.panels).toHaveLength(2);
    tidy(fixed);
  });

  it('copies the time onto other pages, each copy its own panel, and a copy removed is gone', () => {
    let layout = copyPanel(DEFAULT_LAYOUT, 'time', 1);
    layout = copyPanel(layout, 'time', 2);
    expect(findPanel(layout, 'time-2')!.page).toBe(1);
    expect(findPanel(layout, 'time-3')!.page).toBe(2);
    expect(baseOf('time-3')).toBe('time');
    expect(findPanel(layout, 'time')!.page).toBe(0);
    tidy(layout);
    // The copies survive being stored and read back.
    expect(normalizeLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
    const fewer = hidePanel(layout, 'time-2');
    expect(findPanel(fewer, 'time-2')).toBeNull();
    expect(hiddenPanels(fewer)).toEqual([]);
    // Only the time copies.
    expect(copyPanel(DEFAULT_LAYOUT, 'goals', 1)).toBe(DEFAULT_LAYOUT);
  });
});
