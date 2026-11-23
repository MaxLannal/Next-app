/** `items` with the one at `from` moved to `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...items];
  next.splice(to, 0, moved);
  return next;
}

/**
 * Where a dragged row lands: the number of other rows whose middle it has passed. `mids` are the
 * rows' middles as laid out before the drag, `from` the dragged row and `centre` its middle now.
 */
export function dropIndex(mids: readonly number[], from: number, centre: number): number {
  let to = 0;
  mids.forEach((mid, i) => {
    if (i !== from && mid < centre) to++;
  });
  return to;
}

/** How far a row at `index` slides to make room while the row at `from` hovers over `to`. */
export function shiftFor(index: number, from: number, to: number, height: number): number {
  if (from < to && index > from && index <= to) return -height;
  if (to < from && index >= to && index < from) return height;
  return 0;
}

/** How far the dragged row travels to sit in its new slot: the heights of the rows it passed. */
export function slotOffset(heights: readonly number[], from: number, to: number): number {
  let offset = 0;
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) if (i !== from) offset += heights[i] ?? 0;
  return to > from ? offset : to < from ? -offset : 0;
}
