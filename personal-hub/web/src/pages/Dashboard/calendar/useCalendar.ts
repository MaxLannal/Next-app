import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { addDays, startOfDay } from 'date-fns';
import type { CalendarEvent, CalendarResponse } from '@shared/types.ts';
import { api } from '../../../api.ts';
import { formatTime } from '../../../lib/format.ts';

/** Shown under a panel whose events came from the Calendar app fallback, which doesn't expand repeating events. */
export const FALLBACK_NOTE = 'From the Calendar app — repeating events may be missing';

/**
 * The events from `from` to `to` (local days), read again whenever the window
 * regains focus. A new range keeps showing the last one's events until it arrives.
 */
export function useCalendar(from: Date, to: Date) {
  const range = { from: from.toISOString(), to: to.toISOString() };
  return useQuery({
    queryKey: ['calendar', range.from, range.to],
    queryFn: ({ signal }) => api<CalendarResponse>(`/api/calendar?${new URLSearchParams(range)}`, { signal }),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });
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
