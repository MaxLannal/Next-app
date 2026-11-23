import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEventHandler } from 'react';
import type { Goal } from '@shared/types.ts';
import { formatDayShort, formatHours, formatShortDate } from '../../../lib/format.ts';
import { PlanPrompt } from './PlanPrompt.tsx';

export type GoalEdit = { title?: string; deadline?: string | null; plannedMinutes?: number | null; status?: Goal['status'] };
type Mode = 'view' | 'rename' | 'replan' | 'confirm' | 'menu';

/** What an open row needs to be ranked: dragged by pointer, or moved by its grip's arrow keys. */
export type GoalRank = {
  handlers: {
    onPointerDown: PointerEventHandler<HTMLElement>;
    onPointerMove: PointerEventHandler<HTMLElement>;
    onPointerUp: PointerEventHandler<HTMLElement>;
    onPointerCancel: PointerEventHandler<HTMLElement>;
  };
  style: CSSProperties | undefined;
  dragging: boolean;
  onGripKey: (e: KeyboardEvent<HTMLButtonElement>) => void;
  /** The id of the line saying how to rank. */
  hintId: string;
};

type GoalRowProps = {
  goal: Goal;
  index: number;
  /** Done rows show what it took against the original plan, not the live bar. */
  done?: boolean;
  /** Open rows can be ranked. */
  rank?: GoalRank;
  onUpdate: (id: number, edit: GoalEdit) => Promise<boolean>;
  onRemove: (id: number) => Promise<void>;
};

const hours = (seconds: number) => formatHours(seconds);

/** "Projected 26 Nov", "Due 2 Dec", "No recent pace", or nothing for an unplanned goal. */
export function finishLine(goal: Goal): { text: string; tone: 'risk' | 'quiet' | 'plain' } | null {
  const { progress } = goal;
  if (progress.mode === 'none') return null;
  if (progress.noRecentPace) return { text: 'No recent pace', tone: 'quiet' };
  if (progress.projectedFinish !== null) return { text: `Projected ${formatDayShort(progress.projectedFinish)}`, tone: 'plain' };
  if (goal.deadline !== null) return { text: `Due ${formatDayShort(goal.deadline)}`, tone: progress.atRisk ? 'risk' : 'plain' };
  return null;
}

/** One plan line: "6 h / 10 h" for an hours plan, "6 h focused" for a deadline-only one. */
export function planLine(goal: Goal): string {
  const focused = hours(goal.focusedSeconds);
  return goal.plannedMinutes === null ? `${focused} focused` : `${focused} / ${hours(goal.plannedMinutes * 60)}`;
}

