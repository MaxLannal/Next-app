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
  const thumbs = useBatchThumbs(sessions);

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
                <SessionCard key={session.id} session={session} thumbs={thumbs(session)} delay={Math.min(i + j, 8)} />
              ))}
            </ol>
          </section>
        ))
      )}
    </section>
  );
}

/** How many thumbnail strips share one read, keeping its URL well inside a sane length. */
export const THUMB_BATCH = 100;

type Thumbs = { photos: Attachment[]; more: number };

/**
 * Every visible session's first photos, from one `GET /api/attachments?sessionIds=…`:
 * a card per session would be one request each. Sessions that hold more files than the
 * read returned say "and more" instead of guessing a count. Files come oldest first,
 * so a session's first four are the earliest it holds.
 */
function useBatchThumbs(sessions: FocusSession[]): (session: FocusSession) => Thumbs | null {
  const withFiles = [...new Set(sessions.filter((s) => s.attachmentCount > 0).map((s) => s.id))].slice(0, THUMB_BATCH);
  const key = withFiles.join(',');
  const query = useQuery({
    queryKey: ['attachments', 'sessionIds', key],
    queryFn: ({ signal }) => api<Attachment[]>(`/api/attachments?sessionIds=${key}`, { signal }),
    enabled: withFiles.length > 0,
  });
  const bySession = new Map<number, Thumbs>();
  for (const file of query.data ?? []) {
    if (file.kind !== 'image' || file.parentId !== null || file.sessionId === null) continue;
    const thumbs = bySession.get(file.sessionId) ?? { photos: [], more: 0 };
    if (thumbs.photos.length < 4) thumbs.photos.push(file);
    else thumbs.more += 1;
    bySession.set(file.sessionId, thumbs);
  }
  return (session) => bySession.get(session.id) ?? null;
}

/** The strip of up to four photos. A preview the hub hasn't made yet falls back to the original. */
function ThumbStrip({ thumbs }: { thumbs: Thumbs }) {
  const shown = thumbs.photos.length;
  const total = shown + thumbs.more;
  return (
    <ul className="db-thumbs" aria-label={`${total} ${total === 1 ? 'photo' : 'photos'}`}>
      {thumbs.photos.map((file) => (
        <li className="db-thumb" key={file.id}>
          <img src={file.previewUrl ?? file.url} alt="" loading="lazy" />
          <GitHubFileBadge file={file} />
        </li>
      ))}
      {thumbs.more > 0 && (
        <li className="db-thumb db-thumb--more num" aria-hidden="true">
          +{thumbs.more}
        </li>
      )}
    </ul>
  );
}

function SessionCard({ session, thumbs, delay }: { session: FocusSession; thumbs: Thumbs | null; delay: number }) {
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
          {thumbs !== null && <ThumbStrip thumbs={thumbs} />}
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
