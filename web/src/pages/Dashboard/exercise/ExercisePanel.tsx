import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import type { ExerciseKind, ExerciseReply, ExerciseSeries } from '@shared/types.ts';
import { api, ApiError } from '../../../api.ts';
import { Bars } from '../../../components/charts/Bars.tsx';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { Panel } from '../../../components/ui/Panel.tsx';
import { Tabs } from '../../../components/ui/Tabs.tsx';
import { usePaged } from '../usePager.ts';
import './ExercisePanel.css';

type Range = 'day' | 'week' | 'month' | 'year';

const KINDS: { kind: ExerciseKind; label: string; chart: string }[] = [
  { kind: 'pushups', label: 'Push-ups', chart: 'Push-ups' },
  { kind: 'squats', label: 'Squats', chart: 'Squats' },
];
const QUICK = [5, 10, 20];
const RANGES = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];
const MAX_COUNT = 10000;

/** The panel never filters by kind, so every reply carries both series. */
type FullReply = ExerciseReply & { series: Record<ExerciseKind, ExerciseSeries> };

const messageOf = (err: unknown, fallback: string) => (err instanceof ApiError && err.status !== 0 ? err.message : fallback);
const queryKey = (range: Range) => ['exercise', range];
const count = (v: number) => v.toLocaleString('en-US');
const average = (v: number) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : '0');

/** The bars' height; shorter in the dashboard's pages, where the panel has a fixed share of the screen. */
const BARS_H = 104;
const BARS_H_PAGED = 64;

/**
 * Push-ups and squats: a row per exercise with today's total and quick adds, then a small bar
 * chart each with its ruled tally. One range for both sits in the head, as Focus has its own.
 */
export function ExercisePanel() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<Range>('day');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ExerciseKind | null>(null);
  const query = useQuery({
    queryKey: queryKey(range),
    queryFn: ({ signal }) => api<FullReply>(`/api/exercise?range=${range}`, { signal }),
  });

  const rows = query.data;
  // Only a response for the range on screen draws bars; until it lands, the charts wait.
  // (After midnight a new key is fetched at once, so a stale one is never left over.)
  const series = query.isFetching ? undefined : query.data?.series;
  const today = rows === undefined ? undefined : (kind: ExerciseKind) => rows.today[kind] ?? 0;

  // Today's counts don't change with the range, so a logged set moves them in every cached range at once.
  const bump = (kind: ExerciseKind, delta: number) => {
    queryClient.setQueriesData<ExerciseReply>({ queryKey: ['exercise'] }, (reply) =>
      reply === undefined ? reply : { ...reply, today: { ...reply.today, [kind]: Math.max(0, reply.today[kind] + delta) } },
    );
  };

  // The server is the source of truth; the optimistic bump stands until this settles.
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['exercise'] });

  const log = async (kind: ExerciseKind, amount: number): Promise<boolean> => {
    setError(null);
    setBusy(kind);
    bump(kind, amount);
    try {
      await api('/api/exercise', { method: 'POST', json: { kind, count: amount } });
      void refresh();
      return true;
    } catch (err) {
      bump(kind, -amount);
      setError(messageOf(err, 'Couldn’t save that — retry'));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const undo = async (kind: ExerciseKind) => {
    setError(null);
    try {
      await api(`/api/exercise/last?kind=${kind}`, { method: 'DELETE' });
      void refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setError('Nothing logged today to undo');
      else setError(messageOf(err, 'Couldn’t undo that — retry'));
    }
  };

  const failed = query.isError && rows === undefined;
  return (
    <Panel
      title="Push-ups and squats"
      className="exercise"
      actions={failed ? undefined : <Tabs options={RANGES} value={range} onChange={(v) => setRange(v as Range)} label="Range" />}
    >
      {failed ? (
        <EmptyState
          title="Couldn’t load your sets"
          line={messageOf(query.error, 'The hub didn’t answer.')}
          action={
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void query.refetch()}>
              Retry
            </button>
          }
        />
      ) : (
        <>
          <ul className="ex-rows">
            {KINDS.map(({ kind, label }) => (
              <ExerciseRow
                key={kind}
                label={label}
                today={today?.(kind) ?? 0}
                busy={busy === kind}
                onLog={(amount) => void log(kind, amount)}
                onUndo={() => void undo(kind)}
              />
            ))}
          </ul>
          {error !== null && (
            <p className="ex-error" role="alert">
              {error}
            </p>
          )}

          <div className="ex-charts">
            {KINDS.map(({ kind, chart }) => (
              <section key={kind} className="ex-chart" aria-label={chart}>
                <h3 className="ex-chart__title">{chart}</h3>
                {series === undefined ? (
                  <p className="ex-chart__wait">Loading…</p>
                ) : (
                  <ChartBody series={series[kind]} range={range} name={chart} />
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

type RowProps = {
  label: string;
  today: number;
  busy: boolean;
  onLog: (amount: number) => void;
  onUndo: () => void;
};

function ExerciseRow({ label, today, busy, onLog, onUndo }: RowProps) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const amount = /^\d+$/.test(draft) ? Number(draft) : NaN;
  const bad = draft !== '' && !(Number.isInteger(amount) && amount >= 1 && amount <= MAX_COUNT);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!(Number.isInteger(amount) && amount >= 1 && amount <= MAX_COUNT)) return;
    onLog(amount);
    setDraft('');
  };

  return (
    <li className="ex-row" role="group" aria-label={label}>
      <span className="ex-row__main">
        <span className="ex-row__label" id={`${id}-label`}>
          {label}
        </span>
        <span className="ex-row__total">{count(today)}</span>
      </span>
      <span className="ex-row__acts">
        {QUICK.map((q) => (
          <button
            key={q}
            className="btn btn-ghost btn-sm ex-quick"
            type="button"
            aria-label={`+${q}`}
            aria-describedby={`${id}-label`}
            disabled={busy}
            onClick={() => onLog(q)}
          >
            +{q}
          </button>
        ))}
        <form className="ex-custom" onSubmit={submit}>
          <label className="visually-hidden" htmlFor={`${id}-amount`}>
            Custom amount
          </label>
          <input
            id={`${id}-amount`}
            className="ex-custom__field"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_COUNT}
            step={1}
            placeholder="Custom"
            aria-invalid={bad}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.stopPropagation();
              setDraft('');
            }}
          />
        </form>
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          aria-describedby={`${id}-label`}
          onClick={onUndo}
        >
          Undo last
        </button>
      </span>
      {busy && (
        <span className="visually-hidden" role="status">
          Saving {label.toLowerCase()}…
        </span>
      )}
    </li>
  );
}

/** One exercise's chart and tally. The panel draws this only for a kind the reply has. */
function ChartBody({ series, range, name }: { series: ExerciseSeries; range: Range; name: string }) {
  const paged = usePaged();
  if (series.total === 0) {
    return <EmptyState title="Nothing yet" line="Add a set above and the bars fill in." />;
  }
  return (
    <>
      <Bars data={series.buckets} height={paged ? BARS_H_PAGED : BARS_H} format={count} label={`${name} by ${range}`} />
      <dl className="ex-tally">
        <div>
          <dt>Total</dt>
          <dd>{count(series.total)}</dd>
        </div>
        <div>
          <dt>Daily average</dt>
          <dd>{average(series.dailyAverage)}</dd>
        </div>
      </dl>
    </>
  );
}
