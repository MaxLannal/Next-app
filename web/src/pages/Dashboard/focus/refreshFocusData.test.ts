import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { refreshFocusData } from './useSessions.ts';

describe('refreshFocusData', () => {
  it('marks the Year of focus heatmap and its subject ring stale, as well as the session lists and pies', async () => {
    const client = new QueryClient();
    const keys = [
      ['sessions', 'history', 0],
      ['stats', 'subjects', 'day'],
      ['heatmap', '2026'],
      ['subjects', 'year', '/api/stats/subjects?range=year&date=2026-01-01'],
    ];
    // Cached as fresh forever, the way the year's ring is.
    for (const key of keys) client.setQueryData(key, 'old', { updatedAt: Date.now() });
    await refreshFocusData(client);
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
