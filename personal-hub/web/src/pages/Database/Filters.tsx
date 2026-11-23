import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { AttachmentKind, FocusSession, Subject } from '@shared/types.ts';
import { api, ApiError } from '../../api.ts';
import { formatDuration } from '../../lib/format.ts';
import { EMPTY_FILTERS, toSessionFilters, type FilterState } from './params.ts';

type FiltersProps = {
  value: FilterState;
  onChange: (next: FilterState) => void;
  /** The sessions the other filters hold (search aside), for tag and subject counts. */
  scope: FocusSession[];
};

type Counted<T> = { value: T; label: string; seconds: number };

const KINDS: { value: AttachmentKind; label: string }[] = [
  { value: 'image', label: 'Photos' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'code', label: 'Code and notebooks' },
  { value: 'latex', label: 'LaTeX' },
  { value: 'text', label: 'Text' },
  { value: 'other', label: 'Other files' },
];

const SOURCES: { value: 'upload' | 'github'; label: string }[] = [
  { value: 'upload', label: 'From a device' },
  { value: 'github', label: 'From GitHub' },
];

/** Tags are matched the way the server matches them: `COLLATE NOCASE`, so by lower case, not locale. */
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The Database's left column: search, subject, tags (any of the chosen), a date range,
 * file type, goal and source. Every change writes the address bar through `onChange`.
 * Tags and subjects are counted over what the other filters hold, the search aside.
 */
export function Filters({ value, onChange, scope }: FiltersProps) {
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const active = countActive(value);

  return (
    <form className="db-filters" role="search" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
      <div className="db-filters__head">
        <h2 className="db-filters__title">Filters</h2>
        {active > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(EMPTY_FILTERS)}>
            Clear {active === 1 ? 'the filter' : `all ${active}`}
          </button>
        )}
        <label className="db-field db-filters__search">
          <span className="db-field__label">Search</span>
          <input
            className="db-field__input"
            type="search"
            value={value.q}
            placeholder="Session, notes, file text"
            onChange={(e) => set({ q: e.target.value })}
          />
        </label>
      </div>

      <GoalFilter value={value.goal} onChange={(goal) => set({ goal })} />

      <SubjectFilter value={value.subject} onChange={(subject) => set({ subject })} />
      <div className="db-filters__context num">
        {scope.length === 0 ? 'No sessions in these filters' : `${scope.length} ${scope.length === 1 ? 'session' : 'sessions'} · ${formatDuration(scopeTotal(scope))}`}
      </div>

      <TagFilter tags={value.tags} onChange={(tags) => set({ tags })} scope={scope} />

      <fieldset className="db-fieldset">
        <legend className="db-field__label">Dates</legend>
        <div className="db-dates">
          <label className="db-field db-field--inline">
            <span className="db-field__sub">From</span>
            <input type="date" className="db-field__input" value={value.from ?? ''} max={value.to ?? undefined} onChange={(e) => set({ from: e.target.value || null })} />
          </label>
          <label className="db-field db-field--inline">
            <span className="db-field__sub">To</span>
            <input type="date" className="db-field__input" value={value.to ?? ''} min={value.from ?? undefined} onChange={(e) => set({ to: e.target.value || null })} />
          </label>
        </div>
      </fieldset>

      <ChoiceFilter
        legend="File type"
        name="kind"
        options={KINDS}
        value={value.kind}
        onChange={(kind) => set({ kind })}
      />
      <ChoiceFilter
        legend="Source"
        name="source"
        options={SOURCES}
        value={value.source}
        onChange={(source) => set({ source })}
      />
    </form>
  );
}

/** How many filters are set, for the Clear pill's label. */
export function countActive(f: FilterState): number {
  return [f.q.trim() !== '', f.subject !== null, f.tags.length > 0, f.from !== null || f.to !== null, f.kind !== null, f.goal !== null, f.source !== null].filter(Boolean).length;
}

const scopeTotal = (sessions: FocusSession[]) => sessions.reduce((sum, s) => sum + s.focusSeconds, 0);

