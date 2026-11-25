/**
 * The dashboard's layout: its pages, in order, and where each panel sits on its page, arranged by
 * hand in edit mode and kept by the hub, so the app and a browser show the same pages.
 *
 * A page is the whole screen beside the rail, laid on a snap grid of COLS columns by ROWS rows; a
 * panel covers a rectangle of whole cells, anywhere on it, out to the window's edges. Panels don't overlap: one put down on
 * others sends each to the free place nearest where it was (smaller, if only a smaller one fits).
 * Every panel moves, the clock and today's agenda included; a hidden one is on no page.
 */

export const PANEL_IDS = ['time', 'agenda', 'goals', 'focus', 'skills', 'heatmap', 'sleep', 'exercise', 'calendar', 'resources', 'media', 'review'] as const;
export type PanelId = (typeof PANEL_IDS)[number];
/** The time can be on several pages at once: its copies are keyed "time-2" to "time-9". */
export type PanelKey = PanelId | `time-${number}`;
export const COPYABLE: readonly PanelId[] = ['time'];
const COPY_KEY = /^time-[2-9]$/;
/** The panel a key draws: a copy draws the panel it was copied from. */
export const baseOf = (key: PanelKey): PanelId => (COPY_KEY.test(key) ? 'time' : (key as PanelId));

export const COLS = 48;
export const ROWS = 48;
/** The smallest a panel can be made: an eighth of the screen's width and of its height. */
export const MIN_W = 6;
export const MIN_H = 6;

/**
 * Where the panels first sat, and sat in layouts before they could reach the window's edges: a box
 * in the middle of the screen. Those layouts counted 24 columns by 48 rows across that box.
 */
const BOX = { x: 3, y: 9, w: 42, h: 33 };
const BOX_COLS = 24;
const BOX_ROWS = 48;

export type Rect = { x: number; y: number; w: number; h: number };
export type PanelRect = Rect & { id: PanelKey };
export type DashboardPage = { name: string; panels: PanelRect[] };
/** Version 4 knows the review panel; a layout from before it gets the review on its second page. */
export type DashboardLayout = { version: 4; pages: DashboardPage[] };

export const MAX_PAGES = 8;
export const PAGE_NAME_MAX = 40;

export const PANEL_NAMES: Record<PanelId, string> = {
  time: 'Time',
  agenda: 'Today',
  goals: 'Goals',
  focus: 'Focus',
  skills: 'Skill tracker',
  heatmap: 'Year of focus',
  sleep: 'Sleep',
  exercise: 'Push-ups and squats',
  calendar: 'Calendar',
  resources: 'Resources',
  media: 'Now playing',
  review: 'Review',
};

const at = (id: PanelId, x: number, y: number, w: number, h: number): PanelRect => ({ id, x, y, w, h });

/** A rectangle counted across the old box, counted across the screen: the same place on it. */
function fromBox(r: PanelRect): PanelRect {
  const col = (v: number) => BOX.x + Math.round((v * BOX.w) / BOX_COLS);
  const row = (v: number) => BOX.y + Math.round((v * BOX.h) / BOX_ROWS);
  const x = col(r.x);
  const y = row(r.y);
  return { id: r.id, x, y, w: col(r.x + r.w) - x, h: row(r.y + r.h) - y };
}

/** How tall the review comes, in rows: enough for a day's 24 hours to read as a bar. */
const REVIEW_ROWS = 16;
/** Below this the panels above would be squeezed too far to read; the review goes where it fits instead. */
const MIN_SQUEEZE = 0.45;

/**
 * A page with `id` added along its foot, as wide as the panels on it: below them when there's room,
 * else with the panels above shortened in proportion (each keeping its place in the arrangement) to
 * make it. Null when that would squeeze them past reading. Self-contained, so it can lay out the
 * default as the module loads.
 */
