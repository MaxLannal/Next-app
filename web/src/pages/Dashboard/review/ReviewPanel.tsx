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
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Panel } from '../../../components/ui/Panel.tsx';
import { Tabs } from '../../../components/ui/Tabs.tsx';
import { formatDuration, formatTime } from '../../../lib/format.ts';
import { CalendarProblem } from '../calendar/CalendarProblem.tsx';
import { FALLBACK_NOTE } from '../calendar/useCalendar.ts';
import { useNow } from '../time/useNow.ts';
import {
  blocksOn,
  dayBounds,
  dayFraction,
  eventCountOf,
  focusSecondsOf,
  placeBlocks,
  totalsByGroup,
  type GroupTotal,
  type PlacedBlock,
} from '../timeline/dayBlocks.ts';
import { useDayData } from '../timeline/useDayData.ts';
import './ReviewPanel.css';

type View = 'week' | 'month';
const VIEWS = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];
const WEEK = { weekStartsOn: 1 } as const; // ISO weeks, as the calendar and the hero's week number
const TICKS = [0, 6, 12, 18, 24];

type Day = { date: Date; blocks: PlacedBlock[]; focus: number; events: number };
/** What the readout shows: a day, or one block on it. */
type Pick = { index: number; block: PlacedBlock | null };

/**
 * The week or the month in review: each day is one thin bar, its timeline squeezed down
 * (midnight at the top, midnight at the foot), side by side. Focus fills its stretch in the
 * subject's colour; an event fills its own in its calendar's, a step quieter. Hover or arrow
 * through the days to read one; the legend totals the range by subject and calendar.
 */
export function ReviewPanel() {
  const [view, setView] = useState<View>('week');
  const now = useNow(60_000);
  const today = startOfDay(now);
  const [anchor, setAnchor] = useState(today);

  const dates = view === 'week' ? weekOf(anchor) : monthOf(anchor);
  const first = dates[0]!;
  const after = addDays(dates[dates.length - 1]!, 1);
  const { sessions, events, palette, sessionsQuery, calendarQuery } = useDayData(first, after);

  const days: Day[] = useMemo(
    () =>
      dates.map((date) => {
        // A review is of what has happened: today stops at now, and days to come stay empty.
        const blocks = blocksOn(date, { sessions, events, now, palette })
          .filter((b) => b.start < now.getTime())
          .map((b) => (b.end > now.getTime() ? { ...b, end: now.getTime() } : b));
        return { date, blocks: placeBlocks(blocks), focus: focusSecondsOf(blocks), events: eventCountOf(blocks) };
      }),
    // `dates` is rebuilt each render; its first day and length name it.
    [first.getTime(), dates.length, sessions, events, now, palette],
  );
  const totals = useMemo(() => totalsByGroup(days.flatMap((d) => d.blocks)), [days]);

  const [pick, setPick] = useState<Pick | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  useEffect(() => {
    setPick(null);
    const at = days.findIndex((d) => isSameDay(d.date, today));
    setFocusIndex(at >= 0 ? at : 0);
  }, [view, first.getTime()]);

  const step = (n: number) => setAnchor((d) => (view === 'week' ? addWeeks(d, n) : addMonths(d, n)));
  const unit = view === 'week' ? 'week' : 'month';
  const showsToday = dates.some((d) => isSameDay(d, today));

  return (
    <Panel
      title="Review"
      className="rv"
      actions={
        <div className="rv__actions">
          <Readout days={days} pick={pick} view={view} />
          <p className="rv__range num">{view === 'week' ? weekRange(dates) : format(first, 'MMMM yyyy')}</p>
          {!showsToday && (
            <button className="btn btn-ghost btn-sm rv__today" type="button" onClick={() => setAnchor(today)}>
              {view === 'week' ? 'This week' : 'This month'}
            </button>
          )}
          <button className="btn btn-ghost btn-sm rv__step" type="button" aria-label={`Previous ${unit}`} onClick={() => step(-1)}>
            <Chevron flip />
          </button>
          <button className="btn btn-ghost btn-sm rv__step" type="button" aria-label={`Next ${unit}`} onClick={() => step(1)}>
            <Chevron />
          </button>
          <Tabs options={VIEWS} value={view} onChange={(v) => setView(v as View)} label="Review range" />
        </div>
      }
    >

      {calendarQuery.error && (
        <div className="rv__problem">
          <CalendarProblem error={calendarQuery.error} onRetry={() => void calendarQuery.refetch()} />
        </div>
      )}
      {sessionsQuery.error && (
        <p className="rv__trouble">
          Couldn’t read your focus sessions.{' '}
          <button className="rv__retry" type="button" onClick={() => void sessionsQuery.refetch()}>
            Retry
          </button>
        </p>
      )}

      <Chart
        days={days}
        view={view}
        today={today}
        now={now}
        focusIndex={focusIndex}
        onFocusIndex={setFocusIndex}
        onPick={setPick}
      />
      <Legend totals={totals} />

      {!calendarQuery.error && calendarQuery.data?.source === 'calendar-app' && <p className="rv__note">{FALLBACK_NOTE}</p>}
    </Panel>
  );
}

