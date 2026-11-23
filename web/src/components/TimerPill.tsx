import type { FocusSession } from '@shared/types.ts';
import { formatClock } from '../lib/format.ts';
import { FixedDigits } from './ui/FixedDigits.tsx';
import './TimerPill.css';

type TimerPillProps = {
  session: FocusSession;
  /** Whole seconds of focus, ticked by the caller. */
  elapsed: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
};

/**
 * The running session in the nav: a breathing dot, the subject or the name,
 * and the clock in fixed-digit cells. Periwinkle while it runs, apricot while
 * it waits. When the Mac slept, the line says so and Resume takes it on.
 */
export function TimerPill({ session, elapsed, onPause, onResume, onStop }: TimerPillProps) {
  const asleep = session.autoPausedAt !== null;
  const paused = asleep || session.status === 'paused';
  const where = session.subject?.name ?? session.name;
  const clock = formatClock(elapsed);

  return (
    <div className={paused ? 'timer timer--paused' : 'timer'} role="group" aria-label={`Focus: ${where}`}>
      {asleep && <span className="visually-hidden">Paused while your Mac slept.</span>}
      <span className="timer__dot" aria-hidden="true" />
      {asleep ? (
        <span className="timer__slept">Paused while your Mac slept</span>
      ) : (
        <span className="timer__where">{where}</span>
      )}
      <span className="timer__clock" role="timer" aria-label={clock} aria-live="off">
        <FixedDigits text={clock} />
      </span>
      <span className="timer__acts">
        {paused ? (
          <button className="timer__key" type="button" aria-label="Resume" onClick={onResume}>
            {asleep ? 'Resume' : <span aria-hidden="true">▶</span>}
          </button>
        ) : (
          <button className="timer__key" type="button" aria-label="Pause" onClick={onPause}>
            <span aria-hidden="true">‖</span>
          </button>
        )}
        <button className="timer__key" type="button" aria-label="Stop" onClick={onStop}>
          <span aria-hidden="true">■</span>
        </button>
      </span>
    </div>
  );
}
