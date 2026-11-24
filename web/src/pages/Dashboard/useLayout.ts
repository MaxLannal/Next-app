import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { DEFAULT_LAYOUT, normalizeLayout, type DashboardLayout } from '@shared/layout.ts';
import { api } from '../../api.ts';

const KEY = ['layout'];
const REMEMBERED = 'hub:layout';

/** The layout last seen in this browser, so the dashboard opens on it instead of the default. */
function remembered(): DashboardLayout | undefined {
  try {
    const raw = localStorage.getItem(REMEMBERED);
    return raw === null ? undefined : normalizeLayout(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/**
 * The dashboard's pages and where its panels sit, as kept by the hub. `change` shows an edit at
 * once and saves it; a save the hub refuses puts the last layout back.
 */
export function useLayout() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: async ({ signal }) => (await api<{ layout: DashboardLayout }>('/api/settings/layout', { signal })).layout,
    initialData: remembered,
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (query.data === undefined) return;
    try {
      localStorage.setItem(REMEMBERED, JSON.stringify(query.data));
    } catch {
      // Private browsing: nothing to remember it in.
    }
  }, [query.data]);

  const save = useMutation({
    mutationKey: KEY,
    mutationFn: (next: DashboardLayout | null) =>
      api<{ layout: DashboardLayout }>('/api/settings/layout', { method: 'PUT', json: { layout: next } }),
    onMutate: async (next) => {
      await client.cancelQueries({ queryKey: KEY });
      const before = client.getQueryData<DashboardLayout>(KEY);
      client.setQueryData(KEY, next ?? DEFAULT_LAYOUT);
      return { before };
    },
    onError: (_err, _next, context) => client.setQueryData(KEY, context?.before),
    // Only the last of several quick edits has the final word.
    onSuccess: (reply) => {
      if (client.isMutating({ mutationKey: KEY }) <= 1) client.setQueryData(KEY, reply.layout);
    },
  });

  return {
    layout: query.data ?? DEFAULT_LAYOUT,
    change: (next: DashboardLayout) => save.mutate(next),
    reset: () => save.mutate(null),
    failed: save.isError,
  };
}
