import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { addDays } from 'date-fns';
import { useMemo } from 'react';
import type { FocusSession } from '@shared/types.ts';
import { api } from '../../../api.ts';
import { localDay } from '../../../lib/format.ts';
import { useCalendar } from '../calendar/useCalendar.ts';
import { useSubjects } from '../focus/useSessions.ts';
import { subjectPalette } from './dayBlocks.ts';

/** How often the sessions are read again, so a session paused while the Mac slept stops growing. */
export const SESSIONS_POLL_MS = 60_000;

/**
 * The focus sessions touching the local days `[from, toExclusive)`. The hub lists sessions by the
 * day they start, so this asks from the day before: one running past midnight is drawn too.
 * Starting, pausing or stopping a session refreshes it (they invalidate every `sessions` query).
 */
export function useSessionsBetween(from: Date, toExclusive: Date) {
  const range = { from: localDay(addDays(from, -1).toISOString()), to: localDay(toExclusive.toISOString()) };
  return useQuery({
    queryKey: ['sessions', 'between', range.from, range.to],
    queryFn: ({ signal }) => api<FocusSession[]>(`/api/sessions?${new URLSearchParams(range)}`, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: SESSIONS_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** Everything the timeline and the review draw for `[from, toExclusive)`: sessions, events and subject colours. */
export function useDayData(from: Date, toExclusive: Date) {
  const sessions = useSessionsBetween(from, toExclusive);
  const calendar = useCalendar(from, toExclusive);
  const subjects = useSubjects();
  const sessionList = sessions.data ?? NO_SESSIONS;
  const palette = useMemo(() => subjectPalette(subjects, sessionList), [subjects, sessionList]);
  return {
    sessions: sessionList,
    events: calendar.data?.events ?? [],
    palette,
    sessionsQuery: sessions,
    calendarQuery: calendar,
  };
}

const NO_SESSIONS: FocusSession[] = [];
