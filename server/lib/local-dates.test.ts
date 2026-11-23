import { describe, expect, it } from 'vitest';
import { parseShortcutDate } from './local-dates.ts';

const TZ = 'America/Chicago';
const iso = (s: string) => parseShortcutDate(s, TZ)?.toISOString() ?? null;

describe('parseShortcutDate', () => {
  it('reads ISO instants with an offset or Z as they are', () => {
    expect(iso('2026-11-22T05:40:00-06:00')).toBe('2026-11-22T11:40:00.000Z');
    expect(iso('2026-11-22T11:40:00Z')).toBe('2026-11-22T11:40:00.000Z');
  });

  it('reads an ISO date without an offset as local time in the hub zone', () => {
    expect(iso('2026-11-22 05:40')).toBe('2026-11-22T11:40:00.000Z');
    expect(iso('2026-11-22T05:40:12')).toBe('2026-11-22T11:40:12.000Z');
  });

  it('reads a Chinese-language iPhone date', () => {
    expect(iso('2026年11月22日 上午5:40')).toBe('2026-11-22T11:40:00.000Z');
    expect(iso('2026年11月22日 下午11:05')).toBe('2026-11-23T05:05:00.000Z');
    expect(iso('2026年11月22日 晚上9:30:15')).toBe('2026-11-23T03:30:15.000Z');
    expect(iso('2026年11月22日 凌晨12:30')).toBe('2026-11-22T06:30:00.000Z');
    expect(iso('2026年11月22日 中午12:15')).toBe('2026-11-22T18:15:00.000Z');
    expect(iso('2026年11月22日 23:05')).toBe('2026-11-23T05:05:00.000Z');
    expect(iso('2026/11/22 05:40:12')).toBe('2026-11-22T11:40:12.000Z');
  });

  it('reads Shortcuts’ default English dates', () => {
    expect(iso('Nov 22, 2026 at 5:40 AM')).toBe('2026-11-22T11:40:00.000Z');
    expect(iso('November 22, 2026 at 11:05:30 PM')).toBe('2026-11-23T05:05:30.000Z');
    expect(iso('22 Nov 2026 at 05:40')).toBe('2026-11-22T11:40:00.000Z');
    expect(iso('Nov 22, 2026, 12:10 AM')).toBe('2026-11-22T06:10:00.000Z');
  });

  it('uses the right offset on both sides of a DST change', () => {
    // 8 Mar 2026: Chicago springs forward at 02:00, so 03:30 is CDT (−05:00).
    expect(iso('Mar 8, 2026 at 3:30 AM')).toBe('2026-03-08T08:30:00.000Z');
    expect(iso('2026年3月7日 晚上11:30')).toBe('2026-03-08T05:30:00.000Z');
  });

  it('returns null for text that is not a date', () => {
    expect(iso('soon')).toBeNull();
    expect(iso('2026年13月40日 上午5:40')).toBeNull();
    expect(iso('')).toBeNull();
  });
});
