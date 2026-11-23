import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { FocusSession, Subject } from '@shared/types.ts';
import { api, ApiError } from '../../../api.ts';

/** How often the hub is asked which session is open. */
export const CURRENT_POLL_MS = 5000;

/** The open session, re-read every 5 s, and its focus time ticked on locally every second. */
export function useCurrentSession(): { session: FocusSession | null; elapsed: number } {
  const query = useQuery({
    queryKey: ['sessions', 'current'],
    queryFn: ({ signal }) => api<FocusSession | null>('/api/sessions/current', { signal }),
    refetchInterval: CURRENT_POLL_MS,
  });
  const session = query.data ?? null;
  const elapsed = useElapsed(session);
  return { session, elapsed };
}

/**
 * Whole seconds of focus as of now: the hub's figure when its reply landed,
 * plus the seconds since, while the session runs and the Mac is awake. A new
 * reply starts the count again from its own figure, and never takes it back —
 * both the local tick and the 5 s reply between them keep it rising.
 */
export function useElapsed(session: FocusSession | null): number {
  const running = session?.status === 'running' && session.autoPausedAt === null;
  const focusSeconds = session?.focusSeconds ?? 0;
  const [, setTick] = useState(0);
  // The figure and the moment it arrived; after a reply a new pair replaces both together.
  const [from, setFrom] = useState({ since: Date.now(), focusSeconds });
  // The highest figure shown: neither an early local tick nor a late reply takes the clock back.
  const [high, setHigh] = useState(focusSeconds);

  useEffect(() => {
    setFrom({ since: Date.now(), focusSeconds });
    setHigh((shown) => Math.max(shown, focusSeconds));
    const timer = running ? setInterval(() => setTick((n) => n + 1), 1000) : undefined;
    return () => clearInterval(timer);
  }, [running, focusSeconds]);

  if (!running) return focusSeconds;
  const shown = from.focusSeconds + Math.floor((Date.now() - from.since) / 1000);
  if (shown > high) setHigh(shown);
  return Math.max(high, shown);
}

export type SessionInput = {
  name: string;
  subjectName?: string;
  tags?: string[];
  goalId?: number | null;
};

/** Start, pause, resume and stop, each answered by the hub, with the list refreshed. */
export function useSessionActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sessions'] });

  return {
    async start(input: SessionInput): Promise<FocusSession> {
      const session = await api<FocusSession>('/api/sessions', { method: 'POST', json: input });
      await refresh();
      return session;
    },
    async pause(id: number): Promise<FocusSession> {
      const session = await api<FocusSession>(`/api/sessions/${id}/pause`, { method: 'POST' });
      await refresh();
      return session;
    },
    async resume(id: number): Promise<FocusSession> {
      const session = await api<FocusSession>(`/api/sessions/${id}/resume`, { method: 'POST' });
      await refresh();
      return session;
    },
    async stop(id: number): Promise<FocusSession> {
      const session = await api<FocusSession>(`/api/sessions/${id}/stop`, { method: 'POST' });
      await refresh();
      return session;
    },
  };
}

export type SessionActions = ReturnType<typeof useSessionActions>;

/** A goal as `GET /api/goals` (Task 9) sends it; only the parts this panel reads. */
export type SessionGoal = { id: number; title: string };

export type OpenGoals = {
  goals: SessionGoal[];
  /** The route is missing (404), so there is no goal to pick and nothing to show: the select stays out. */
  unsupported: boolean;
  /** Any other failure: the select stays out, and a line with Retry says why. */
  failed: boolean;
  retry: () => void;
};

/**
 * The open goals. Until the goals route exists (R15) it answers 404, which
 * quietly means none. Any other error is shown, never swallowed.
 */
export function useOpenGoals(): OpenGoals {
  const query = useQuery({
    queryKey: ['goals', 'open'],
    queryFn: ({ signal }) => api<SessionGoal[]>('/api/goals?status=open', { signal }),
    staleTime: 60_000,
  });
  // A failure reads as `isPending` with no data, not `isError`; the stored error is the truth.
  const failure = query.error ?? query.failureReason ?? null;
  return {
    goals: query.data ?? [],
    unsupported: failure instanceof ApiError && failure.status === 404,
    failed: failure !== null && !(failure instanceof ApiError && failure.status === 404),
    retry: () => void query.refetch(),
  };
}

/** The subjects to suggest, from what earlier sessions were about. */
export function useSubjects(): Subject[] {
  const query = useQuery({
    queryKey: ['subjects'],
    queryFn: ({ signal }) => api<Subject[]>('/api/subjects', { signal }),
    staleTime: 60_000,
  });
  return query.data ?? [];
}