function withRoomBelow(panels: PanelRect[], id: PanelKey, rows = REVIEW_ROWS): PanelRect[] | null {
  if (panels.length === 0) return [{ id, x: BOX.x, y: BOX.y, w: BOX.w, h: rows }];
  const top = Math.min(...panels.map((p) => p.y));
  const bottom = Math.max(...panels.map((p) => p.y + p.h));
  const left = Math.min(...panels.map((p) => p.x));
  const right = Math.max(...panels.map((p) => p.x + p.w));
  const band = (y: number): PanelRect => ({ id, x: left, y, w: right - left, h: rows });
  if (bottom + rows <= ROWS) return [...panels, band(bottom)];

  const k = (ROWS - rows - top) / (bottom - top);
  if (k < MIN_SQUEEZE) return null;
  const at = (y: number) => top + Math.round((y - top) * k);
  const squeezed = panels.map((p) => ({ ...p, y: at(p.y), h: Math.max(MIN_H, at(p.y + p.h) - at(p.y)) }));
  const clash = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  if (squeezed.some((p, i) => p.y + p.h > ROWS - rows || squeezed.some((q, j) => i !== j && clash(p, q)))) return null;
  return [...squeezed, band(ROWS - rows)];
}

/**
 * Today, Progress and Plans, as the dashboard first came: in the middle of the screen, the week in
 * review along the foot of Progress.
 */
export const DEFAULT_LAYOUT: DashboardLayout = {
  version: 4,
  pages: [
    { name: 'Today', panels: [at('time', 0, 0, 12, 19), at('agenda', 12, 0, 12, 19), at('goals', 0, 19, 12, 29), at('focus', 12, 19, 12, 29)] },
    { name: 'Progress', panels: [at('skills', 0, 0, 8, 25), at('heatmap', 8, 0, 16, 25), at('sleep', 0, 25, 12, 23), at('exercise', 12, 25, 12, 23)] },
    { name: 'Plans', panels: [at('calendar', 0, 0, 16, 48), at('resources', 16, 0, 8, 30), at('media', 16, 30, 8, 18)] },
  ]
    .map((page) => ({ ...page, panels: page.panels.map(fromBox) }))
    .map((page, i) => (i === 1 ? { ...page, panels: withRoomBelow(page.panels, 'review') ?? page.panels } : page)),
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPanelId = (v: unknown): v is PanelId => typeof v === 'string' && (PANEL_IDS as readonly string[]).includes(v);
const isPanelKey = (v: unknown): v is PanelKey => isPanelId(v) || (typeof v === 'string' && COPY_KEY.test(v));
const int = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A rectangle kept on the page and no smaller than a panel can be. */
export function fitRect(r: Rect): Rect {
  const w = clamp(r.w, MIN_W, COLS);
  const h = clamp(r.h, MIN_H, ROWS);
  return { x: clamp(r.x, 0, COLS - w), y: clamp(r.y, 0, ROWS - h), w, h };
}

const pageName = (v: unknown, index: number) => {
  const name = typeof v === 'string' ? v.trim().slice(0, PAGE_NAME_MAX) : '';
  return name === '' ? `Page ${index + 1}` : name;
};

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The first layouts placed panels in order on six columns, a third to all of the width and one
 * row or two tall; this lays such a page out on the grid the same way. On the first page the
 * clock and agenda, which those layouts always drew on top, take the top again.
 */
function fromFlow(rawPages: unknown[]): DashboardPage[] {
  const seen = new Set<PanelId>(['time', 'agenda']);
  const pages = rawPages.slice(0, MAX_PAGES).map((raw, index): DashboardPage => {
    const page = isRecord(raw) ? raw : {};
    const items: { id: PanelId; w: number; h: number }[] = [];
    for (const p of Array.isArray(page.panels) ? page.panels : []) {
      if (!isRecord(p) || !isPanelId(p.id) || seen.has(p.id)) continue;
      seen.add(p.id);
      items.push({ id: p.id, w: [2, 3, 4, 6].includes(p.w as number) ? (p.w as number) : 3, h: p.h === 2 ? 2 : 1 });
    }
    // Six columns, rows of equal height, each panel at the first place it fits.
    const taken: boolean[][] = [];
    const free = (row: number, col: number, w: number, h: number) => {
      for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) if (taken[r]?.[c]) return false;
      return true;
    };
    const cells = items.map((item) => {
      for (let row = 0; ; row++) {
        for (let col = 0; col + item.w <= 6; col++) {
          if (!free(row, col, item.w, item.h)) continue;
          for (let r = row; r < row + item.h; r++) for (let c = col; c < col + item.w; c++) (taken[r] ??= [])[c] = true;
          return { ...item, row, col };
        }
      }
    });
    const rows = Math.max(1, taken.length);
    const top = index === 0 ? 19 : 0;
    const span = BOX_ROWS - top;
    const edge = (row: number) => top + Math.round((row * span) / rows);
    const placed = cells.map((c) => at(c.id, c.col * 4, edge(c.row), c.w * 4, edge(c.row + c.h) - edge(c.row)));
    if (index === 0) placed.unshift(at('time', 0, 0, 12, 19), at('agenda', 12, 0, 12, 19));
    return { name: pageName(page.name, index), panels: placed };
  });
  return pages;
}

