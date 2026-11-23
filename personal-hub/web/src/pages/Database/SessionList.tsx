import { useQuery } from '@tanstack/react-query';
import type { Attachment, FocusSession } from '@shared/types.ts';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { api } from '../../api.ts';
import { formatDuration, formatShortDate, formatTime } from '../../lib/format.ts';
import { GitHubFileBadge } from './GitHubFileBadge.tsx';
import { groupSessions, type GroupBy } from './groupSessions.ts';
import type { SortKey } from './types.ts';

type SessionListProps = {
  sessions: FocusSession[];
  sort: SortKey;
  group: GroupBy;
  onSort: (sort: SortKey) => void;
  onGroup: (group: GroupBy) => void;
};

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'created', label: 'Date created' },
  { value: 'subject', label: 'Subject' },
  { value: 'duration', label: 'Duration' },
];
const GROUPS: { value: GroupBy; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'subject', label: 'Subject' },
  { value: 'tag', label: 'Tag' },
];
const ITALIC_KEYS = new Set(['no subject', 'no tag']);

/**
 * The middle column: sort and group choices, then the sessions in groups, each a
 * card with its day, topic, subject, tags, duration, goal, an excerpt of notes and a
 * strip of the first thumbnails. A card opens the session's detail page.
 */
export function SessionList({ sessions, sort, group, onSort, onGroup }: SessionListProps) {
  const groups = groupSessions(sessions, group);

  return (
    <section className="db-list" aria-label="Sessions">
      <div className="db-list__controls">
        <Segmented label="Sort" name="sort" value={sort} options={SORTS} onChange={onSort} />
        <Segmented label="Group" name="group" value={group} options={GROUPS} onChange={onGroup} />
      </div>

      {groups.length === 0 ? (
        <div className="empty">
          <p className="empty__title">No sessions here</p>
          <p className="empty__line">
            {sessions.length === 0 ? 'Start a focus session, or loosen the filters.' : 'These filters hold nothing yet.'}
          </p>
        </div>
      ) : (
        groups.map((g, i) => (
          <section className="db-group" key={g.key} aria-label={g.label}>
            <header className="db-group__head rise" style={{ '--d': i } as CSSProperties}>
              <h3 className={ITALIC_KEYS.has(g.label.toLocaleLowerCase()) ? 'db-group__title is-quiet' : 'db-group__title'}>
                {g.label}
              </h3>
              <p className="db-group__meta num">
                {g.sessions.length} {g.sessions.length === 1 ? 'session' : 'sessions'} · {formatDuration(g.seconds)}
              </p>
            </header>
            <ol className="db-cards">
              {g.sessions.map((session, j) => (
                <SessionCard key={session.id} session={session} delay={Math.min(i + j, 8)} />
              ))}
            </ol>
          </section>
        ))
      )}
    </section>
  );
}

/**
 * Thumbnails are the session's first photos (by attachment id), fetched on their own;
 * a preview the hub hasn't made yet falls back to the original.
 */
function ThumbStrip({ session }: { session: FocusSession }) {
  const query = useQuery({
    queryKey: ['attachments', 'session', session.id],
    queryFn: ({ signal }) => api<Attachment[]>(`/api/attachments?sessionId=${session.id}`, { signal }),
    enabled: session.attachmentCount > 0,
  });
  const photos = (query.data ?? []).filter((f) => f.kind === 'image' && f.parentId === null);
  if (photos.length === 0) return null;
  const strip = photos.slice(0, 4);
  return (
    <ul className="db-thumbs" aria-label={`${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`}>
      {strip.map((file) => (
        <li className="db-thumb" key={file.id}>
          <img src={file.previewUrl ?? file.url} alt="" loading="lazy" />
          <GitHubFileBadge file={file} />
        </li>
      ))}
      {photos.length > strip.length && (
        <li className="db-thumb db-thumb--more num" aria-hidden="true">
          +{photos.length - strip.length}
        </li>
      )}
    </ul>
  );
}

function SessionCard({ session, delay }: { session: FocusSession; delay: number }) {
  const excerpt = session.notes.trim();
  return (
    <li className="rise" style={{ '--d': delay } as CSSProperties}>
      <Link className="db-card" to={`/database/session/${session.id}`}>
        <div className="db-card__top">
          <span className="db-card__date">{formatShortDate(session.startedAt)}</span>
          <span className="db-card__time num">{formatTime(session.startedAt)}</span>
          <span className="db-card__dur num">{formatDuration(session.focusSeconds)}</span>
        </div>
        <div className="db-card__body">
          <div className="db-card__main">
            <h4 className="db-card__name">{session.name}</h4>
            <p className="db-card__where">
              <span className={session.subject === null ? 'db-chip is-quiet' : 'db-chip'}>{session.subject?.name ?? 'No subject'}</span>
              {session.tags.map((tag) => (
                <span className="db-chip is-soft" key={tag}>
                  {tag}
                </span>
              ))}
              {session.goalId !== null && <span className="db-chip is-soft num">Goal {session.goalId}</span>}
            </p>
            {excerpt !== '' && <p className="db-card__notes">{excerpt}</p>}
            {session.attachmentCount > 0 && (
              <p className="db-card__files num">
                {session.attachmentCount} {session.attachmentCount === 1 ? 'file' : 'files'}
              </p>
            )}
          </div>
          <ThumbStrip session={session} />
        </div>
      </Link>
    </li>
  );
}

/** A ruled row of choices with a dot on the current one (Dusk's tabs, as radios). */
function Segmented<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="db-seg">
      <legend className="db-seg__label">{label}</legend>
      <div className="db-seg__row">
        {options.map((option) => (
          <label className="db-seg__item" key={option.value}>
            <input type="radio" name={name} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
