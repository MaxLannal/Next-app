import type { HeatmapDay } from '@shared/types.ts';
import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { HEAT_COLORS } from './colors.ts';
import './charts.css';

type HeatmapProps = {
  year: number;
  /** Days with data; any day of the year missing here is drawn empty. */
  days: HeatmapDay[];
  /** The hovered day, else the focused one, else null; called when that changes. */
  onActiveDay: (day: HeatmapDay | null) => void;
  /** One line per day, for the tooltip and the cell's accessible name. */
  describe: (day: HeatmapDay) => string;
  /** Names the grid for screen readers. */
  label?: string;
};

const CELL = 11;
const PITCH = CELL + 3;
/** Room for the Mon/Wed/Fri labels and the month labels. */
const LEFT = 30;
const TOP = 18;
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROW_LABELS: [number, string][] = [
  [0, 'Mon'],
  [2, 'Wed'],
  [4, 'Fri'],
];
/** Columns this close to either end align the tooltip to that side. */
const EDGE_COLS = 8;

type Cell = { day: HeatmapDay; col: number; row: number };

/** Every day of `year` in Monday-first week columns; column 0 holds 1 January. */
function layout(year: number, days: HeatmapDay[]) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const start = Date.UTC(year, 0, 1);
  const lead = (new Date(start).getUTCDay() + 6) % 7;
  const cells: Cell[] = [];
  for (let t = start; new Date(t).getUTCFullYear() === year; t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    const slot = cells.length + lead;
    cells.push({ day: byDate.get(date) ?? { date, seconds: 0, level: 0, subjects: [] }, col: Math.floor(slot / 7), row: slot % 7 });
  }
  const months = MONTHS.map((name, m) => ({ name, col: Math.floor(((Date.UTC(year, m, 1) - start) / DAY_MS + lead) / 7) }));
  const rows: Cell[][] = Array.from({ length: 7 }, () => []);
  for (const cell of cells) rows[cell.row]?.push(cell);
  const weeks = (cells[cells.length - 1]?.col ?? 0) + 1;
  return { cells, rows, months, weeks, index: new Map(cells.map((c, i) => [c.day.date, i])) };
}

const dateOf = (target: EventTarget | null) =>
  target instanceof Element ? (target.closest('[data-date]')?.getAttribute('data-date') ?? null) : null;

/**
 * A year of focus like GitHub's: 53 week columns × 7 weekday rows of 11 px
 * cells in sage (the one place sage appears; spec §3), with month and Mon/Wed/Fri
 * labels. One cell is in the tab order at a time; arrows move a day (up/down)
 * or a week (left/right), Home and End jump to the year's ends. Hover or focus
 * shows `describe(day)` in a tooltip and reports the day through `onActiveDay`.
 */
export function Heatmap({ year, days, onActiveDay, describe, label }: HeatmapProps) {
  const { cells, rows, months, weeks, index } = useMemo(() => layout(year, days), [year, days]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [stop, setStop] = useState<string | null>(null);
  const [scrollX, setScrollX] = useState(0);

  const tabStop = stop !== null && index.has(stop) ? stop : (cells[0]?.day.date ?? null);
  const activeDate = hovered ?? focused;
  const active = activeDate !== null ? cells[index.get(activeDate) ?? -1] : undefined;
  const activeDay = active?.day ?? null;

  // Report changes only: not the initial null and not every re-render. Compared
  // by content, so a parent passing a fresh `days` array each render can't loop.
  const reported = useRef('null');
  useEffect(() => {
    const key = JSON.stringify(activeDay);
    if (reported.current === key) return;
    reported.current = key;
    onActiveDay(activeDay);
  });

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const from = index.get(dateOf(e.target) ?? '');
    if (from === undefined) return;
    const last = cells.length - 1;
    const to =
      e.key === 'ArrowRight' ? from + 7
      : e.key === 'ArrowLeft' ? from - 7
      : e.key === 'ArrowDown' ? from + 1
      : e.key === 'ArrowUp' ? from - 1
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (to === null) return;
    e.preventDefault();
    const date = cells[to]?.day.date;
    if (date !== undefined) svgRef.current?.querySelector<SVGElement>(`[data-date="${date}"]`)?.focus();
  };

  const onFocus = (e: FocusEvent<SVGSVGElement>) => {
    const date = dateOf(e.target);
    if (date === null) return;
    setFocused(date);
    setStop(date);
  };

  const onMouseOver = (e: MouseEvent<SVGSVGElement>) => {
    // Crossing the gaps between cells keeps the last day rather than flickering.
    const date = dateOf(e.target);
    if (date !== null) setHovered(date);
  };

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    if (e.target instanceof SVGElement && e.target.matches('[data-date]')) e.target.focus();
  };

  return (
    <div className="heatmap">
      <div className="heatmap__scroll" onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}>
        <svg
          ref={svgRef}
          role="grid"
          aria-label={label ?? `Days of ${year}`}
          aria-rowcount={7}
          aria-colcount={weeks}
          width={LEFT + weeks * PITCH - (PITCH - CELL)}
          height={TOP + 7 * PITCH - (PITCH - CELL)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={() => setFocused(null)}
          onMouseOver={onMouseOver}
          onMouseLeave={() => setHovered(null)}
          onClick={onClick}
        >
          <g aria-hidden="true">
            {months.map((m) => (
              <text key={m.name} className="chart-axis" x={LEFT + m.col * PITCH} y={TOP - 6}>
                {m.name}
              </text>
            ))}
            {ROW_LABELS.map(([row, text]) => (
              <text key={text} className="chart-axis" x={LEFT - 6} y={TOP + row * PITCH + CELL / 2} textAnchor="end" dominantBaseline="central">
                {text}
              </text>
            ))}
          </g>
          {rows.map((row, r) => (
            <g key={r} role="row" aria-rowindex={r + 1}>
              {row.map(({ day, col }) => (
                <rect
                  key={day.date}
                  data-date={day.date}
                  className="heatmap__cell"
                  role="gridcell"
                  aria-colindex={col + 1}
                  aria-label={describe(day)}
                  tabIndex={day.date === tabStop ? 0 : -1}
                  x={LEFT + col * PITCH}
                  y={TOP + r * PITCH}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  style={{ fill: HEAT_COLORS[day.level] }}
                />
              ))}
            </g>
          ))}
        </svg>
      </div>
      {active && (
        <div
          className={`chart-tip${active.col < EDGE_COLS ? ' is-start' : active.col >= weeks - EDGE_COLS ? ' is-end' : ''}`}
          style={{ left: LEFT + active.col * PITCH + CELL / 2 - scrollX, top: TOP + active.row * PITCH }}
          aria-hidden="true"
        >
          {describe(active.day)}
        </div>
      )}
    </div>
  );
}
