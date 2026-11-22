import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { CalendarEvent } from '@shared/types.ts';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { Panel } from '../../../components/ui/Panel.tsx';
import { Tabs } from '../../../components/ui/Tabs.tsx';
import { formatShortDate } from '../../../lib/format.ts';
import { useNow } from '../time/useNow.ts';
import { EventDetails } from './EventDetails.tsx';
import { calendarProblem, eventsOn, timeLabel, useCalendar } from './useCalendar.ts';
import './CalendarPanel.css';

type View = 'month' | 'week';
const VIEWS = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
];
const WEEK = { weekStartsOn: 1 } as const; // ISO weeks, as the hero's week number
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ARROWS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/**
 * The calendar, read-only: a month grid with a dot per event in its calendar's
 * colour and the chosen day's events under it, or the week as a list by day.
 * An event opens its details in a sheet.
 */
export function CalendarPanel() {
  const [view, setView] = useState<View>('month');
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [open, setOpen] = useState<CalendarEvent | null>(null);

  const today = startOfDay(useNow(60_000));
  const days = view === 'month' ? monthGrid(selected) : weekOf(selected);
  const { data, error, isPending, refetch } = useCalendar(days[0]!, addDays(days[days.length - 1]!, 1));
  const events = data?.events ?? [];

  const step = (n: number) => setSelected((d) => (view === 'month' ? addMonths(d, n) : addWeeks(d, n)));
  const unit = view === 'month' ? 'month' : 'week';
  const showsToday = days.some((d) => isSameDay(d, today));

  const waiting = <p className="cal__none">Reading your calendar</p>;
  const problem = error ? calendarProblem(error) : null;
  const problemState = problem && (
    <EmptyState
      title={problem.title}
      line={problem.line}
      action={
        problem.canRetry ? (
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void refetch()}>
            Retry
          </button>
        ) : undefined
      }
    />
  );

  return (
    <Panel
      title="Calendar"
      actions={<Tabs options={VIEWS} value={view} onChange={(v) => setView(v as View)} label="Calendar view" />}
    >
      <div className="cal__bar">
        <p className="cal__range num">{view === 'month' ? format(selected, 'MMMM yyyy') : weekRange(days)}</p>
        {!showsToday && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSelected(today)}>
            Today
          </button>
        )}
        <button className="btn btn-ghost btn-sm cal__step" type="button" aria-label={`Previous ${unit}`} onClick={() => step(-1)}>
          <Chevron flip />
        </button>
        <button className="btn btn-ghost btn-sm cal__step" type="button" aria-label={`Next ${unit}`} onClick={() => step(1)}>
          <Chevron />
        </button>
      </div>

      {view === 'month' ? (
        <>
          <MonthGrid days={days} selected={selected} today={today} events={events} onSelect={setSelected} />
          <div className="cal__day">
            <h3 className="cal__label">{format(selected, 'EEEE d MMMM')}</h3>
            {problemState ?? (isPending ? waiting : <EventList events={eventsOn(events, selected)} day={selected} onOpen={setOpen} />)}
          </div>
        </>
      ) : (
        (problemState ?? (isPending ? waiting : <WeekList days={days} today={today} events={events} onOpen={setOpen} />))
      )}

      <EventDetails event={open} onClose={() => setOpen(null)} />
    </Panel>
  );
}

function MonthGrid(props: {
  days: Date[];
  selected: Date;
  today: Date;
  events: CalendarEvent[];
  onSelect: (day: Date) => void;
}) {
  const { days, selected, today, events, onSelect } = props;
  const gridRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  // After an arrow key, focus follows the selection, even into the next month.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  }, [selected]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = ARROWS[e.key];
    if (by === undefined) return;
    e.preventDefault();
    moved.current = true;
    onSelect(addDays(selected, by));
  };

  return (
    <div className="month">
      <div className="month__head" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="month__grid" ref={gridRef} onKeyDown={onKeyDown}>
        {days.map((day) => {
          const dayEvents = eventsOn(events, day);
          const isSelected = isSameDay(day, selected);
          const className = ['month__day', !isSameMonth(day, selected) && 'is-outside', isSameDay(day, today) && 'is-today']
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={day.toISOString()}
              className={className}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${format(day, 'EEEE d MMMM')}, ${count(dayEvents.length)}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onSelect(day)}
            >
              <span className="month__n num">{day.getDate()}</span>
              <span className="month__dots" aria-hidden="true">
                {dayEvents.slice(0, 4).map((e) => (
                  <i key={e.id} style={{ '--dot': e.color } as CSSProperties} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekList(props: { days: Date[]; today: Date; events: CalendarEvent[]; onOpen: (e: CalendarEvent) => void }) {
  const { days, today, events, onOpen } = props;
  return (
    <div className="cal__week">
      {days.map((day) => {
        const label = formatShortDate(format(day, 'yyyy-MM-dd'));
        const dayEvents = eventsOn(events, day);
        const className = ['cal__group', isSameDay(day, today) && 'is-today', dayEvents.length === 0 && 'is-empty']
          .filter(Boolean)
          .join(' ');
        return (
          <div key={label} className={className} role="group" aria-label={label}>
            <h3 className="cal__label num">{label}</h3>
            <EventList events={dayEvents} day={day} onOpen={onOpen} />
          </div>
        );
      })}
    </div>
  );
}

function EventList({ events, day, onOpen }: { events: CalendarEvent[]; day: Date; onOpen: (e: CalendarEvent) => void }) {
  if (events.length === 0) return <p className="cal__none">Nothing on</p>;
  return (
    <ul className="cal__events">
      {events.map((event) => (
        <li key={event.id}>
          <button className="cal__event" type="button" onClick={() => onOpen(event)}>
            <span className="cal__time num">{timeLabel(event, day)}</span>
            <span className="cal__dot" style={{ '--dot': event.color } as CSSProperties} aria-hidden="true" />
            <span className="cal__name">{event.title || 'Untitled event'}</span>
            {event.location && <span className="cal__where">{event.location}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Chevron({ flip = false }: { flip?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const count = (n: number) => (n === 0 ? 'no events' : n === 1 ? '1 event' : `${n} events`);

/** Monday to Sunday, covering the whole month of `day`. */
function monthGrid(day: Date): Date[] {
  const start = startOfWeek(startOfMonth(day), WEEK);
  const end = addDays(startOfWeek(endOfMonth(day), WEEK), 6);
  return eachDayOfInterval({ start, end });
}

function weekOf(day: Date): Date[] {
  const start = startOfWeek(day, WEEK);
  return eachDayOfInterval({ start, end: addDays(start, 6) });
}

/** `"16–22 Nov 2026"`, `"30 Nov – 6 Dec 2026"`, `"28 Dec 2026 – 3 Jan 2027"`. */
function weekRange(days: Date[]): string {
  const first = days[0]!;
  const last = days[days.length - 1]!;
  if (isSameMonth(first, last)) return `${format(first, 'd')}–${format(last, 'd MMM yyyy')}`;
  const firstFormat = first.getFullYear() === last.getFullYear() ? 'd MMM' : 'd MMM yyyy';
  return `${format(first, firstFormat)} – ${format(last, 'd MMM yyyy')}`;
}
