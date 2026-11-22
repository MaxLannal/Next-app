import { useQuery } from '@tanstack/react-query';
import { addDays, startOfDay } from 'date-fns';
import type { CalendarEvent, CalendarResponse, ServiceFix } from '@shared/types.ts';
import { api, ApiError } from '../../../api.ts';
import { formatTime } from '../../../lib/format.ts';

/** The events from `from` to `to` (local days), read again whenever the window regains focus. */
export function useCalendar(from: Date, to: Date) {
  const range = { from: from.toISOString(), to: to.toISOString() };
  return useQuery({
    queryKey: ['calendar', range.from, range.to],
    queryFn: ({ signal }) => api<CalendarResponse>(`/api/calendar?${new URLSearchParams(range)}`, { signal }),
    refetchOnWindowFocus: true,
  });
}

/** What a failed read should say: the hub's own error and fix on a 503, else a retry line. */
export function calendarProblem(error: unknown): { title: string; line: string; canRetry: boolean } {
  if (error instanceof ApiError && error.status === 503) {
    const body = error.body as Partial<ServiceFix> | null;
    if (typeof body?.fix === 'string') return { title: error.message, line: body.fix, canRetry: false };
  }
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return { title: 'Couldn’t read the calendar', line: message, canRetry: true };
}

/** The events that touch a local day: all-day ones first, then by start. */
export function eventsOn(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const start = startOfDay(day).getTime();
  const end = addDays(startOfDay(day), 1).getTime();
  return events
    .filter((e) => new Date(e.start).getTime() < end && new Date(e.end).getTime() > start)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
}

/** `"All day"`, `"10:30"`, or `"Until 01:00"` for an event that began on an earlier day. */
export function timeLabel(event: CalendarEvent, day: Date): string {
  if (event.allDay) return 'All day';
  if (new Date(event.start) < startOfDay(day)) return `Until ${formatTime(event.end)}`;
  return formatTime(event.start);
}
