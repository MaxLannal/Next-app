import type { HeatmapDay } from '@shared/types.ts';
import { formatDuration, formatShortDate } from '../../../lib/format.ts';

const compare = new Intl.Collator('en').compare;

/**
 * The subject that took most of a day; equal seconds go to the first name
 * alphabetically, so the answer never depends on the order of the list.
 */
function dominant(day: HeatmapDay) {
  let best: HeatmapDay['subjects'][number] | null = null;
  for (const s of day.subjects) {
    if (!(s.seconds > 0)) continue;
    if (best === null || s.seconds > best.seconds || (s.seconds === best.seconds && compare(s.name, best.name) < 0)) best = s;
  }
  return best;
}

/** One line per heatmap day: `"Tue 3 Nov · 2 h 15 m focused · mostly Algebra"`, or `"Tue 3 Nov · no focus"`. */
export function describeDay(day: HeatmapDay): string {
  const when = formatShortDate(day.date);
  if (!(day.seconds > 0)) return `${when} · no focus`;
  const mostly = dominant(day);
  const focused = `${when} · ${formatDuration(day.seconds)} focused`;
  return mostly === null ? focused : `${focused} · mostly ${mostly.name}`;
}
