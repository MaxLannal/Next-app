import { format, isSameDay } from 'date-fns';
import type { CSSProperties } from 'react';
import type { CalendarEvent } from '@shared/types.ts';
import { Sheet } from '../../../components/ui/Sheet.tsx';
import { formatTime } from '../../../lib/format.ts';
import './EventDetails.css';

/** One event, read-only, in a sheet: when, which calendar, where, its link and notes. */
export function EventDetails({ event, onClose }: { event: CalendarEvent | null; onClose: () => void }) {
  return (
    <Sheet open={event !== null} onClose={onClose} title={event ? event.title || 'Untitled event' : ''}>
      {event && (
        <dl className="details">
          <div className="details__row">
            <dt>When</dt>
            <dd className="num">{when(event)}</dd>
          </div>
          <div className="details__row">
            <dt>Calendar</dt>
            <dd className="details__calendar">
              <span className="details__dot" style={{ '--dot': event.color } as CSSProperties} aria-hidden="true" />
              {event.calendar}
            </dd>
          </div>
          {event.location && (
            <div className="details__row">
              <dt>Where</dt>
              <dd>{event.location}</dd>
            </div>
          )}
          {event.url && (
            <div className="details__row">
              <dt>Link</dt>
              <dd className="details__link">
                {isWebLink(event.url) ? (
                  <a href={event.url} target="_blank" rel="noreferrer">
                    {event.url}
                  </a>
                ) : (
                  event.url
                )}
              </dd>
            </div>
          )}
          {event.notes && (
            <div className="details__row">
              <dt>Notes</dt>
              <dd className="details__notes">{event.notes}</dd>
            </div>
          )}
        </dl>
      )}
    </Sheet>
  );
}

const DAY = 'EEEE d MMMM';

/** `"Wednesday 25 November, 18:00–20:00"`, `"Sunday 22 November, all day"`, or both ends when it spans days. */
function when(event: CalendarEvent): string {
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (event.allDay) {
    // All-day events end at (or just before) midnight after their last day.
    const lastDay = new Date(Math.max(start.getTime(), end.getTime() - 1));
    return isSameDay(start, lastDay)
      ? `${format(start, DAY)}, all day`
      : `${format(start, DAY)} – ${format(lastDay, DAY)}, all day`;
  }
  if (isSameDay(start, end)) return `${format(start, DAY)}, ${formatTime(event.start)}–${formatTime(event.end)}`;
  return `${format(start, DAY)}, ${formatTime(event.start)} – ${format(end, DAY)}, ${formatTime(event.end)}`;
}

/** Only web addresses become links; anything else (a `javascript:` URL from a feed) stays text. */
function isWebLink(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
