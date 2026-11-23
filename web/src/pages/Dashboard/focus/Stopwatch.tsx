import { useEffect, useRef, useState } from 'react';
import type { FocusSession } from '@shared/types.ts';
import { FixedDigits } from '../../../components/ui/FixedDigits.tsx';
import { formatClock } from '../../../lib/format.ts';

type StopwatchProps = {
  /** The open session, or null once it has stopped (the stopwatch then drains away). */
  session: FocusSession | null;
  /** Whole seconds of focus, ticked by the caller. */
  elapsed: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
};

const R = 96;
const CIRCUMFERENCE = 2 * Math.PI * R;
/** How long the drain takes; matches `stopwatch-drain` in focus.css. */
const DRAIN_MS = 520;
const TICKS = Array.from({ length: 60 }, (_, i) => i);

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * While a session is open, a stopwatch fills the Focus panel: a dial whose ring sweeps once a
 * minute around the running time, with Pause (or Resume) and Stop. Periwinkle while it runs,
 * apricot while it waits. When the session stops it drains away and the panel shows again.
 */
export function Stopwatch({ session, elapsed, onPause, onResume, onStop }: StopwatchProps) {
  // The last open session, kept for the drain after it stops.
  const [shown, setShown] = useState<{ session: FocusSession; elapsed: number } | null>(
    session === null ? null : { session, elapsed },
  );
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (session !== null) {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      setLeaving(false);
      setShown({ session, elapsed });
      return;
    }
    if (shown === null || timer.current !== null) return;
    setLeaving(true);
    timer.current = setTimeout(() => {
      setShown(null);
      setLeaving(false);
      timer.current = null;
    }, reducedMotion() ? 0 : DRAIN_MS);
    // `shown` is read only to know whether there is anything to drain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, elapsed]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  // While the session is open, draw the time handed in this render, the same figure as the rail's
  // clock; the kept copy is only for the drain after it stops.
  const view = session !== null ? { session, elapsed } : shown;
  if (view === null) return null;

  const current = view.session;
  const seconds = view.elapsed;
  const asleep = current.autoPausedAt !== null;
  const paused = asleep || current.status === 'paused';
  const where = current.subject?.name ?? current.name;
  const clock = formatClock(seconds);
  // The ring restarts each minute: a new key per lap, so it never sweeps backwards.
  const lap = Math.floor(seconds / 60);
  const offset = CIRCUMFERENCE * (1 - (seconds % 60) / 60);
  const draining = leaving && session === null;
  const state = draining ? 'leaving' : paused ? 'paused' : 'running';

  return (
    <div className="stopwatch" data-state={state} role="group" aria-label={`Focus: ${where}`}>
      <div className="stopwatch__dial">
        <svg className="stopwatch__ring" viewBox="0 0 220 220" aria-hidden="true">
          <g className="stopwatch__ticks">
            {TICKS.map((i) => (
              <line
                key={i}
                x1="110"
                y1={i % 5 === 0 ? 3 : 6}
                x2="110"
                y2="10"
                transform={`rotate(${i * 6} 110 110)`}
                className={i % 5 === 0 ? 'is-major' : undefined}
              />
            ))}
          </g>
          <circle className="stopwatch__track" cx="110" cy="110" r={R} />
          <circle
            key={lap}
            className="stopwatch__sweep"
            cx="110"
            cy="110"
            r={R}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform="rotate(-90 110 110)"
          />
        </svg>
        <div className="stopwatch__face">
          <span className="stopwatch__where">{where}</span>
          <span className="stopwatch__time" role="timer" aria-label={clock} aria-live="off">
            <FixedDigits text={clock} />
          </span>
          <span className="stopwatch__state">{asleep ? 'Paused while your Mac slept' : paused ? 'Paused' : 'Focusing'}</span>
        </div>
      </div>
      <div className="stopwatch__keys">
        {paused ? (
          <button className="stopwatch__key stopwatch__key--go" type="button" aria-label="Resume" onClick={onResume} disabled={draining}>
            <span aria-hidden="true">▶</span> Resume
          </button>
        ) : (
          <button className="stopwatch__key" type="button" aria-label="Pause" onClick={onPause} disabled={draining}>
            <span aria-hidden="true">‖</span> Pause
          </button>
        )}
        <button className="stopwatch__key" type="button" aria-label="Stop" onClick={onStop} disabled={draining}>
          <span aria-hidden="true">■</span> Stop
        </button>
      </div>
    </div>
  );
}
