import { describe, expect, it } from 'vitest';
import type { Trace } from '@shared/types.ts';
import { groupByCity, spanOf } from './cities.ts';

const trace = (over: Partial<Trace>): Trace => ({
  id: 1,
  lng: -87.63,
  lat: 41.88,
  city: 'Chicago',
  country: 'United States',
  day: '2026-11-23',
  notes: '',
  createdAt: '2026-11-23T12:00:00.000Z',
  photos: [],
  essays: [],
  ...over,
});

describe('groupByCity', () => {
  it('gathers a city’s experiences into one, in the order they happened', () => {
    const cities = groupByCity([
      trace({ id: 1, day: '2026-11-23', photos: [{ id: 10, url: '/a' }] }),
      trace({ id: 2, city: 'chicago ', day: '2026-09-28', lng: -87.6, lat: 41.9, photos: [{ id: 20, url: '/b' }] }),
      trace({ id: 3, city: 'Kyoto', country: 'Japan', day: '2026-04-02' }),
    ]);
    expect(cities.map((c) => c.city)).toEqual(['Chicago', 'Kyoto']);
    const chicago = cities[0]!;
    expect(chicago.traces.map((t) => t.id)).toEqual([2, 1]);
    expect(chicago.when).toBe('28 Sep – 23 Nov 2026');
    // The latest experience's photos lead the album.
    expect(chicago.photos.map((p) => p.id)).toEqual([10, 20]);
    expect(chicago.lng).toBeCloseTo(-87.615);
  });

  it('keeps an experience with no city on its own', () => {
    expect(groupByCity([trace({ id: 1, city: '' }), trace({ id: 2, city: '' })])).toHaveLength(2);
  });
});

describe('spanOf', () => {
  it('says the year once when both days share it, and a lone day as itself', () => {
    expect(spanOf(['2026-11-23'])).toBe('23 Nov 2026');
    expect(spanOf(['2025-12-30', '2026-01-02'])).toBe('30 Dec 2025 – 2 Jan 2026');
    expect(spanOf([])).toBe('');
  });
});