function Chart(props: {
  days: Day[];
  view: View;
  today: Date;
  now: Date;
  focusIndex: number;
  onFocusIndex: (i: number) => void;
  onPick: (pick: Pick | null) => void;
}) {
  const { days, view, today, now, focusIndex, onFocusIndex, onPick } = props;
  const plotRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  // After an arrow key, focus follows the chosen day.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    plotRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  }, [focusIndex]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : null;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? days.length - 1 : by === null ? null : focusIndex + by;
    if (to === null || to < 0 || to >= days.length) return;
    e.preventDefault();
    moved.current = true;
    onFocusIndex(to);
    onPick({ index: to, block: null });
  };

  return (
    <div className={`rv__chart is-${view}`} style={{ '--days': days.length } as CSSProperties}>
      <div className="rv__axis" aria-hidden="true">
        {TICKS.map((h) => (
          <span key={h} className="rv__tick num" style={{ top: `${(h / 24) * 100}%` }}>
            {String(h).padStart(2, '0')}:00
          </span>
        ))}
      </div>
      <div className="rv__plot">
        <div className="rv__grid" aria-hidden="true">
          {TICKS.map((h) => (
            <i key={h} style={{ top: `${(h / 24) * 100}%` }} />
          ))}
        </div>
        <div
          className="rv__days"
          ref={plotRef}
          role="group"
          aria-label={`One bar per day, midnight at the top. ${days.length} days.`}
          onKeyDown={onKeyDown}
          onPointerLeave={() => onPick(null)}
        >
          {days.map((day, index) => {
            const bounds = dayBounds(day.date);
            const isToday = isSameDay(day.date, today);
            const className = ['rv__day', isToday && 'is-today', day.date > now && 'is-future'].filter(Boolean).join(' ');
            return (
              <button
                key={day.date.getTime()}
                className={className}
                type="button"
                tabIndex={index === focusIndex ? 0 : -1}
                aria-label={describe(day)}
                onPointerEnter={() => onPick({ index, block: null })}
                onFocus={() => {
                  onFocusIndex(index);
                  onPick({ index, block: null });
                }}
              >
                <span className="rv__track">
                  {day.blocks.map((block) => (
                    <span
                      key={block.key}
                      className={`rv__seg is-${block.kind}`}
                      style={segment(block, bounds)}
                      onPointerEnter={() => onPick({ index, block })}
                      onPointerLeave={() => onPick({ index, block: null })}
                    />
                  ))}
                  {isToday && <span className="rv__now" style={{ top: `${dayFraction(now.getTime(), bounds) * 100}%` }} />}
                </span>
                <span className={`rv__label num${isMinor(day.date, view) ? ' is-minor' : ''}`} aria-hidden="true">
                  {view === 'week' ? format(day.date, 'EEE d') : format(day.date, 'd')}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Above the chart, on one line: the range's totals, or the day (or block) under the pointer or the keyboard. */
function Readout({ days, pick, view }: { days: Day[]; pick: Pick | null; view: View }) {
  const day = pick ? days[pick.index] : undefined;
  if (!pick || !day) {
    const focus = days.reduce((sum, d) => sum + d.focus, 0);
    const events = days.reduce((sum, d) => sum + d.events, 0);
    const active = days.filter((d) => d.focus > 0).length;
    return (
      <p className="rv__readout num" aria-live="polite">
        <span className="rv__headline">{totalsLine(focus, events) || `Nothing logged this ${view}`}</span>
        <span className="rv__dim">
          {focus > 0 ? ` · focused on ${active} of ${days.length} days` : ''} · pick a day to read it
        </span>
      </p>
    );
  }
  const block = pick.block;
  return (
    <p className="rv__readout num" aria-live="polite">
      <span className="rv__headline">{format(day.date, 'EEEE d MMMM')}</span>
      <span className="rv__dim"> · {totalsLine(day.focus, day.events) || 'nothing logged'}</span>
      {block ? (
        <span className="rv__piece">
          <Swatch kind={block.kind} fill={block.identity.swatch.fill} />
          {block.title} · {block.identity.name} · {formatTime(new Date(block.from).toISOString())}–
          {block.live ? 'now' : formatTime(new Date(block.to).toISOString())}
        </span>
      ) : (
        totalsByGroup(day.blocks).map((g) => (
          <span key={g.group} className="rv__piece">
            <Swatch kind={g.kind} fill={g.swatch.fill} />
            {g.name} {formatDuration(g.seconds)}
          </span>
        ))
      )}
    </p>
  );
}

function Legend({ totals }: { totals: GroupTotal[] }) {
  if (totals.length === 0) return null;
  return (
    <ul className="rv__legend" aria-label="Time by subject and calendar">
      {totals.map((g) => (
        <li key={g.group} className="rv__key">
          <Swatch kind={g.kind} fill={g.swatch.fill} />
          <span className="rv__key-name">{g.name}</span>
          <span className="rv__key-time num">{formatDuration(g.seconds)}</span>
        </li>
      ))}
    </ul>
  );
}

function Swatch({ kind, fill }: { kind: GroupTotal['kind']; fill: string }) {
  return <span className={`rv__swatch is-${kind}`} style={{ '--fill': fill } as CSSProperties} aria-hidden="true" />;
}

function segment(block: PlacedBlock, bounds: { start: number; end: number }): CSSProperties {
  const top = dayFraction(block.start, bounds);
  return {
    '--top': top,
    '--h': dayFraction(block.end, bounds) - top,
    '--lane': block.lane,
    '--lanes': block.lanes,
    '--fill': block.identity.swatch.fill,
  } as CSSProperties;
}

/** The day for a screen reader: `"Tuesday 18 November: 3 h 10 m focus, 2 events. Mathematics 2 h 0 m, …"`. */
function describe(day: Day): string {
  const head = `${format(day.date, 'EEEE d MMMM')}: ${totalsLine(day.focus, day.events).replace(' · ', ', ') || 'nothing logged'}`;
  const groups = totalsByGroup(day.blocks).map((g) => `${g.name} ${formatDuration(g.seconds)}`);
  return groups.length > 0 ? `${head}. ${groups.join(', ')}` : head;
}

/** `"14 h 20 m focus · 9 events"`, or `""` when there is neither. */
function totalsLine(focusSeconds: number, events: number): string {
  const parts: string[] = [];
  if (focusSeconds > 0) parts.push(`${formatDuration(focusSeconds)} focus`);
  if (events > 0) parts.push(`${events} ${events === 1 ? 'event' : 'events'}`);
  return parts.join(' · ');
}

/** In a month, only Mondays (and the 1st) keep their number on a narrow screen. */
function isMinor(date: Date, view: View): boolean {
  return view === 'month' && date.getDay() !== 1 && date.getDate() !== 1;
}

function weekOf(day: Date): Date[] {
  const start = startOfWeek(day, WEEK);
  return eachDayOfInterval({ start, end: addDays(start, 6) });
}

function monthOf(day: Date): Date[] {
  return eachDayOfInterval({ start: startOfMonth(day), end: endOfMonth(day) });
}

/** `"16 – 22 Nov 2026"`, `"30 Nov – 6 Dec 2026"`, `"28 Dec 2026 – 3 Jan 2027"`. */
function weekRange(days: Date[]): string {
  const a = days[0]!;
  const b = days[days.length - 1]!;
  if (a.getFullYear() !== b.getFullYear()) return `${format(a, 'd MMM yyyy')} – ${format(b, 'd MMM yyyy')}`;
  if (!isSameMonth(a, b)) return `${format(a, 'd MMM')} – ${format(b, 'd MMM yyyy')}`;
  return `${format(a, 'd')} – ${format(b, 'd MMM yyyy')}`;
}

function Chevron({ flip = false }: { flip?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
