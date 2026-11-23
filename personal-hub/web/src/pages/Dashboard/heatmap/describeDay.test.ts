import type { HeatmapDay, SubjectSlice } from '@shared/types.ts';
import { describe, expect, it } from 'vitest';
import { describeDay } from './describeDay.ts';

const H = 3600;
const slice = (subjectId: number | null, name: string, seconds: number): SubjectSlice => ({ subjectId, name, seconds });
const day = (date: string, seconds: number, subjects: SubjectSlice[] = []): HeatmapDay => ({ date, seconds, level: 1, subjects });

describe('describeDay', () => {
  it('names the day, its focus and the subject that took most of it', () => {
    expect(describeDay(day('2026-11-03', 2 * H + 15 * 60, [slice(1, 'Algebra', 1 * H + 40 * 60), slice(2, 'Essay', 35 * 60)]))).toBe(
      'Tue 3 Nov · 2 h 15 m focused · mostly Algebra',
    );
  });

  it('says so plainly when the day has no focus', () => {
    expect(describeDay(day('2026-11-03', 0))).toBe('Tue 3 Nov · no focus');
    // The server can round a day's seconds down to zero while a subject keeps its own.
    expect(describeDay(day('2026-11-03', 0, [slice(1, 'Algebra', 30)]))).toBe('Tue 3 Nov · no focus');
  });

  it('breaks a tie by seconds first, then by name', () => {
    // Equal seconds: the name breaks the tie whatever order the list comes in.
    expect(describeDay(day('2026-11-03', H, [slice(2, 'Algebra', 30 * 60), slice(1, 'Essay', 30 * 60)]))).toBe(
      'Tue 3 Nov · 1 h 0 m focused · mostly Algebra',
    );
    expect(describeDay(day('2026-11-03', H, [slice(1, 'Essay', 30 * 60), slice(2, 'Algebra', 30 * 60)]))).toBe(
      'Tue 3 Nov · 1 h 0 m focused · mostly Algebra',
    );
    // Different names: the name breaks the tie, not the list order.
    expect(describeDay(day('2026-11-03', H, [slice(2, 'Statistics', 30 * 60), slice(1, 'Algebra', 30 * 60)]))).toBe(
      'Tue 3 Nov · 1 h 0 m focused · mostly Algebra',
    );
    // More seconds still wins over a name that sorts first.
    expect(describeDay(day('2026-11-03', H, [slice(1, 'Algebra', 20 * 60), slice(2, 'Statistics', 40 * 60)]))).toBe(
      'Tue 3 Nov · 1 h 0 m focused · mostly Statistics',
    );
  });
});
