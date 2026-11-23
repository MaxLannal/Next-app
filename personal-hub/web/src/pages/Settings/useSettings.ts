import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettingsView } from '@shared/types.ts';
import { api, ApiError } from '../../api.ts';

/** What Settings reads and writes; the sections share one query, so a change shows everywhere. */
export const settingsQuery = queryOptions({
  queryKey: ['settings'],
  queryFn: ({ signal }) => api<SettingsView>('/api/settings', { signal }),
});

export type SettingsPatch = {
  passcode?: string;
  keepAwake?: boolean;
  timeZone?: string;
  sleepTargetHours?: number;
};

export function useSettings() {
  const queryClient = useQueryClient();
  const query = useQuery(settingsQuery);

  const save = async (patch: SettingsPatch): Promise<SettingsView> => {
    const next = await api<SettingsView>('/api/settings', { method: 'PATCH', json: patch });
    queryClient.setQueryData(settingsQuery.queryKey, next);
    return next;
  };

  return { query, save };
}

/** The hub's answer when it has one, else a calm fallback. */
export const messageOf = (err: unknown, fallback: string) =>
  err instanceof ApiError && err.status !== 0 ? err.message : fallback;

/** "Saved 14:02", 24-hour, the hub's own voice. */
export function savedAt(now: Date): string {
  return `Saved ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}