/** Subjects with their hours in scope; picking one keeps only its sessions. */
function SubjectFilter({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const query = useQuery({
    queryKey: ['subjects'],
    queryFn: ({ signal }) => api<Subject[]>('/api/subjects', { signal }),
  });
  const id = useId();
  return (
    <label className="db-field" htmlFor={id}>
      <span className="db-field__label">Subject</span>
      <select id={id} className="db-field__input" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">Any subject</option>
        {(query.data ?? []).map((subject) => (
          <option key={subject.id} value={subject.id}>
            {subject.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Just the fields the goal picker reads, so a partial goal row (Task 9's shape) still fits. */
export type GoalOption = { id: number; title: string };

/**
 * The goal, chosen from the open goals (Task 9's `GET /api/goals?status=open`), each as
 * "title". Until that route exists it answers 404, and the picker stays a quiet
 * "No goal" choice rather than an error. A goal the list doesn't hold (finished since,
 * or an old session's) stays in the list while it is chosen, by its id.
 */
export function GoalFilter({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const query = useQuery({
    queryKey: ['goals', 'open'],
    queryFn: ({ signal }) => api<GoalOption[]>('/api/goals?status=open', { signal }),
    // A 404 means Task 9 isn't here yet; asking again this session won't change that.
    retry: (failures, err) => !(err instanceof ApiError && err.status === 404) && failures < 1,
  });
  const id = useId();
  const goals = query.data ?? [];
  const known = goals.some((goal) => goal.id === value);
  return (
    <div className="db-field">
      <label className="db-field__label" htmlFor={id}>
        Goal
      </label>
      <select
        id={id}
        className="db-field__input"
        value={value ?? ''}
        aria-busy={query.isLoading}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      >
        <option value="">{query.isError ? 'No goal' : 'Any goal'}</option>
        {goals.map((goal) => (
          <option key={goal.id} value={goal.id}>
            {goal.title}
          </option>
        ))}
        {value !== null && !known && <option value={value}>Goal {value}</option>}
      </select>
      {query.isError && <span className="db-filters__context">The goals list isn’t available yet.</span>}
    </div>
  );
}

/**
 * Tags as toggle pills, each with its hours in scope, plus a field for a tag that
 * has no sessions yet. Chosen tags stay listed even when they fall out of scope.
 */
function TagFilter({ tags, onChange, scope }: { tags: string[]; onChange: (tags: string[]) => void; scope: FocusSession[] }) {
  const [draft, setDraft] = useState('');
  const listed = new Map<string, Counted<string>>();
  for (const session of scope) {
    for (const tag of session.tags) {
      const key = tag.toLowerCase();
      const found = listed.get(key);
      if (found) found.seconds += session.focusSeconds;
      else listed.set(key, { value: tag, label: tag, seconds: session.focusSeconds });
    }
  }
  // Hours first, then by name as the server lists tags (`COLLATE NOCASE`).
  const byName = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());
  const options = [...listed.values()].sort((a, b) => b.seconds - a.seconds || byName(a.label, b.label));
  for (const tag of tags) {
    if (!listed.has(tag.toLowerCase())) options.push({ value: tag, label: tag, seconds: 0 });
  }

  const toggle = (tag: string) => {
    const has = tags.some((t) => same(t, tag));
    onChange(has ? tags.filter((t) => !same(t, tag)) : [...tags, tag]);
  };
  const addDraft = () => {
    const tag = draft.trim();
    if (tag !== '' && !tags.some((t) => same(t, tag))) onChange([...tags, tag]);
    setDraft('');
  };

  return (
    <fieldset className="db-fieldset" aria-label="Tags">
      <legend className="db-field__label">Tags</legend>
      {options.length === 0 ? (
        <p className="db-filters__context">No tags here yet</p>
      ) : (
        <ul className="db-tags">
          {options.map((tag) => {
            const on = tags.some((t) => same(t, tag.value));
            return (
              <li key={tag.value.toLowerCase()}>
                <button
                  type="button"
                  className={on ? 'db-tag is-on' : 'db-tag'}
                  aria-pressed={on}
                  onClick={() => toggle(tag.value)}
                >
                  {tag.label}
                  <span className="db-tag__n num">{formatDuration(tag.seconds)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="db-tag-add">
        <input
          className="db-field__input"
          value={draft}
          placeholder="Another tag"
          aria-label="Add a tag"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addDraft();
            }
          }}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={addDraft} disabled={draft.trim() === ''}>
          Add
        </button>
      </div>
      {tags.length > 1 && <p className="db-filters__context">A session with any of these is shown.</p>}
    </fieldset>
  );
}

/** One choice per group, or none: a radio set where the "Any" option clears it. */
function ChoiceFilter<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <fieldset className="db-fieldset">
      <legend className="db-field__label">{legend}</legend>
      <div className="db-choice">
        <label className="db-radio">
          <input type="radio" name={name} checked={value === null} onChange={() => onChange(null)} />
          <span>Any</span>
        </label>
        {options.map((option) => (
          <label className="db-radio" key={option.value}>
            <input type="radio" name={name} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * The sessions the tag and subject counts are taken over: every filter but the search
 * and the tags themselves. With `kind` and `source` it keeps the sessions `liveIds` names.
 */
export function scopeOf(all: FocusSession[], filters: FilterState, liveIds: Set<number> | null): FocusSession[] {
  const keep = toSessionFilters(filters, false);
  return all.filter((s) => {
    if (keep.from !== undefined && localDay(s.startedAt) < keep.from) return false;
    // `keep.to` is already the day after the chosen one, so ">=" is "after the chosen day".
    if (keep.to !== undefined && localDay(s.startedAt) >= keep.to) return false;
    if (keep.subjectId !== undefined && s.subject?.id !== keep.subjectId) return false;
    if (keep.goalId !== undefined && s.goalId !== keep.goalId) return false;
    if (liveIds !== null && !liveIds.has(s.id)) return false;
    return true;
  });
}
