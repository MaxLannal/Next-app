import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { SleepNight } from '@shared/types.ts';
import { api, ApiError } from '../../../api.ts';
import { StackedBar } from '../../../components/charts/StackedBar.tsx';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { Panel } from '../../../components/ui/Panel.tsx';
import { formatDuration, formatShortDate, formatTime } from '../../../lib/format.ts';
import { lastDays, NightStrip } from './NightStrip.tsx';
import './sleep.css';

type SleepReply = { nights: SleepNight[]; lastNight: SleepNight | null; lastSyncAt: string | null };

const QUERY_KEY = ['sleep'];
const STRIP_DAYS = 14;
/** The strip shows 14 nights plus the one picked, so ask for a year and keep every pick reachable. */
const ASKED_NIGHTS = 366;

/** The stages as one bar, on the periwinkle ramp; awake is muted, as the brief asks. */
const STAGE_PARTS = [
  { label: 'Deep', color: 'oklch(66% 0.10 274)' },
  { label: 'Core', color: 'oklch(77% 0.10 274)' },
  { label: 'REM', color: 'oklch(84% 0.085 274)' },
  { label: 'Awake', color: 'var(--color-muted)' },
] as const;

/** Today's day key, in the browser's zone, which on the Mac is the hub's. */
const todayKey = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const messageOf = (err: unknown) => (err instanceof ApiError && err.status !== 0 ? err.message : 'The hub didn’t answer.');

/**
 * Last night in full: bedtime → wake, total, score and the stages as one bar; below it, the strip
 * of the last 14 nights. Click a night to see its figures. No data: a calm "Connect your iPhone".
 */
export function SleepPanel() {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => api<SleepReply>(`/api/sleep?nights=${ASKED_NIGHTS}`, { signal }),
  });
  const [picked, setPicked] = useState<string | null>(null);
  const [today, setToday] = useState(todayKey);
  // The day rolls over at midnight; the strip should follow.
  useEffect(() => {
    const timer = setInterval(() => setToday(todayKey()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const nights = query.data?.nights ?? [];
  const byDay = useMemo(() => new Map(nights.map((n) => [n.night, n])), [nights]);
  const latest = query.data?.lastNight ?? null;
  const shown = (picked !== null ? byDay.get(picked) : null) ?? latest;
  // Today's night is missing when the strip's last cell has none: the strip says so in apricot.
  const strip = lastDays(byDay, today, STRIP_DAYS);

  return (
    <Panel title="Sleep" className="sleep" actions={lastSynced(query.data?.lastSyncAt ?? null)}>
      {query.isError && nights.length === 0 ? (
        <EmptyState
          title="Couldn’t load your sleep"
          line={messageOf(query.error)}
          action={
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void query.refetch()}>
              Retry
            </button>
          }
        />
      ) : query.isSuccess && nights.length === 0 ? (
        <EmptyState
          title="Connect your iPhone"
          line="The Sleep Shortcut sends last night’s stages here each morning. Set it up once in Settings."
          action={
            <a className="btn btn-ghost btn-sm" href="/settings#sleep">
              Open Settings
            </a>
          }
        />
      ) : shown !== null ? (
        <>
          <Night night={shown} />
          <NightStrip
            nights={nights}
            today={today}
            missingToday={strip[strip.length - 1] === null}
            days={STRIP_DAYS}
            selected={picked ?? latest?.night ?? null}
            onSelect={setPicked}
          />
        </>
      ) : (
        <span aria-busy="true" />
      )}
    </Panel>
  );
}

/** When the last sleep data arrived, in Dusk's calm voice. */
function lastSynced(at: string | null) {
  if (at === null) return undefined;
  return (
    <span className="sleep__source">
      Last synced {formatShortDate(at)} {formatTime(at)}
    </span>
  );
}

/** One night: when, how long, its score, and its stages. */
export function Night({ night }: { night: SleepNight }) {
  const { awake, rem, core, deep, unspecified } = night.stages;
  const values: Record<string, number> = { Deep: deep, Core: core + unspecified, REM: rem, Awake: awake };
  const parts = STAGE_PARTS.map((p) => ({ label: p.label, value: values[p.label] ?? 0, color: p.color }));
  const short = night.asleepSeconds < 6 * 3600;
  return (
    <div className="sleep__night" data-night={night.night}>
      <p className="sleep__when">
        <span className="sleep__clock">
          {formatTime(night.bedtime)} → {formatTime(night.wake)}
        </span>
        <span>{formatShortDate(night.night)}</span>
      </p>
      <p className="sleep__figures">
        <span className="sleep__total">{formatDuration(night.asleepSeconds)}</span>
        <span className={short ? 'sleep__score is-short' : 'sleep__score'}>
          <b>{night.score}</b> <span className="c">of 100</span>
        </span>
      </p>
      <StackedBar parts={parts} label={`Stages for the night of ${formatShortDate(night.night)}`} />
      <p className="sleep__source">{night.source === '' ? 'Unknown source' : night.source}</p>
    </div>
  );
}
