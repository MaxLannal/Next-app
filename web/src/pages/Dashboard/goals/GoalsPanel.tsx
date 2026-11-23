import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { Goal, GoalAccuracy } from '@shared/types.ts';
import { api, ApiError } from '../../../api.ts';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { Panel } from '../../../components/ui/Panel.tsx';
import { GoalAdder } from './GoalAdder.tsx';
import { GoalRow, type GoalEdit } from './GoalRow.tsx';
import { PlanPrompt } from './PlanPrompt.tsx';
import './GoalsPanel.css';

const OPEN_KEY = ['goals', 'open'];
const DONE_KEY = ['goals', 'done'];
const ACCURACY_KEY = ['goals', 'accuracy'];
const messageOf = (err: unknown, fallback: string) => (err instanceof ApiError && err.status !== 0 ? err.message : fallback);
const ratio = (n: number) => n.toFixed(1).replace(/\.0$/, '.0');

/** "Hours ×1.4 · Dates ×1.4 · 3 goals", keeping only the figures there are and naming each count. */
export function accuracyLine(a: GoalAccuracy): string | null {
  if (a.count === 0) return null;
  const parts: string[] = [];
  if (a.hours !== null) parts.push(`Hours ×${ratio(a.hours)}`);
  if (a.dates !== null) parts.push(`Dates ×${ratio(a.dates)}`);
  parts.push(`${a.count} ${a.count === 1 ? 'goal' : 'goals'}`);
  return parts.join(' · ');
}

/**
 * Goals: press + and type one, then answer "By when? or how long?". Rows show the hours
 * against the plan, a slim bar and the projected finish; at-risk rows turn apricot. The
 * completed list folds away under the two estimate-accuracy figures.
 */
export function GoalsPanel() {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [planning, setPlanning] = useState<Goal | null>(null);
  const [creating, setCreating] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useQuery({ queryKey: OPEN_KEY, queryFn: ({ signal }) => api<Goal[]>('/api/goals?status=open', { signal }) });
  const done = useQuery({ queryKey: DONE_KEY, queryFn: ({ signal }) => api<Goal[]>('/api/goals?status=done', { signal }) });
  const accuracy = useQuery({ queryKey: ACCURACY_KEY, queryFn: ({ signal }) => api<GoalAccuracy>('/api/goals/accuracy', { signal }) });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: OPEN_KEY });
    void queryClient.invalidateQueries({ queryKey: DONE_KEY });
    void queryClient.invalidateQueries({ queryKey: ACCURACY_KEY });
  };

  const setOpenRows = (update: (rows: Goal[]) => Goal[]) =>
    queryClient.setQueryData<Goal[]>(OPEN_KEY, (rows) => update(rows ?? []));

  const create = async (title: string): Promise<boolean> => {
    setError(null);
    setCreating(true);
    try {
      const created = await api<Goal>('/api/goals', { method: 'POST', json: { title } });
      setOpenRows((rows) => [created, ...rows]);
      setPlanning(created);
      return true;
    } catch (err) {
      setError(messageOf(err, 'Couldn’t save that goal — retry'));
      return false;
    } finally {
      setCreating(false);
    }
  };

  const update = async (id: number, edit: GoalEdit): Promise<boolean> => {
    setError(null);
    try {
      const next = await api<Goal>(`/api/goals/${id}`, { method: 'PATCH', json: edit });
      if (next.status === 'open') setOpenRows((rows) => rows.map((g) => (g.id === id ? next : g)));
      else setOpenRows((rows) => rows.filter((g) => g.id !== id));
      refresh();
      return true;
    } catch (err) {
      setError(messageOf(err, edit.status !== undefined ? 'Couldn’t change that goal — retry' : 'Couldn’t save that plan — retry'));
      return false;
    }
  };

  const remove = async (id: number) => {
    setError(null);
    try {
      await api(`/api/goals/${id}`, { method: 'DELETE' });
      setOpenRows((rows) => rows.filter((g) => g.id !== id));
      refresh();
    } catch (err) {
      setError(messageOf(err, 'Couldn’t delete that goal — retry'));
    }
  };

  const openRows = open.data ?? [];
  const doneRows = done.data ?? [];
  const tally = accuracy.data === undefined ? null : accuracyLine(accuracy.data);

  return (
    <Panel title="Goals" className="goals" actions={<GoalAdder onAdd={create} busy={creating} />}>
      {error !== null && (
        <p className="goals__error" role="alert">
          {error}
        </p>
      )}

      {planning !== null && (
        <div className="goals__plan">
          <span className="goals__plan-title">{planning.title}</span>
          <PlanPrompt
            autoFocus
            onSkip={() => setPlanning(null)}
            onSave={async (plan) => {
              setPlanning(null);
              if (Object.keys(plan).length > 0) await update(planning.id, plan);
            }}
          />
        </div>
      )}

      {open.isError && openRows.length === 0 ? (
        <EmptyState
          title="Couldn’t load your goals"
          line={messageOf(open.error, 'The hub didn’t answer.')}
          action={
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void open.refetch()}>
              Retry
            </button>
          }
        />
      ) : open.isSuccess && openRows.length === 0 ? (
        <EmptyState title="No goals yet" line="Press + to add what you mean to finish, then say when or how long." />
      ) : (
        <ul className="goal-list" aria-label="Open goals">
          {openRows.map((g, i) => (
            <GoalRow key={g.id} goal={g} index={i} onUpdate={update} onRemove={remove} />
          ))}
        </ul>
      )}

      {doneRows.length > 0 && (
        <section className="goals__done">
          <button
            className="goals__fold"
            type="button"
            aria-expanded={showDone}
            aria-controls={`${fieldId}-done`}
            onClick={() => setShowDone((s) => !s)}
          >
            <span className="goals__fold-mark" aria-hidden="true">
              {showDone ? '▾' : '▸'}
            </span>
            Completed · {doneRows.length}
          </button>
          {tally !== null && <p className="goals__accuracy num">{tally}</p>}
          <ul id={`${fieldId}-done`} className="goal-list goal-list--done" aria-label="Completed goals" hidden={!showDone}>
            {doneRows.map((g, i) => (
              <GoalRow key={g.id} goal={g} index={i} done onUpdate={update} onRemove={remove} />
            ))}
          </ul>
        </section>
      )}
    </Panel>
  );
}