/**
 * Any stored or sent layout made safe to draw: unknown panels and second copies dropped, every
 * panel kept on its page at least the smallest size, overlaps pushed apart, names trimmed (an
 * empty one becomes "Page n"), one page at least and MAX_PAGES at most. Older layouts (panels in
 * order, or placed within the middle box) are laid out on the screen where they were, and any from
 * before the review panel and the day's timeline get the review (withReview) and a taller Today
 * (withTallToday); anything else is the default.
 */
export function normalizeLayout(input: unknown): DashboardLayout {
  if (!isRecord(input) || !Array.isArray(input.pages) || input.pages.length === 0) return structuredClone(DEFAULT_LAYOUT);
  const onScreen = input.version === 3 || input.version === 4;
  const inBox = !onScreen;
  const rawPages: unknown[] = input.version === 2 || onScreen ? input.pages : fromFlow(input.pages);
  const seen = new Set<PanelKey>();
  const pages = rawPages.slice(0, MAX_PAGES).map((raw, index): DashboardPage => {
    const page = isRecord(raw) ? raw : {};
    let panels: PanelRect[] = [];
    for (const p of Array.isArray(page.panels) ? page.panels : []) {
      if (!isRecord(p) || !isPanelKey(p.id) || seen.has(p.id)) continue;
      seen.add(p.id);
      const given = { id: p.id, x: int(p.x, 0), y: int(p.y, 0), w: int(p.w, 12), h: int(p.h, 20) };
      const rect = fitRect(inBox ? fromBox(given) : given);
      panels = settle([...panels, { id: p.id, ...rect }], p.id);
    }
    return { name: pageName(page.name, index), panels };
  });
  const layout: DashboardLayout = { version: 4, pages };
  return input.version === 4 ? layout : withTallToday(withReview(layout));
}

/**
 * A layout from before the review panel, with the review put on its second page (its only page,
 * if it has one): along the foot, the panels there shortened to make room, or where a good size
 * of it fits when they can't be. A layout that already has it, or hid it since, is left alone.
 */
export function withReview(layout: DashboardLayout): DashboardLayout {
  if (findPanel(layout, 'review')) return layout;
  const page = Math.min(1, layout.pages.length - 1);
  const panels = withRoomBelow(layout.pages[page]!.panels, 'review');
  if (!panels) return showPanel(layout, 'review', page);
  return { version: 4, pages: layout.pages.map((p, i) => (i === page ? { ...p, panels } : p)) };
}

/** How tall today's timeline grows, in rows, when a layout from before it has the room. */
const TIMELINE_ROWS = 20;

/**
 * Today's agenda became a timeline of the day, which wants height: in a layout from before it, the
 * panel grows to TIMELINE_ROWS into the free rows right below it, then above it. Nothing else moves.
 */
