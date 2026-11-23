import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { isDayKey } from '@shared/types.ts';

type PlanPromptProps = {
  /** Prefilled from the current plan when re-planning; empty for a new goal. */
  initialDeadline?: string | null;
  initialHours?: string;
  /** Only the fields typed: a blank date or hours leaves its slot out. */
  onSave: (plan: { deadline?: string; plannedMinutes?: number }) => void | Promise<void>;
  onSkip: () => void;
  autoFocus?: boolean;
};

/** The hub's local day at load, as the date field's floor: a deadline is not in the past. */
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * The inline follow-up after a goal: "By when? [date] or how long? [hours]". Enter saves
 * either or both; Esc skips. A bad day or a zero is refused in place, never sent.
 */
export function PlanPrompt({ initialDeadline = null, initialHours = '', onSave, onSkip, autoFocus = false }: PlanPromptProps) {
  const id = useId();
  const [deadline, setDeadline] = useState(initialDeadline ?? '');
  const [hours, setHours] = useState(initialHours);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) dateRef.current?.focus();
  }, [autoFocus]);

  const hoursValue = hours.trim() === '' ? null : Number(hours.replace(',', '.'));
  const badHours = hoursValue !== null && (!Number.isFinite(hoursValue) || hoursValue <= 0);
  const today = useRef(todayKey()).current;
  const badDeadline = deadline.trim() !== '' && !isDayKey(deadline.trim());
  const pastDeadline = !badDeadline && deadline.trim() !== '' && deadline.trim() < today;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (badHours || badDeadline) return;
    const plan: { deadline?: string; plannedMinutes?: number } = {};
    if (deadline.trim() !== '') plan.deadline = deadline.trim();
    if (hoursValue !== null) plan.plannedMinutes = Math.round(hoursValue * 60);
    void onSave(plan);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onSkip();
    }
  };

  return (
    <form className="goal-plan" onSubmit={submit} onKeyDown={onKeyDown} aria-label="Plan this goal">
      <span className="goal-plan__ask">By when?</span>
      <label className="visually-hidden" htmlFor={`${id}-date`}>
        By when, a date
      </label>
      <input
        ref={dateRef}
        id={`${id}-date`}
        className="goal-plan__field"
        type="date"
        min={today}
        value={deadline}
        aria-invalid={badDeadline}
        aria-describedby={pastDeadline ? `${id}-past` : undefined}
        onChange={(e) => setDeadline(e.target.value)}
      />
      <span className="goal-plan__or">or</span>
      <label className="visually-hidden" htmlFor={`${id}-hours`}>
        How long, in hours
      </label>
      <input
        id={`${id}-hours`}
        className="goal-plan__field goal-plan__field--hours"
        type="number"
        inputMode="decimal"
        min={0.25}
        step={0.25}
        placeholder="hours"
        value={hours}
        aria-invalid={badHours}
        onChange={(e) => setHours(e.target.value)}
      />
      <span className="goal-plan__unit" aria-hidden="true">
        hours
      </span>
      {pastDeadline && (
        <span className="goal-plan__hint" id={`${id}-past`}>
          That day has passed.
        </span>
      )}
      <span className="goal-plan__acts">
        <button className="btn btn-ghost btn-sm" type="submit">
          Save
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onSkip}>
          Skip
        </button>
      </span>
    </form>
  );
}
