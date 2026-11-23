import type { AttachmentKind, SessionFilters } from '@shared/types.ts';
import type { GroupBy } from './groupSessions.ts';
import type { SortKey } from './types.ts';

/**
 * What the Database page keeps in the address bar, so a view can be linked, reloaded
 * or gone back to. `tags` repeats (`?tag=proof&tag=lamport`) like `goal` does not.
 * `sort` and `group` are the middle column's choices and default to `created` and `day`.
 */
export const FILTER_KEYS = ['q', 'subject', 'tag', 'from', 'to', 'kind', 'goal', 'source', 'sort', 'group'] as const;

export type FilterState = {
  q: string;
  subject: number | null;
  tags: string[];
  from: string | null;
  to: string | null;
  kind: AttachmentKind | null;
  goal: number | null;
  source: 'upload' | 'github' | null;
};

export type ViewState = {
  filters: FilterState;
  sort: SortKey;
  group: GroupBy;
};

export const EMPTY_FILTERS: FilterState = {
  q: '',
  subject: null,
  tags: [],
  from: null,
  to: null,
  kind: null,
  goal: null,
  source: null,
};

const KINDS: readonly AttachmentKind[] = ['image', 'pdf', 'code', 'text', 'latex', 'other'];
const SORTS: readonly SortKey[] = ['created', 'subject', 'duration'];
const GROUPS: readonly GroupBy[] = ['day', 'subject', 'tag'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const positive = (raw: string | null): number | null => (raw !== null && /^[1-9][0-9]*$/.test(raw) ? Number(raw) : null);
const oneOf = <T extends string>(raw: string | null, values: readonly T[]): T | null =>
  raw !== null && (values as readonly string[]).includes(raw) ? (raw as T) : null;

/** Reads the URL into a view. Anything unrecognised is dropped, as a mistyped link should be. */
export function readView(params: URLSearchParams): ViewState {
  const from = params.get('from');
  const to = params.get('to');
  return {
    filters: {
      q: params.get('q') ?? '',
      subject: positive(params.get('subject')),
      tags: params.getAll('tag').filter((tag) => tag.trim() !== ''),
      from: from !== null && DAY.test(from) ? from : null,
      to: to !== null && DAY.test(to) ? to : null,
      kind: oneOf(params.get('kind'), KINDS),
      goal: positive(params.get('goal')),
      source: oneOf(params.get('source'), ['upload', 'github'] as const),
    },
    sort: oneOf(params.get('sort'), SORTS) ?? 'created',
    group: oneOf(params.get('group'), GROUPS) ?? 'day',
  };
}

/** Writes the view back, leaving defaults out so an untouched page is plain `/database`. */
export function writeView({ filters, sort, group }: ViewState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim() !== '') params.set('q', filters.q.trim());
  if (filters.subject !== null) params.set('subject', String(filters.subject));
  for (const tag of filters.tags) params.append('tag', tag);
  if (filters.from !== null) params.set('from', filters.from);
  if (filters.to !== null) params.set('to', filters.to);
  if (filters.kind !== null) params.set('kind', filters.kind);
  if (filters.goal !== null) params.set('goal', String(filters.goal));
  if (filters.source !== null) params.set('source', filters.source);
  if (sort !== 'created') params.set('sort', sort);
  if (group !== 'day') params.set('group', group);
  return params;
}

/** The day after `day`, as a day key; local dates, so a DST change cannot skip or repeat one. */
export function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

/**
 * The filters in the API's shape. `q` only when `withQuery`, so the tag list can show
 * what the other filters hold before the search narrows it. The API's `to` is exclusive;
 * the page's To field means "up to and including this day", so it sends the next day.
 */
export function toSessionFilters(filters: FilterState, withQuery: boolean): SessionFilters {
  return {
    q: withQuery && filters.q.trim() !== '' ? filters.q.trim() : undefined,
    subjectId: filters.subject ?? undefined,
    kind: filters.kind ?? undefined,
    goalId: filters.goal ?? undefined,
    source: filters.source ?? undefined,
    from: filters.from ?? undefined,
    to: filters.to === null ? undefined : nextDay(filters.to),
  };
}

/** The `GET /api/sessions` path for a view (grouping is the page's business, not the API's). */
export function sessionsPath({ filters, sort }: Pick<ViewState, 'filters' | 'sort'>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(toSessionFilters(filters, true))) {
    if (value !== undefined) params.set(key, String(value));
  }
  if (sort !== 'created') params.set('sort', sort);
  const query = params.toString();
  return query === '' ? '/api/sessions' : `/api/sessions?${query}`;
}
