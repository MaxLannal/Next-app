import { addDays, addHours, startOfDay } from 'date-fns';
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import type { CalendarEvent } from '@shared/types.ts';
import { formatDuration, formatTime } from '../../../lib/format.ts';
import { CalendarProblem } from '../calendar/CalendarProblem.tsx';
import { EventDetails } from '../calendar/EventDetails.tsx';
import { FALLBACK_NOTE } from '../calendar/useCalendar.ts';
import { useNow } from '../time/useNow.ts';
import {
  allDayOn,
  blocksOn,
  dayBounds,
  dayFraction,
  eventCountOf,
  focusSecondsOf,
  placeBlocks,
  type PlacedBlock,
} from './dayBlocks.ts';
import { useDayData } from './useDayData.ts';
import './DayTimeline.css';

/** One hour's height on the timeline, in px: the day is 24 of these, scrolled through a window. */
export const HOUR_PX = 48;
/** Below this height a block carries no text, and below the next one a single line. */
const BARE_PX = 16;
const ONE_LINE_PX = 38;
/** An hour label this close to now would sit under the now pill. */
const NOW_CLEARANCE_MS = 22 * 60_000;

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Today as a timeline in the hero's glass panel: the day hour by hour, scrolled to now on
 * arrival. Each stretch of focus is a filled block in its subject's colour (a pause is a gap,
 * the running session grows to the now line); each calendar event is a tinted block in its
 * calendar's colour. A focus block opens its session; an event opens its details.
 */
