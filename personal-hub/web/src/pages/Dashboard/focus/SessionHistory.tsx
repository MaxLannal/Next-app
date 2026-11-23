import { useQuery } from '@tanstack/react-query';
import type { FocusSession } from '@shared/types.ts';
import { api } from '../../../api.ts';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { formatDuration, formatShortDate, formatTime, localDay } from '../../../lib/format.ts';
import './focus.css';

/** The panel's list length; the Database page keeps the rest. */
const HISTORY_LIMIT = 7;
const HISTORY_KEY = `/api/sessions?limit=${HISTORY_LIMIT}`;

type DayGroup = { day: string; total: number; sessions: FocusSession[] };

/** The finished sessions, newest first, batched by their start day with that day's total. */
function byDay(sessions: FocusSession[]): DayGroup[] {
  const days = new Map<string, DayGroup>();
  for (const session of sessions) {
    if (session.status !== 'done') continue;
    const key = localDay(session.startedAt);
    const group = days.get(key) ?? { day: key, total: 0, sessions: [] };
    group.total += session.focusSeconds;
    group.sessions.push(session);
    days.set(key, group);
  }
  return [...days.values()];
}

type SessionHistoryProps = {
  onOpen: (session: FocusSession) => void;
  /** Bumped to re-read the list after a change elsewhere in the panel. */
  version: number;
};

/** Finished sessions, a ruled list per day with the day's total above it. A row opens the wrap-up. */
export function SessionHistory({ onOpen, version }: SessionHistoryProps) {
  const query = useQuery({
    queryKey: ['sessions', 'history', version],
    queryFn: ({ signal }) => api<FocusSession[]>(HISTORY_KEY, { signal }),
  });

  if (query.isError) {
    return (
      <EmptyState
        title="Couldn’t load your sessions"
        line="The hub didn’t answer."
        action={
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void query.refetch()}>
            Retry
          </button>
        }
      />
    );
  }

  const groups = byDay(query.data ?? []);
  if (query.data !== undefined && groups.length === 0) {
    return <EmptyState title="No sessions yet" line="Name what you’re working on above and press Start." />;
  }

  return (
    <div className="history" aria-label="Recent sessions">
      {groups.map((group) => (
        <section key={group.day} className="history__day">
          <header className="history__head">
            <h3 className="history__date">{formatShortDate(group.day)}</h3>
            <span className="history__total num">{formatDuration(group.total)}</span>
          </header>
          <ul className="history__rows">
            {group.sessions.map((session) => (
              <li key={session.id}>
                <button
                  className="history__row"
                  type="button"
                  aria-label={`${session.name}, ${formatDuration(session.focusSeconds)}, started ${formatTime(session.startedAt)}`}
                  onClick={() => onOpen(session)}
                >
                  <span className="history__main">
                    <span className="history__name">{session.name}</span>
                    <span className="history__meta">
                      {session.subject !== null && <span className="chip chip--quiet">{session.subject.name}</span>}
                      {session.tags.map((tag) => (
                        <span key={tag} className="chip chip--faint">
                          {tag}
                        </span>
                      ))}
                      {session.attachmentCount > 0 && (
                        <span className="history__files num">
                          {session.attachmentCount} {session.attachmentCount === 1 ? 'file' : 'files'}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="history__right">
                    <span className="history__duration num">{formatDuration(session.focusSeconds)}</span>
                    <span className="history__start num">{formatTime(session.startedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
