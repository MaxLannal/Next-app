import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FocusSession, Subject } from '@shared/types.ts';
import { api, ApiError } from '../../../api.ts';
import { useNow } from '../../../lib/useNow.ts';

/** How often the hub is asked which session is open. */
export const CURRENT_POLL_MS = 5000;

const CURRENT_KEY = ['sessions', 'current'] as const;

/** The open session as the hub last sent it, and the instant its clock counts from. */
export type CurrentFocus = {
  session: FocusSession | null;
  /** When the reply landed, in ms. */
  receivedAt: number;
  /**
   * While the session runs, the instant its focus counts from: the reply's landing less the
   * hub's figure. It lives in the query cache, so every clock on screen counts from the same one.
   */
  since: number;
};

/** A reply within this of the running count is the same clock, seen through rounding and the trip. */
export const SLACK_MS = 1500;

const isRunning = (session: FocusSession | null): boolean =>
  session !== null && session.status === 'running' && session.autoPausedAt === null;

/**
 * Where a reply's clock counts from. A running session keeps its old start while the hub agrees
 * with it to within `SLACK_MS`, so a poll never nudges the clock back a second. Otherwise — a new
 * session, a resume, the time a sleeping Mac took off — the hub's figure is the clock.
 */
export function anchorReply(session: FocusSession | null, receivedAt: number, previous: CurrentFocus | undefined): CurrentFocus {
  const since = receivedAt - (session?.focusSeconds ?? 0) * 1000;
  const sameClock =
    previous !== undefined &&
    isRunning(previous.session) &&
    isRunning(session) &&
    previous.session?.id === session?.id &&
    Math.abs(since - previous.since) < SLACK_MS;
  return { session, receivedAt, since: sameClock ? previous.since : since };
}

/** Whole seconds of focus at `now`: counted on from `since` while it runs, the hub's figure while it waits. */
export function focusElapsed(current: CurrentFocus | undefined, now: number): number {
  if (current === undefined || current.session === null) return 0;
  if (!isRunning(current.session)) return current.session.focusSeconds;
  return Math.max(0, Math.floor((Math.max(now, current.receivedAt) - current.since) / 1000));
}

/**
 * The open session, re-read every 5 s, and its focus time. Every caller reads the same reply and
 * the same shared tick, so the rail's clock and the Focus panel's never disagree.
 */
export function useCurrentSession(): { session: FocusSession | null; elapsed: number } {
  const query = useQuery({
    queryKey: CURRENT_KEY,
    queryFn: async ({ signal, client }) => {
      const session = await api<FocusSession | null>('/api/sessions/current', { signal });
      return anchorReply(session, Date.now(), client.getQueryData<CurrentFocus>(CURRENT_KEY));
    },
    refetchInterval: CURRENT_POLL_MS,
  });
  const current = query.data;
  const session = current?.session ?? null;
  const now = useNow(isRunning(session));
  return { session, elapsed: focusElapsed(current, now) };
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
