import { addDays, startOfDay } from 'date-fns';
import { useId, type CSSProperties } from 'react';
import type { CalendarEvent } from '@shared/types.ts';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { formatTime } from '../../../lib/format.ts';
import { useNow } from '../time/useNow.ts';
import { CalendarProblem } from './CalendarProblem.tsx';
import { eventsOn, FALLBACK_NOTE, timeLabel, useCalendar } from './useCalendar.ts';
import './TodayAgenda.css';

/**
 * Today's events in the hero's one glass panel (after Hallmark's Dusk "run"
 * card): a ruled row each, with the event on now or next marked by a
 * periwinkle dot. Says so when the day is empty or the Mac refuses access.
 */
export function TodayAgenda() {
  const titleId = useId();
  const now = useNow(60_000);
  const today = startOfDay(now);
  const { data, error, isPending, refetch } = useCalendar(today, addDays(today, 1));

  const events = data ? eventsOn(data.events, today) : [];
  const timed = events.filter((e) => !e.allDay);
  const current = timed.find((e) => new Date(e.end) > now) ?? null;
  const onNow = current !== null && new Date(current.start) <= now;

  let body;
  if (error) {
    body = <CalendarProblem error={error} onRetry={() => void refetch()} />;
  } else if (isPending) {
    body = <p className="agenda__wait">Reading your calendar</p>;
  } else if (events.length === 0) {
    body = <EmptyState title="Nothing on the calendar today" line="Events from every calendar on this Mac show here." />;
  } else {
    body = (
      <ul className="agenda__list">
        {events.map((event, i) => (
          <AgendaRow
            key={event.id}
            event={event}
            day={today}
            index={i}
            past={!event.allDay && new Date(event.end) <= now}
            marker={event === current ? (onNow ? 'Now' : 'Next') : null}
          />
        ))}
      </ul>
    );
  }

  return (
    <section className="glass agenda" aria-labelledby={titleId}>
      <header className="agenda__head">
        <h2 className="agenda__title" id={titleId}>
          Today
        </h2>
        {events.length > 0 && <p className="agenda__meta num">{summary(events.length, current, onNow, timed.length)}</p>}
      </header>
      {body}
      {!error && data?.source === 'calendar-app' && <p className="agenda__note">{FALLBACK_NOTE}</p>}
    </section>
  );
}

function AgendaRow(props: { event: CalendarEvent; day: Date; index: number; past: boolean; marker: 'Now' | 'Next' | null }) {
  const { event, day, index, past, marker } = props;
  const className = ['agenda__row', 'rise', past && 'is-past', marker && 'is-next', marker === 'Now' && 'is-now']
    .filter(Boolean)
    .join(' ');
  return (
    <li className={className} style={{ '--d': index } as CSSProperties}>
      {marker && <span className="visually-hidden">{marker}</span>}
      <span className="agenda__time num">{timeLabel(event, day)}</span>
      <span className="agenda__dot" style={{ '--dot': event.color } as CSSProperties} title={event.calendar} aria-hidden="true" />
      <span className="agenda__name">{event.title || 'Untitled event'}</span>
      {event.location && <span className="agenda__where">{event.location}</span>}
    </li>
  );
}

/** `"3 events · next at 15:00"`, `"2 events · on now until 16:00"`, `"3 events · all done"`. */
function summary(count: number, current: CalendarEvent | null, onNow: boolean, timedCount: number): string {
  const total = `${count} ${count === 1 ? 'event' : 'events'}`;
  if (current) return `${total} · ${onNow ? `on now until ${formatTime(current.end)}` : `next at ${formatTime(current.start)}`}`;
  return timedCount > 0 ? `${total} · all done` : total;
}