export function withTallToday(layout: DashboardLayout): DashboardLayout {
  const found = findPanel(layout, 'agenda');
  if (!found || found.rect.h >= TIMELINE_ROWS) return layout;
  const others = layout.pages[found.page]!.panels.filter((p) => p.id !== 'agenda');
  const r = { ...found.rect };
  const free = (y: number) => y >= 0 && y < ROWS && !others.some((p) => overlaps(p, { x: r.x, y, w: r.w, h: 1 }));
  while (r.h < TIMELINE_ROWS && free(r.y + r.h)) r.h += 1;
  while (r.h < TIMELINE_ROWS && free(r.y - 1)) {
    r.y -= 1;
    r.h += 1;
  }
  const page = found.page;
  return { version: 4, pages: layout.pages.map((p, i) => (i === page ? { ...p, panels: p.panels.map((x) => (x.id === 'agenda' ? r : x)) } : p)) };
}

/** The first place on a page a w×h panel fits without touching another, top to bottom, left to right. */
export function freeSpot(panels: Rect[], w: number, h: number): { x: number; y: number } | null {
  for (let y = 0; y + h <= ROWS; y++) {
    for (let x = 0; x + w <= COLS; x++) {
      const r = { x, y, w, h };
      if (!panels.some((p) => overlaps(p, r))) return { x, y };
    }
  }
  return null;
}

/** Rows are much shorter than columns are wide; distances are weighed as they look on screen. */
const COL_IN_ROWS = 3.5;

/**
 * Where a panel that has to move goes: the free place nearest where it was, at its size; failing
 * that, at a smaller size, down to the smallest a panel can be; failing even that, where it was.
 */
function nearestFit(placed: Rect[], p: PanelRect): PanelRect {
  for (const [fw, fh] of [
    [1, 1],
    [1, 0.75],
    [0.75, 0.75],
    [0.5, 0.75],
    [0.5, 0.5],
    [0, 0],
  ] as const) {
    const w = Math.max(MIN_W, Math.round(p.w * fw));
    const h = Math.max(MIN_H, Math.round(p.h * fh));
    let best: PanelRect | null = null;
    let far = Infinity;
    for (let y = 0; y + h <= ROWS; y++) {
      for (let x = 0; x + w <= COLS; x++) {
        const r = { x, y, w, h };
        if (placed.some((q) => overlaps(q, r))) continue;
        const d = ((x - p.x) * COL_IN_ROWS) ** 2 + (y - p.y) ** 2;
        if (d < far) {
          far = d;
          best = { id: p.id, ...r };
        }
      }
    }
    if (best) return best;
  }
  return p;
}

/**
 * The page with `id` held where it is and the panels it covers moved out of its way, each to the
 * free place nearest where it was (where it left, on a full page: the two trade places). The
 * panels it doesn't touch stay put.
 */
export function settle(panels: PanelRect[], id: PanelKey): PanelRect[] {
  const held = panels.find((p) => p.id === id);
  if (!held) return panels;
  const others = panels.filter((p) => p.id !== id);
  const placed: PanelRect[] = [held, ...others.filter((p) => !overlaps(p, held))];
  const moved = new Map<PanelKey, PanelRect>();
  for (const p of others.filter((q) => overlaps(q, held)).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const r = nearestFit(placed, p);
    placed.push(r);
    moved.set(p.id, r);
  }
  return panels.map((p) => moved.get(p.id) ?? p);
}

/** Whether every panel on a page has a place of its own: no two overlap. */
export function roomy(layout: DashboardLayout, page: number): boolean {
  const panels = layout.pages[page]?.panels ?? [];
  return panels.every((p, i) => panels.every((q, j) => i === j || !overlaps(p, q)));
}

/** The panels on no page: kept aside in edit mode, to be put back. */
export function hiddenPanels(layout: DashboardLayout): PanelId[] {
  const shown = new Set(layout.pages.flatMap((p) => p.panels.map((x) => x.id)));
  return PANEL_IDS.filter((id) => !shown.has(id));
}

