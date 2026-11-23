import type { SubjectSlice } from '@shared/types.ts';

// Chart colours. Subjects take a periwinkle lightness ramp (Hallmark data-viz:
// one hue, chroma constant, fixed order). The ramp stops at 38% rather than
// stepping a full 12% each time, so the darkest slice still reads on slate.
const SUBJECT_L = [86, 76, 66, 56, 46, 38];
const MUTED = 'var(--color-muted)';

/** The colour of the subject at `rank` (0 = most time); rank 6 and later are "Other". */
export function subjectColor(rank: number): string {
  const l = SUBJECT_L[rank];
  return l === undefined ? MUTED : `oklch(${l}% 0.10 274)`;
}

/** Heatmap fills by level: empty, then five sage steps (spec §3 allows sage here only). */
export const HEAT_COLORS = [
  'var(--color-paper-3)',
  'oklch(34% 0.04 160)',
  'oklch(46% 0.06 160)',
  'oklch(60% 0.08 160)',
  'oklch(72% 0.09 160)',
  'oklch(82% 0.10 160)',
] as const;

export type SliceGroup = { key: string; name: string; seconds: number; color: string; share: number };

/**
 * Subjects by time, most first, with zero-second slices dropped and rank `max`
 * onwards merged into one muted "Other". Shares are of the total and sum to 1.
 */
export function groupSlices(slices: SubjectSlice[], max = 6): SliceGroup[] {
  const ranked = slices.filter((s) => Number.isFinite(s.seconds) && s.seconds > 0).sort((a, b) => b.seconds - a.seconds);
  const total = ranked.reduce((sum, s) => sum + s.seconds, 0);
  const groups: SliceGroup[] = ranked.slice(0, max).map((s, rank) => ({
    key: `subject-${s.subjectId ?? 'none'}`,
    name: s.name,
    seconds: s.seconds,
    color: subjectColor(rank),
    share: s.seconds / total,
  }));
  const tail = ranked.slice(max).reduce((sum, s) => sum + s.seconds, 0);
  if (tail > 0) groups.push({ key: 'other', name: 'Other', seconds: tail, color: MUTED, share: tail / total });
  return groups;
}
