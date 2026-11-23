import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
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

/** How long the liquid takes to drain back into the +; matches `pour-drain` in focus.css. */
const DRAIN_MS = 420;
/** The + is 40 px across: the liquid starts as that circle and grows from it. */
const PLUS_RADIUS = 20;

/** Where the liquid pours from (the + centre, in the panel), how far it grows, and where its drops run. */
type Pour = { state: 'open' | 'closing'; settled: boolean; x: number; y: number; grow: number; dx: number; dy: number };

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Focus: the finished sessions by day beside the pie of what they were about, the range in the
 * head, and a + that pours the start form over the whole panel. While a session is open, a
 * stopwatch fills the panel; on Stop (or on any row) the wrap-up sheet opens.
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
  const [pour, setPour] = useState<Pour | null>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const drain = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gooId = `${useId().replace(/:/g, '')}-goo`;

  useEffect(
    () => () => {
      if (drain.current !== null) clearTimeout(drain.current);
    },
    [],
  );

  const pie = useQuery({
    queryKey: ['stats', 'subjects', range],
    queryFn: ({ signal }) => api<SubjectSlice[]>(`/api/stats/subjects?range=${range}`, { signal }),
  });

  const openPour = () => {
    const plus = plusRef.current;
    const panel = plus?.closest('section');
    if (!plus || !panel) return;
    const p = plus.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const x = p.left + p.width / 2 - box.left;
    const y = p.top + p.height / 2 - box.top;
    // Far enough to reach the corner farthest from the +, so the liquid covers the panel.
    const reach = Math.max(Math.hypot(x, y), Math.hypot(box.width - x, y), Math.hypot(x, box.height - y), Math.hypot(box.width - x, box.height - y));
    if (drain.current !== null) clearTimeout(drain.current);
    drain.current = null;
    setPour({ state: 'open', settled: reducedMotion(), x, y, grow: reach / PLUS_RADIUS + 1, dx: -x, dy: box.height - y });
  };

  const closePour = (focusPlus: boolean) => {
    setPour((p) => (p === null ? null : { ...p, state: 'closing', settled: false }));
    if (drain.current !== null) clearTimeout(drain.current);
    drain.current = setTimeout(
      () => {
        drain.current = null;
        setPour(null);
      },
      reducedMotion() ? 0 : DRAIN_MS,
    );
    if (focusPlus) plusRef.current?.focus();
  };

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
  const open = pour?.state === 'open';

  return (
    <Panel
      title="Focus"
      className="focus-panel"
      actions={
        <>
          <Tabs options={RANGES} value={range} onChange={(v) => setRange(v as Range)} label="Range" />
          {session === null && (
            <button
              ref={plusRef}
              className={open ? 'pour-plus is-open' : 'pour-plus'}
              type="button"
              aria-label={open ? 'Close the new session' : 'New focus session'}
              aria-expanded={open}
              onClick={() => (open ? closePour(true) : openPour())}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
        </>
      }
    >
      {/* While a session is open the stopwatch covers the panel; on Stop it drains away. */}
      <Stopwatch
        session={session}
        elapsed={elapsed}
        onPause={() => session !== null && void run(() => actions.pause(session.id))}
        onResume={() => session !== null && void run(() => actions.resume(session.id))}
        onStop={() => session !== null && void stop(session.id)}
      />

      <div className="focus">
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
              size={128}
              label={`Focus by subject, ${RANGE_WORD[range]}`}
              centerTop={formatDuration(total)}
              centerBottom={RANGE_WORD[range]}
            />
            <PieLegend slices={slices} />
          </section>
        </div>
      </div>

      {/* The + pours out: a circle of its own liquid grows over the panel with two drops running
          ahead, melted together by the goo filter, and the start form surfaces on it. */}
      {pour !== null && (
        <div
          className="pour"
          data-state={pour.state}
          style={{ '--ox': `${pour.x}px`, '--oy': `${pour.y}px`, '--grow': pour.grow, '--dx': `${pour.dx}px`, '--dy': `${pour.dy}px` } as CSSProperties}
        >
          <svg className="pour__defs" width="0" height="0" aria-hidden="true" focusable="false">
            <filter id={gooId}>
              <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
              <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" result="goo" />
              <feComposite in="SourceGraphic" in2="goo" operator="atop" />
            </filter>
          </svg>
          <div className="pour__liquid" style={pour.settled ? undefined : { filter: `url(#${gooId})` }} aria-hidden="true">
            <span
              className="pour__fill"
              onAnimationEnd={(e) => {
                if (e.animationName === 'pour-fill') setPour((p) => (p === null || p.state !== 'open' ? p : { ...p, settled: true }));
              }}
            />
            <span className="pour__drop pour__drop--a" />
            <span className="pour__drop pour__drop--b" />
          </div>
          <div className="pour__body">
            <h3 className="pour__title">New session</h3>
            <StartForm
              subjects={subjects}
              goals={goals}
              actions={actions}
              busy={false}
              autoFocus
              onStarted={() => closePour(false)}
              onCancel={() => closePour(true)}
            />
          </div>
        </div>
      )}

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
