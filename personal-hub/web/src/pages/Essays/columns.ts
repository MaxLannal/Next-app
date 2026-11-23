import type { EssayColumn } from '@shared/types.ts';

/** The columns in page order, with their Dusk sentence-case labels. */
export const ESSAY_COLUMNS: readonly EssayColumn[] = ['meditations', 'plans', 'insights'];

export const ESSAY_COLUMN_LABELS: Record<EssayColumn, string> = {
  meditations: 'Personal meditations',
  plans: 'Plans',
  insights: 'Insights',
};
