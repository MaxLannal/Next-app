/**
 * The dashboard's layout: its pages, in order, and the panels on each, in order, with the share of
 * the page each takes. Edited by hand on the dashboard (edit mode) and kept by the hub, so the app
 * and a browser show the same pages. The clock and today's agenda always head the first page.
 */

export const PANEL_IDS = ['goals', 'focus', 'skills', 'heatmap', 'sleep', 'exercise', 'calendar', 'resources', 'media'] as const;
export type PanelId = (typeof PANEL_IDS)[number];

/** How wide a panel is, in sixths of the page: a third, a half, two thirds, or all of it. */
export const PANEL_WIDTHS = [2, 3, 4, 6] as const;
export type PanelWidth = (typeof PANEL_WIDTHS)[number];
/** How tall: one row of the page, or two. */
export type PanelHeight = 1 | 2;

export type PanelPlace = { id: PanelId; w: PanelWidth; h: PanelHeight };
export type DashboardPage = { name: string; panels: PanelPlace[] };
export type DashboardLayout = { pages: DashboardPage[] };

export const MAX_PAGES = 8;
export const PAGE_NAME_MAX = 40;

export const PANEL_NAMES: Record<PanelId, string> = {
  goals: 'Goals',
  focus: 'Focus',
  skills: 'Skill tracker',
  heatmap: 'Year of focus',
  sleep: 'Sleep',
  exercise: 'Push-ups and squats',
  calendar: 'Calendar',
  resources: 'Resources',
  media: 'Now playing',
};

function place(id: PanelId, w: PanelWidth, h: PanelHeight = 1): PanelPlace {
  return { id, w, h };
}

/** Today, Progress and Plans, as the dashboard first came. */
export const DEFAULT_LAYOUT: DashboardLayout = {
  pages: [
    { name: 'Today', panels: [place('goals', 3), place('focus', 3)] },
    { name: 'Progress', panels: [place('skills', 2), place('heatmap', 4), place('sleep', 3), place('exercise', 3)] },
    { name: 'Plans', panels: [place('calendar', 4, 2), place('resources', 2), place('media', 2)] },
  ],
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPanelId = (v: unknown): v is PanelId => typeof v === 'string' && (PANEL_IDS as readonly string[]).includes(v);
const isWidth = (v: unknown): v is PanelWidth => typeof v === 'number' && (PANEL_WIDTHS as readonly number[]).includes(v);

const pageName = (v: unknown, index: number) => {
  const name = typeof v === 'string' ? v.trim().slice(0, PAGE_NAME_MAX) : '';
  return name === '' ? `Page ${index + 1}` : name;
};

/**
 * Any stored or sent layout made safe to draw: unknown panels and second copies dropped, sizes
 * kept to the ones there are, names trimmed (an empty one becomes "Page n"), and at least one
 * page, at most MAX_PAGES. Anything that isn't a layout at all is the default.
 */
export function normalizeLayout(input: unknown): DashboardLayout {
  if (!isRecord(input) || !Array.isArray(input.pages) || input.pages.length === 0) return structuredClone(DEFAULT_LAYOUT);
  const seen = new Set<PanelId>();
  const pages = input.pages.slice(0, MAX_PAGES).map((raw, index): DashboardPage => {
    const page = isRecord(raw) ? raw : {};
    const panels: PanelPlace[] = [];
    for (const p of Array.isArray(page.panels) ? page.panels : []) {
      if (!isRecord(p) || !isPanelId(p.id) || seen.has(p.id)) continue;
      seen.add(p.id);
      panels.push({ id: p.id, w: isWidth(p.w) ? p.w : 3, h: p.h === 2 ? 2 : 1 });
    }
    return { name: pageName(page.name, index), panels };
  });
  return { pages };
}

/** The panels on no page: kept aside in edit mode, to be put back. */
export function hiddenPanels(layout: DashboardLayout): PanelId[] {
  const shown = new Set(layout.pages.flatMap((p) => p.panels.map((x) => x.id)));
  return PANEL_IDS.filter((id) => !shown.has(id));
}

/** Where a panel is: its page and its place on it, or null when it's hidden. */
export function findPanel(layout: DashboardLayout, id: PanelId): { page: number; index: number } | null {
  for (let page = 0; page < layout.pages.length; page++) {
    const index = layout.pages[page]!.panels.findIndex((p) => p.id === id);
    if (index >= 0) return { page, index };
  }
  return null;
}

const withPages = (pages: DashboardPage[]): DashboardLayout => ({ pages });
const without = (layout: DashboardLayout, id: PanelId) => layout.pages.map((p) => ({ ...p, panels: p.panels.filter((x) => x.id !== id) }));

/**
 * Puts a panel on `page` before the panel now at `index` (at the end when past them), from
 * wherever it was, hidden included. Places are counted as they are before it leaves.
 */
export function movePanel(layout: DashboardLayout, id: PanelId, page: number, index: number): DashboardLayout {
  if (page < 0 || page >= layout.pages.length) return layout;
  const from = findPanel(layout, id);
  const moving = from ? layout.pages[from.page]!.panels[from.index]! : place(id, 3);
  const at = from && from.page === page && from.index < index ? index - 1 : index;
  const pages = without(layout, id);
  const target = pages[page]!.panels;
  target.splice(Math.max(0, Math.min(at, target.length)), 0, moving);
  return withPages(pages);
}

/** Takes a panel off its page; it waits among the hidden ones. */
export function hidePanel(layout: DashboardLayout, id: PanelId): DashboardLayout {
  return withPages(without(layout, id));
}

/** A panel one size wider or narrower (`step` ±1), or one row or two tall. */
export function resizePanel(layout: DashboardLayout, id: PanelId, change: { step?: -1 | 1; h?: PanelHeight }): DashboardLayout {
  return withPages(
    layout.pages.map((p) => ({
      ...p,
      panels: p.panels.map((x) => {
        if (x.id !== id) return x;
        const at = PANEL_WIDTHS.indexOf(x.w) + (change.step ?? 0);
        const w = PANEL_WIDTHS[Math.max(0, Math.min(PANEL_WIDTHS.length - 1, at))]!;
        return { ...x, w, h: change.h ?? x.h };
      }),
    })),
  );
}

/** A new empty page at the end, named for its place; none past MAX_PAGES. */
export function addPage(layout: DashboardLayout): DashboardLayout {
  if (layout.pages.length >= MAX_PAGES) return layout;
  return withPages([...layout.pages, { name: `Page ${layout.pages.length + 1}`, panels: [] }]);
}

/** Removes a page; its panels go to the hidden ones. The first page, with the clock, stays. */
export function deletePage(layout: DashboardLayout, page: number): DashboardLayout {
  if (page <= 0 || page >= layout.pages.length) return layout;
  return withPages(layout.pages.filter((_, i) => i !== page));
}

export function renamePage(layout: DashboardLayout, page: number, name: string): DashboardLayout {
  return withPages(layout.pages.map((p, i) => (i === page ? { ...p, name: name.slice(0, PAGE_NAME_MAX) } : p)));
}
