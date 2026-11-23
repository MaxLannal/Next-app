import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { FocusSession, SubjectSlice } from '@shared/types.ts';
import { api, ApiError } from '../../../api.ts';
import { Pie, PieLegend } from '../../../components/charts/Pie.tsx';
import { Panel } from '../../../components/ui/Panel.tsx';
import { Tabs } from '../../../components/ui/Tabs.tsx';
import { formatDuration } from '../../../lib/format.ts';
import { SessionHistory } from './SessionHistory.tsx';
import { StartForm } from './StartForm.tsx';
import { Stopwatch } from './Stopwatch.tsx';
import { useCurrentSession, useOpenGoals, useSessionActions, useSubjects } from './useSessions.ts';
import { WrapUpSheet } from './WrapUpSheet.tsx';
import './focus.css';

type Range = 'day' | 'week' | 'month' | 'year';

const RANGES: { value: Range; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const RANGE_WORD: Record<Range, string> = { day: 'this day', week: 'this week', month: 'this month', year: 'this year' };

/**
 * Focus: the start form, the finished sessions by day beside the pie of what
 * they were about, and the wrap-up sheet on Stop (or on any row). While a
 * session is open, a stopwatch fills the panel over all of it.
 */
export function FocusPanel() {
  const { session, elapsed } = useCurrentSession();
  const actions = useSessionActions();
  const subjects = useSubjects();
  const goals = useOpenGoals();
  const [sheet, setSheet] = useState<FocusSession | null>(null);
  const [range, setRange] = useState<Range>('day');
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const pie = useQuery({
    queryKey: ['stats', 'subjects', range],
    queryFn: ({ signal }) => api<SubjectSlice[]>(`/api/stats/subjects?range=${range}`, { signal }),
  });

  const run = async (act: () => Promise<FocusSession>) => {
    setError(null);
    try {
      return await act();
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : 'The hub didn’t answer — retry');
      return null;
    }
  };

  const stop = async (id: number) => {
    const stopped = await run(() => actions.stop(id));
    if (stopped !== null) {
      setSheet(stopped);
      setVersion((v) => v + 1);
    }
  };

  const changed = () => setVersion((v) => v + 1);
  const slices = pie.data ?? [];
  const total = slices.reduce((sum, s) => sum + s.seconds, 0);

  return (
    <Panel title="Focus">
      <div className={session !== null ? 'focus focus--timing' : 'focus'}>
        {/* While a session is open the stopwatch covers the panel; on Stop it drains away. */}
        <Stopwatch
          session={session}
          elapsed={elapsed}
          onPause={() => session !== null && void run(() => actions.pause(session.id))}
          onResume={() => session !== null && void run(() => actions.resume(session.id))}
          onStop={() => session !== null && void stop(session.id)}
        />
        {session === null && <StartForm subjects={subjects} goals={goals} actions={actions} busy={false} />}
        {error !== null && (
          <p className="focus__error" role="alert">
            {error}
          </p>
        )}

        <div className="focus__split">
          <SessionHistory version={version} onOpen={(s) => setSheet(s)} />

          <section className="focus__pie" aria-label="Focus by subject">
            <div className="focus__pie-head">
              <h3 className="focus__subtitle">By subject</h3>
              <span className="focus__pie-total num">{formatDuration(total)}</span>
            </div>
            <Pie
              slices={slices}
              size={168}
              label={`Focus by subject, ${RANGE_WORD[range]}`}
              centerTop={formatDuration(total)}
              centerBottom={RANGE_WORD[range]}
            />
            <PieLegend slices={slices} />
            <Tabs options={RANGES} value={range} onChange={(v) => setRange(v as Range)} label="Range" />
          </section>
        </div>
      </div>

      {sheet !== null && (
        <WrapUpSheet
          session={sheet}
          open
          onClose={() => {
            setSheet(null);
            changed();
          }}
          onSaved={changed}
        />
      )}
    </Panel>
  );
}
