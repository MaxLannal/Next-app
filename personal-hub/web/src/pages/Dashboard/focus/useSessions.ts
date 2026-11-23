import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { FocusSession, Subject } from '@shared/types.ts';
import { api } from '../../../api.ts';

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
 * reply starts the count again from its own figure.
 */
function useElapsed(session: FocusSession | null): number {
  const running = session?.status === 'running' && session.autoPausedAt === null;
  const focusSeconds = session?.focusSeconds ?? 0;
  const [, setTick] = useState(0);
  // The figure and the moment it arrived; after the 5 s poll a new pair replaces both together.
  const from = useRef({ since: 0, focusSeconds });

  useEffect(() => {
    from.current = { since: Date.now(), focusSeconds };
    const timer = running ? setInterval(() => setTick((n) => n + 1), 1000) : undefined;
    return () => clearInterval(timer);
  }, [running, session?.id, focusSeconds]);

  if (!running) return focusSeconds;
  return Math.max(focusSeconds, from.current.focusSeconds + Math.floor((Date.now() - from.current.since) / 1000));
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

/** The open goals. Until the goals route exists it answers 404, which reads as none. */
export function useOpenGoals(): SessionGoal[] {
  const query = useQuery({
    queryKey: ['goals', 'open'],
    queryFn: ({ signal }) => api<SessionGoal[]>('/api/goals?status=open', { signal }),
    staleTime: 60_000,
  });
  return query.data ?? [];
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