export function DayTimeline() {
  const titleId = useId();
  const now = useNow(60_000);
  const today = startOfDay(now);
  const { sessions, events, palette, sessionsQuery, calendarQuery } = useDayData(today, addDays(today, 1));
  const [open, setOpen] = useState<CalendarEvent | null>(null);

  const blocks = useMemo(() => blocksOn(today, { sessions, events, now, palette }), [today.getTime(), sessions, events, now, palette]);
  const placed = useMemo(() => placeBlocks(blocks), [blocks]);
  const allDay = allDayOn(events, today);
  const bounds = dayBounds(today);
  const nowAt = dayFraction(now.getTime(), bounds);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowInView, setNowInView] = useState(true);
  const toNow = (smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    const top = Math.max(0, nowAt * 24 * HOUR_PX - el.clientHeight * 0.35);
    if (smooth && typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: 'smooth' });
    else el.scrollTop = top;
  };
  // Arrive at now, a third of the way down, and again when the day turns over.
  useLayoutEffect(() => toNow(false), [today.getTime()]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const y = nowAt * 24 * HOUR_PX;
    setNowInView(y >= el.scrollTop && y <= el.scrollTop + el.clientHeight);
  };

  const focus = focusSecondsOf(blocks);
  const eventCount = eventCountOf(blocks) + allDay.length;
  const calendarError = calendarQuery.error;

  return (
    <section className="glass tl" aria-labelledby={titleId}>
      <header className="tl__head">
        <h2 className="tl__title" id={titleId}>
          Today
        </h2>
        <p className="tl__meta num">{summary(focus, eventCount, calendarQuery.isPending)}</p>
      </header>

      {allDay.length > 0 && (
        <ul className="tl__allday" aria-label="All day">
          {allDay.map((event) => (
            <li key={event.id}>
              <button className="tl__chip" type="button" style={{ '--fill': event.color } as CSSProperties} onClick={() => setOpen(event)}>
                {event.title || 'Untitled event'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {calendarError && (
        <div className="tl__problem">
          <CalendarProblem error={calendarError} onRetry={() => void calendarQuery.refetch()} />
        </div>
      )}
      {sessionsQuery.error && (
        <p className="tl__trouble">
          Couldn’t read your focus sessions.{' '}
          <button className="tl__retry" type="button" onClick={() => void sessionsQuery.refetch()}>
            Retry
          </button>
        </p>
      )}

      <div className="tl__window">
        <div className="tl__scroll" ref={scrollRef} onScroll={onScroll} tabIndex={0} role="region" aria-label="Today, hour by hour">
          <div className="tl__day" style={{ height: 24 * HOUR_PX }}>
            {HOURS.map((h) => {
              const at = addHours(today, h).getTime();
              // The now pill takes the gutter near its hour; that hour's label steps aside for it.
              const underNow = Math.abs(at - now.getTime()) < NOW_CLEARANCE_MS;
              return (
                <div key={h} className="tl__hour" style={{ top: `${dayFraction(at, bounds) * 100}%` }} aria-hidden="true">
                  {!underNow && <span className="tl__hour-label num">{String(h).padStart(2, '0')}:00</span>}
                </div>
              );
            })}
            <ol className="tl__blocks">
              {placed.map((block) => (
                <li key={block.key} className="tl__slot" style={placement(block, bounds)}>
                  <Block block={block} onOpen={setOpen} />
                </li>
              ))}
            </ol>
            <div className="tl__now" style={{ top: `${nowAt * 100}%` }}>
              <span className="tl__now-time num">
                <span className="visually-hidden">Now, </span>
                {formatTime(now.toISOString())}
              </span>
            </div>
          </div>
        </div>
        {!nowInView && (
          <button className="btn btn-ghost btn-sm tl__jump" type="button" onClick={() => toNow(true)}>
            Now
          </button>
        )}
      </div>

      {blocks.length === 0 && allDay.length === 0 && !calendarQuery.isPending && !calendarError && (
        <p className="tl__empty">Focus sessions and calendar events fill in here as the day goes.</p>
      )}
      {!calendarError && calendarQuery.data?.source === 'calendar-app' && <p className="tl__note">{FALLBACK_NOTE}</p>}
      <EventDetails event={open} onClose={() => setOpen(null)} />
    </section>
  );
}

function Block({ block, onOpen }: { block: PlacedBlock; onOpen: (event: CalendarEvent) => void }) {
  const px = ((block.end - block.start) / 3_600_000) * HOUR_PX;
  const size = px < BARE_PX ? 'is-bare' : px < ONE_LINE_PX ? 'is-line' : null;
  const className = ['tl__block', `is-${block.kind}`, size, block.live && 'is-live'].filter(Boolean).join(' ');
  const time = span(block);
  const where = block.kind === 'event' ? block.event?.location : null;
  const label = `${block.title}, ${block.kind === 'focus' ? 'focus' : 'event'}, ${block.identity.name}, ${time}`;
  const style = { '--fill': block.identity.swatch.fill, '--ink': block.identity.swatch.ink } as CSSProperties;

  const body = (
    <>
      <span className="tl__name">{block.title}</span>
      <span className="tl__when num">
        {time}
        {size === null && ` · ${block.identity.name}`}
        {size === null && where ? ` · ${where}` : ''}
      </span>
    </>
  );

  if (block.kind === 'focus' && block.sessionId !== null) {
    return (
      <Link className={className} style={style} to={`/database/session/${block.sessionId}`} aria-label={label} title={label}>
        {body}
      </Link>
    );
  }
  const event = block.event;
  return (
    <button className={className} style={style} type="button" aria-label={label} title={label} onClick={() => event && onOpen(event)}>
      {body}
    </button>
  );
}

/** Where a block sits: its top and height down the day, its lane across. */
function placement(block: PlacedBlock, bounds: { start: number; end: number }): CSSProperties {
  const top = dayFraction(block.start, bounds);
  return {
    '--top': top,
    '--h': dayFraction(block.end, bounds) - top,
    '--lane': block.lane,
    '--lanes': block.lanes,
  } as CSSProperties;
}

/** `"10:30–11:20"`, `"15:00–now"` while it runs. A block cut at midnight keeps its real times. */
function span(block: PlacedBlock): string {
  const from = formatTime(new Date(block.from).toISOString());
  return `${from}–${block.live ? 'now' : formatTime(new Date(block.to).toISOString())}`;
}

/** `"2 h 10 m focus · 3 events"`; `"Nothing logged yet"` on an empty day. */
function summary(focusSeconds: number, events: number, reading: boolean): string {
  const parts: string[] = [];
  if (focusSeconds > 0) parts.push(`${formatDuration(focusSeconds)} focus`);
  if (events > 0) parts.push(`${events} ${events === 1 ? 'event' : 'events'}`);
  if (parts.length > 0) return parts.join(' · ');
  return reading ? 'Reading your calendar' : 'Nothing logged yet';
}
