import type { FocusSession } from '@shared/types.ts';
import { formatShortDate } from '../../lib/format.ts';

export type GroupBy = 'day' | 'subject' | 'tag';

export type SessionGroup = {
  /** A day key, a subject name or a tag name; unique within one grouping. */
  key: string;
  label: string;
  /** Newest first. */
  sessions: FocusSession[];
  /** The group's focus, counting a twice-tagged session once. */
  seconds: number;
};

export const NO_SUBJECT = 'No subject';
export const NO_TAG = 'No tag';

const pad = (n: number) => String(n).padStart(2, '0');
/** The session's start as a local day key (`YYYY-MM-DD`), the day the database groups by. */
export const dayKeyOf = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const newestFirst = (a: FocusSession, b: FocusSession) =>
  b.startedAt.localeCompare(a.startedAt) || b.id - a.id;

/**
 * The sessions in groups. `day` groups by the local day each started, newest day first.
 * `subject` groups by subject, in hours of focus, most first (a session with no subject
 * goes under "No subject", last). `tag` groups by tag, in hours of focus; a session
 * with several tags appears under each, and one with none goes under "No tag".
 * Each group's sessions run newest first and its `seconds` counts the group's focus.
 */
export function groupSessions(sessions: FocusSession[], by: GroupBy): SessionGroup[] {
  const groups = new Map<string, { label: string; sessions: FocusSession[] }>();
  const add = (key: string, label: string, session: FocusSession) => {
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { label, sessions: [] }));
    group.sessions.push(session);
  };

  for (const session of sessions) {
    if (by === 'day') {
      const day = dayKeyOf(session.startedAt);
      add(day, formatShortDate(day), session);
    } else if (by === 'subject') {
      const name = session.subject?.name ?? NO_SUBJECT;
      add(name.toLocaleLowerCase(), name, session);
    } else if (session.tags.length === 0) {
      add(NO_TAG.toLocaleLowerCase(), NO_TAG, session);
    } else {
      for (const tag of session.tags) add(tag.toLocaleLowerCase(), tag, session);
    }
  }

  const out = [...groups].map(([key, group]) => ({
    key: by === 'day' ? key : group.label,
    label: group.label,
    sessions: group.sessions.sort(newestFirst),
    seconds: group.sessions.reduce((sum, s) => sum + s.focusSeconds, 0),
  }));
  if (by === 'day') return out.sort((a, b) => b.key.localeCompare(a.key));

  // Hours first, "No subject" after any real one even when it holds more, then by name.
  const rank = (g: SessionGroup) => (by === 'subject' && g.label === NO_SUBJECT ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || b.seconds - a.seconds || a.label.localeCompare(b.label));
}