/** Where a panel is: its page and its rectangle, or null when it's hidden. */
export function findPanel(layout: DashboardLayout, id: PanelKey): { page: number; rect: PanelRect } | null {
  for (let page = 0; page < layout.pages.length; page++) {
    const rect = layout.pages[page]!.panels.find((p) => p.id === id);
    if (rect) return { page, rect };
  }
  return null;
}

const without = (layout: DashboardLayout, id: PanelKey) => layout.pages.map((p) => ({ ...p, panels: p.panels.filter((x) => x.id !== id) }));

/**
 * Puts a panel at `rect` on `page`, from wherever it was (another page, or hidden), and moves the
 * panels there out of its way. Moving or resizing in place is the same call.
 */
export function placePanel(layout: DashboardLayout, id: PanelKey, page: number, rect: Rect): DashboardLayout {
  if (page < 0 || page >= layout.pages.length) return layout;
  const pages = without(layout, id);
  const target = pages[page]!;
  target.panels = settle([...target.panels, { id, ...fitRect(rect) }], id);
  return { version: 4, pages };
}

/** Puts a panel on `page` in the first place it fits at the first of `sizes` that does. */
function putWhereItFits(layout: DashboardLayout, id: PanelKey, page: number, sizes: (readonly [number, number])[]): DashboardLayout {
  const panels = (layout.pages[page]?.panels ?? []).filter((p) => p.id !== id);
  for (const [w, h] of sizes) {
    const spot = freeSpot(panels, w, h);
    if (spot) return placePanel(layout, id, page, { ...spot, w, h });
  }
  const [w, h] = sizes[0]!;
  return placePanel(layout, id, page, { x: BOX.x, y: BOX.y, w, h });
}

const GOOD_SIZES = [
  [21, 16],
  [14, 12],
  [10, 9],
  [MIN_W, MIN_H],
] as const;

/** Puts a hidden panel back on `page`, in the first place a good size of it fits. */
export function showPanel(layout: DashboardLayout, id: PanelId, page: number): DashboardLayout {
  return putWhereItFits(layout, id, page, [...GOOD_SIZES]);
}

/**
 * A copy of a panel that can be on several pages (the time), put on `page` at the original's size
 * where that fits, or smaller; none past the last copy there can be.
 */
export function copyPanel(layout: DashboardLayout, id: PanelKey, page: number): DashboardLayout {
  const from = findPanel(layout, id);
  if (!from || !COPYABLE.includes(baseOf(id)) || page < 0 || page >= layout.pages.length) return layout;
  const taken = new Set(layout.pages.flatMap((p) => p.panels.map((x) => x.id)));
  const key = [2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${baseOf(id)}-${n}` as PanelKey).find((k) => !taken.has(k));
  if (!key) return layout;
  return putWhereItFits(layout, key, page, [[from.rect.w, from.rect.h], ...GOOD_SIZES]);
}

/** Takes a panel off its page; it waits among the hidden ones (a copy is simply gone). */
export function hidePanel(layout: DashboardLayout, id: PanelKey): DashboardLayout {
  return { version: 4, pages: without(layout, id) };
}

/** A new empty page at the end, named for its place; none past MAX_PAGES. */
export function addPage(layout: DashboardLayout): DashboardLayout {
  if (layout.pages.length >= MAX_PAGES) return layout;
  return { version: 4, pages: [...layout.pages, { name: `Page ${layout.pages.length + 1}`, panels: [] }] };
}

/** Removes a page; its panels go to the hidden ones. There is always one page left. */
export function deletePage(layout: DashboardLayout, page: number): DashboardLayout {
  if (layout.pages.length <= 1 || page < 0 || page >= layout.pages.length) return layout;
  return { version: 4, pages: layout.pages.filter((_, i) => i !== page) };
}

export function renamePage(layout: DashboardLayout, page: number, name: string): DashboardLayout {
  return { version: 4, pages: layout.pages.map((p, i) => (i === page ? { ...p, name: name.slice(0, PAGE_NAME_MAX) } : p)) };
}
