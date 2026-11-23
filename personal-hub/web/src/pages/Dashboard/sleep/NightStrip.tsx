import { useId } from 'react';
import type { SleepNight } from '@shared/types.ts';
import { formatDuration, formatShortDate } from '../../../lib/format.ts';
import './sleep.css';

type NightStripProps = {
  /** Oldest first; the last is the latest night. */
  nights: SleepNight[];
  /** The local day shown as "today", so a missing night is called out. */
  today: string;
  /** Whether today's cell has no night: it draws an apricot dot and a stub. */
  missingToday: boolean;
  /** The full strip's span in days (14). */
  days: number;
  onSelect: (night: string) => void;
  selected: string | null;
};

const HEIGHT = 56;
const BAR = 8;
const GAP = 6;
const SHORT_NIGHT = 6 * 3600;

/** The latest `days` nights of `byDay`, missing ones included, oldest first. */
export function lastDays(byDay: Map<string, SleepNight>, today: string, days: number): (SleepNight | null)[] {
  const out: (SleepNight | null)[] = [];
  const base = Date.parse(`${today}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(base - i * 86_400_000).toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? null);
  }
  return out;
}

/**
 * Dusk's strip of nights: a slim periwinkle bar per night, its height the sleep had; an apricot
 * dot above a night under 6 h; today's bar apricot when no night arrived. Keys pick a night.
 */
export function NightStrip({ nights, today, missingToday, days, onSelect, selected }: NightStripProps) {
  const titleId = useId();
  const byDay = new Map(nights.map((n) => [n.night, n]));
  const cells = lastDays(byDay, today, days).map((night, i) => {
    const day = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, night, missing: night === null && i === days - 1 && missingToday };
  });
  // A selection from outside the strip (the latest night was yesterday, say) leans on the newest
  // cell that is here, so the arrow keys always move from something visible.
  const anchor = cells.some((c) => c.day === selected) ? selected : ([...cells].reverse().find((c) => c.night !== null)?.day ?? null);
  const max = Math.max(8 * 3600, ...nights.map((n) => n.asleepSeconds));
  const width = cells.length * (BAR + GAP) - GAP;
  const scale = (seconds: number) => Math.max(seconds > 0 ? 2 : 0, (seconds / max) * HEIGHT);

  const move = (index: number) => {
    const cell = cells[index];
    if (!cell) return;
    onSelect(cell.day);
  };

  return (
    <div className="nights">
      <p className="nights__label" id={titleId}>
        Last {days} nights
      </p>
      <svg
        className="nights__svg"
        role="group"
        aria-labelledby={titleId}
        width={width}
        height={HEIGHT + (12 + 4)}
        tabIndex={0}
        aria-label={`Nights: ${cells.filter((c) => c.night).length} of ${days} recorded`}
        onKeyDown={(e) => {
          const at = cells.findIndex((c) => c.day === anchor);
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            move(Math.min(cells.length - 1, at + 1));
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            move(Math.max(0, at - 1));
          }
        }}
      >
        {cells.map((c, i) => {
          const x = i * (BAR + GAP);
          const asleep = c.night?.asleepSeconds ?? 0;
          const h = scale(asleep);
          const short = c.night !== null && asleep < SHORT_NIGHT;
          return (
            <g key={c.day} data-day={c.day} data-night={c.night ? 'yes' : 'no'}>
              <title>
                {c.night
                  ? `${formatShortDate(c.day)} · ${formatDuration(asleep)} asleep${short ? ' · under 6 h' : ''}`
                  : `${formatShortDate(c.day)} · no night recorded`}
              </title>
              {(short || c.missing) && <circle className="nights__dot" cx={x + BAR / 2} cy={5} r={3} />}
              <rect className="nights__track" x={x} y={12} width={BAR} height={HEIGHT} rx={BAR / 2} />
              {c.night && (
                <rect
                  className={anchor === c.day ? 'nights__bar is-selected' : 'nights__bar'}
                  x={x}
                  y={12 + HEIGHT - h}
                  width={BAR}
                  height={h}
                  rx={BAR / 2}
                />
              )}
              {c.missing && <rect className="nights__missing" x={x} y={12 + HEIGHT - 3} width={BAR} height={3} rx={1.5} />}
              <rect
                className="nights__hit"
                x={x - GAP / 2}
                y={0}
                width={BAR + GAP}
                height={12 + HEIGHT}
                role="button"
                tabIndex={-1}
                aria-label={`${formatShortDate(c.day)}${c.night ? `, ${formatDuration(asleep)} asleep` : ', no night recorded'}`}
                onClick={() => onSelect(c.day)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
