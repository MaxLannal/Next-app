import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { HeatmapDay, HeatmapStats, SubjectSlice } from '@shared/types.ts';
import { api, ApiError } from '../../../api.ts';
import { Heatmap } from '../../../components/charts/Heatmap.tsx';
import { Pie, PieLegend } from '../../../components/charts/Pie.tsx';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { Panel } from '../../../components/ui/Panel.tsx';
import { formatDuration, formatShortDate } from '../../../lib/format.ts';
import { describeDay } from './describeDay.ts';
import './YearOfFocusPanel.css';

/** The ring and the day it stands for: the whole year, or one date (YYYY-MM-DD). */
type View = { kind: 'year'; year: number } | { kind: 'day'; year: number; date: string };

const HEATMAP = 'heatmap';
const message = (err: unknown) => (err instanceof ApiError && err.status !== 0 ? err.message : 'The hub didn’t answer.');
/** The year's subjects are asked for as the range it is: `range=year&date` takes any day in it. */
const subjectsPath = (view: View) => `/api/stats/subjects?range=${view.kind}&date=${view.kind === 'year' ? `${view.year}-01-01` : view.date}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The year of focus (spec §6.5): a year select, the year as a sage heatmap, and
 * a ring beside it. The ring shows the whole year until a day is hovered,
 * focused or clicked; a click pins that day and Esc releases it. Under the ring
 * is the yield's ruled tally: total hours, active days, longest and current streak.
 */
export function YearOfFocusPanel() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  // The clicked day (kept as a date, so a refetch of the year doesn't drop it) and
  // the hovered or focused one. A linger overrides a pin until the pointer or the
  // keyboard leaves the grid; Esc clears both.
  const [pinned, setPinned] = useState<string | null>(null);
  const [linger, setLinger] = useState<string | null>(null);

  const heat = useQuery({
    queryKey: [HEATMAP, String(year)],
    queryFn: ({ signal }) => api<HeatmapStats>(`/api/stats/heatmap?year=${year}`, { signal }),
  });

  // A new year opens on the whole year: last year's day isn't in this grid.
  useEffect(() => {
    setPinned(null);
    setLinger(null);
  }, [year]);

  const shown = linger ?? pinned;
  const view: View = shown === null ? { kind: 'year', year } : { kind: 'day', year, date: shown };

  // Esc releases the day wherever the keyboard is.
  useEffect(() => {
    if (pinned === null && linger === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setPinned(null);
      setLinger(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinned, linger]);

  // The Heatmap reports a hover, a focus, or a click that focuses a cell. A click
  // pins; leaving the grid drops the linger, never the pin.
  const onActiveDay = (next: HeatmapDay | null) => setLinger(next?.date ?? null);
  const onPick = (date: string) => setPinned(date);

  return (
    <Panel
      title="Year of focus"
      actions={
        <select className="yof__year" aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years(heat.data?.years ?? [], year).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      }
    >
      {heat.isError ? (
        <EmptyState
          title="Couldn’t load this year"
          line={message(heat.error)}
          action={
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void heat.refetch()}>
              Retry
            </button>
          }
        />
      ) : heat.data === undefined ? (
        <p className="yof__wait">Loading…</p>
      ) : (
        <div className="yof">
          <div className="yof__chart">
            <Heatmap year={year} days={heat.data.days} onActiveDay={onActiveDay} onPick={onPick} describe={describeDay} />
          </div>
          <div className="yof__side">
            <PieView view={view} day={view.kind === 'day' ? heat.data.days.find((d) => d.date === view.date) : undefined} pinned={pinned !== null} />
            <Tally stats={heat.data.totals} />
          </div>
        </div>
      )}
    </Panel>
  );
}

/** The years to offer: the one on screen, and every year that has focus time, newest first. */
function years(have: number[], current: number): number[] {
  return [...new Set([current, ...have])].sort((a, b) => b - a);
}

function PieView({ view, day, pinned }: { view: View; day: HeatmapDay | undefined; pinned: boolean }) {
  const path = subjectsPath(view);
  const query = useQuery({
    queryKey: ['subjects', 'year', path],
    queryFn: ({ signal }) => api<SubjectSlice[]>(path, { signal }),
  });
  const slices = query.data ?? [];
  const total = slices.reduce((sum, s) => sum + s.seconds, 0);
  const when = view.kind === 'year' ? String(view.year) : formatShortDate(view.date);

  return (
    <div className="yof__figure">
      <Pie
        size={152}
        slices={slices}
        label={view.kind === 'year' ? `Focus by subject in ${view.year}` : `Focus by subject on ${when}`}
        centerTop={formatDuration(total)}
        centerBottom={view.kind === 'year' ? 'in total' : 'focus that day'}
      />
      <p className="yof__where" aria-live="polite">
        <strong>{when}</strong>
        {/* describeDay opens with the date, which the line above already says. */}
        {day !== undefined && ` · ${describeDay(day).split(' · ').slice(1).join(' · ')}`}
        {pinned && ' · '}
        {pinned && <span className="yof__pin">pinned — Esc to release</span>}
      </p>
      <PieLegend slices={slices} />
      {query.isError && <p className="yof__where">Couldn’t load the subjects — retry</p>}
    </div>
  );
}

function Tally({ stats }: { stats: HeatmapStats['totals'] }) {
  const [hours, minutes] = wholeHoursMinutes(stats.seconds);
  return (
    <dl className="yof__tally" aria-label="Year totals">
      <div>
        <dt>Total hours</dt>
        <dd>
          {hours} h {minutes} m
        </dd>
      </div>
      <div>
        <dt>Active days</dt>
        <dd>{stats.activeDays}</dd>
      </div>
      <div>
        <dt>Longest streak</dt>
        <dd>{plural(stats.longestStreak, 'day', 'days')}</dd>
      </div>
      <div>
        <dt>Current streak</dt>
        <dd>{plural(stats.currentStreak, 'day', 'days')}</dd>
      </div>
    </dl>
  );
}

/** `4785` → `[1, 19]`, hours and whole minutes. */
function wholeHoursMinutes(seconds: number): [number, number] {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return [Math.floor(total / 3600), Math.floor(total / 60) % 60];
}
