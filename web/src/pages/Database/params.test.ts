import { describe, expect, it } from 'vitest';
import { nextDay, readView, toSessionFilters, writeView } from './params.ts';

describe('the date range', () => {
  it('sends a To day as the day after it, because the API stops before its bound', () => {
    const { filters } = readView(new URLSearchParams('from=2026-11-22&to=2026-11-22'));
    expect(filters.from).toBe('2026-11-22');
    expect(filters.to).toBe('2026-11-22');
    // Same day both ends: a real range of one day, not an empty one.
    expect(toSessionFilters(filters, true)).toMatchObject({ from: '2026-11-22', to: '2026-11-23' });
  });

  it('crosses month and year ends, and survives a DST change', () => {
    expect(nextDay('2026-11-30')).toBe('2026-12-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    // DST ends in the US on 1 November 2026: adding a calendar day is still one day.
    expect(nextDay('2026-10-31')).toBe('2026-11-01');
    expect(nextDay('2026-03-07')).toBe('2026-03-08');
  });

  it('leaves To out when it is not set, and keeps it in the address bar as chosen', () => {
    const { filters } = readView(new URLSearchParams(''));
    expect(toSessionFilters(filters, true).to).toBeUndefined();
    expect(writeView({ filters: { ...filters, to: '2026-11-22' }, sort: 'created', group: 'day' }).get('to')).toBe('2026-11-22');
  });
});