export function GoalRow({ goal, index, done = false, rank, onUpdate, onRemove }: GoalRowProps) {
  const titleId = useId();
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const lastMode = useRef<Mode>(mode);

  // Keep focus on the row as its controls swap: into the new panel, and back when it closes.
  useEffect(() => {
    if (mode === 'rename') renameRef.current?.focus();
    else if (mode === 'confirm') keepRef.current?.focus();
    else if (mode === 'view' && lastMode.current === 'confirm') deleteRef.current?.focus();
    lastMode.current = mode;
  }, [mode]);

  const save = async (edit: GoalEdit) => {
    setBusy(true);
    try {
      return await onUpdate(goal.id, edit);
    } finally {
      setBusy(false);
    }
  };

  const style = { '--d': Math.min(index, 8), ...rank?.style } as CSSProperties;
  const { progress } = goal;
  const line = finishLine(goal);
  const barLabel = progress.fractionKind === 'time' ? 'Time elapsed' : 'Work done';
  const fraction = progress.fraction ?? 0;
  const classes = ['goal', 'rise', done ? 'is-done' : '', progress.atRisk && !done ? 'is-risk' : '', rank?.dragging ? 'is-dragging' : '']
    .filter(Boolean)
    .join(' ');
  const plannedSeconds = goal.plannedMinutes === null ? null : goal.plannedMinutes * 60;

  const tick = (e: { key: string; preventDefault: () => void }, close: () => void) => {
    if (e.key === 'Escape') {
      close();
      e.preventDefault();
    }
  };

  return (
    <li className={classes} style={style} aria-labelledby={titleId} {...rank?.handlers}>
      {rank !== undefined && (
        <button className="goal__grip" type="button" data-grip={goal.id} aria-label={`Move ${goal.title}`} aria-describedby={rank.hintId} onKeyDown={rank.onGripKey}>
          <svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor" aria-hidden="true">
            <circle cx="2.5" cy="3" r="1.4" />
            <circle cx="7.5" cy="3" r="1.4" />
            <circle cx="2.5" cy="8" r="1.4" />
            <circle cx="7.5" cy="8" r="1.4" />
            <circle cx="2.5" cy="13" r="1.4" />
            <circle cx="7.5" cy="13" r="1.4" />
          </svg>
        </button>
      )}
      <div className="goal__main">
        {mode === 'rename' ? (
          <form
            className="goal__rename"
            onSubmit={(e) => {
              e.preventDefault();
              const value = renameRef.current?.value.trim() ?? '';
              if (value === '') return;
              void save({ title: value }).then((ok) => ok && setMode('view'));
            }}
            onKeyDown={(e) => tick(e, () => setMode('view'))}
          >
            <label className="visually-hidden" htmlFor={`${titleId}-title`}>
              Goal title
            </label>
            <input ref={renameRef} id={`${titleId}-title`} className="goal__field" defaultValue={goal.title} aria-label="Goal title" />
          </form>
        ) : (
          <p className="goal__title" id={titleId}>
            {goal.title}
          </p>
        )}
        <p className="goal__facts">
          <span className="goal__hours num">{done ? actualLine(goal) : planLine(goal)}</span>
          {!done && line !== null && (
            <span className={line.tone === 'risk' ? 'goal__finish is-risk' : 'goal__finish num'}>
              {line.tone === 'plain' || line.tone === 'risk' ? <span className="goal__finish-num">{line.text}</span> : line.text}
            </span>
          )}
          {done && goal.doneAt !== null && <span className="goal__finish num">Finished {formatShortDate(goal.doneAt)}</span>}
        </p>
        {!done && (
          <div
            className={`goal__bar goal__bar--${progress.fractionKind ?? 'none'}`}
            role="progressbar"
            aria-label={barLabel}
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={Math.round(fraction * 1000) / 1000}
            aria-valuetext={`${Math.round(fraction * 100)}%`}
          >
            <span className="goal__fill" style={{ transform: `scaleX(${fraction})` }} />
          </div>
        )}
        {plannedSeconds !== null && done && (
          <p className="goal__sub">
            {goal.originalPlannedMinutes === null ? 'No original plan' : `Planned ${hours(goal.originalPlannedMinutes * 60)}`}
            {goal.originalDeadline !== null && ` · Due ${formatDayShort(goal.originalDeadline)}`}
          </p>
        )}
      </div>

      {mode === 'replan' ? (
        <PlanPrompt
          initialDeadline={goal.deadline}
          initialHours={goal.plannedMinutes === null ? '' : String(goal.plannedMinutes / 60)}
          autoFocus
          onSkip={() => setMode('view')}
          onSave={async (plan) => {
            if (await save(plan)) setMode('view');
          }}
        />
      ) : mode === 'confirm' ? (
        <span className="goal__acts" onKeyDown={(e) => tick(e, () => setMode('view'))}>
          <span className="goal__ask">Delete?</span>
          <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void onRemove(goal.id)}>
            Yes, delete
          </button>
          <button ref={keepRef} className="btn btn-ghost btn-sm" type="button" onClick={() => setMode('view')}>
            Keep
          </button>
        </span>
      ) : mode === 'rename' ? null : (
        <span className="goal__acts">
          {!done && (
            <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void save({ status: 'done' })}>
              Done
            </button>
          )}
          <button
            className="goal__more"
            type="button"
            aria-label="More actions"
            aria-haspopup="true"
            aria-expanded={mode === 'menu'}
            onClick={() => setMode(mode === 'menu' ? 'view' : 'menu')}
          >
            ⋯
          </button>
          {mode === 'menu' && (
            <span className="goal__menu" role="group" aria-label={`Actions for ${goal.title}`} onKeyDown={(e) => tick(e, () => setMode('view'))}>
              <button
                className="goal__menu-item"
                type="button"
                onClick={() => {
                  setMode('rename');
                  renameRef.current?.focus();
                }}
              >
                Rename
              </button>
              {!done && (
                <button className="goal__menu-item" type="button" onClick={() => setMode('replan')}>
                  Re-plan
                </button>
              )}
              <button className="goal__menu-item" type="button" disabled={busy} onClick={() => void save({ status: 'archived' })}>
                Archive
              </button>
              <button ref={deleteRef} className="goal__menu-item" type="button" onClick={() => setMode('confirm')}>
                Delete
              </button>
            </span>
          )}
        </span>
      )}
    </li>
  );
}

/** A done goal's actual hours against its original plan: "12 h of 10 h", or "12 h focused". */
function actualLine(goal: Goal): string {
  const actual = hours(goal.focusedSeconds);
  return goal.originalPlannedMinutes === null ? `${actual} focused` : `${actual} of ${hours(goal.originalPlannedMinutes * 60)}`;
}
