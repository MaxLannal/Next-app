import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import type { Resource, ResourceKind } from '@shared/types.ts';
import { api, ApiError } from '../../../api.ts';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { Panel } from '../../../components/ui/Panel.tsx';
import { Tabs } from '../../../components/ui/Tabs.tsx';
import './ResourcesPanel.css';

type Filter = ResourceKind | 'all';
type Edit = Partial<Pick<Resource, 'title' | 'kind' | 'note' | 'done'>>;

const QUERY_KEY = ['resources'];
const KINDS: ResourceKind[] = ['pdf', 'video', 'course', 'link'];
const KIND_LABEL: Record<ResourceKind, string> = { pdf: 'PDF', video: 'Video', course: 'Course', link: 'Link' };
const FILTERS = [{ value: 'all', label: 'All' }, ...KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))];
const EMPTY: Record<Filter, { title: string; line: string }> = {
  all: { title: 'Nothing saved yet', line: 'Paste a link above and press Enter. The title fills in by itself.' },
  pdf: { title: 'No PDFs yet', line: 'Links to PDF files show here, titled from the file.' },
  video: { title: 'No videos yet', line: 'YouTube and Vimeo links show here.' },
  course: { title: 'No courses yet', line: 'Coursera, edX, MIT OCW, Khan Academy and YouTube playlists show here.' },
  link: { title: 'No other links yet', line: 'Pages that aren’t PDFs, videos or courses show here.' },
};

const messageOf = (err: unknown, fallback: string) => (err instanceof ApiError && err.status !== 0 ? err.message : fallback);

/**
 * Saved links. Paste one and press Enter: the hub fetches its title and kind
 * while a pending row holds its place. Rows filter by kind, edit inline, check
 * off as done, and ask before deleting.
 */
export function ResourcesPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => api<Resource[]>('/api/resources', { signal }),
  });
  const fieldId = useId();
  const [filter, setFilter] = useState<Filter>('all');
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<{ key: number; url: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(0);
  const fieldRef = useRef<HTMLInputElement>(null);

  const setRows = (update: (rows: Resource[]) => Resource[]) =>
    queryClient.setQueryData<Resource[]>(QUERY_KEY, (rows) => update(rows ?? []));

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const url = draft.trim();
    if (url === '') {
      fieldRef.current?.focus();
      return;
    }
    const key = nextKey.current++;
    setPending((list) => [{ key, url }, ...list]);
    setDraft('');
    setError(null);
    try {
      const created = await api<Resource>('/api/resources', { method: 'POST', json: { url } });
      setRows((rows) => [created, ...rows]);
      setFilter((f) => (f === 'all' || f === created.kind ? f : 'all'));
    } catch (err) {
      setError(messageOf(err, 'Couldn’t reach the hub — the link wasn’t saved'));
      setDraft((d) => (d === '' ? url : d));
    } finally {
      setPending((list) => list.filter((p) => p.key !== key));
    }
  };

  const update = async (id: number, edit: Edit): Promise<boolean> => {
    setError(null);
    try {
      const next = await api<Resource>(`/api/resources/${id}`, { method: 'PATCH', json: edit });
      setRows((rows) => rows.map((r) => (r.id === id ? next : r)));
      return true;
    } catch (err) {
      setError(messageOf(err, 'Couldn’t save that change — retry'));
      return false;
    }
  };

  const remove = async (id: number) => {
    setError(null);
    try {
      await api(`/api/resources/${id}`, { method: 'DELETE' });
      setRows((rows) => rows.filter((r) => r.id !== id));
    } catch (err) {
      setError(messageOf(err, 'Couldn’t delete that link — retry'));
    }
  };

  const rows = query.data ?? [];
  const shown = filter === 'all' ? rows : rows.filter((r) => r.kind === filter);

  return (
    <Panel title="Resources" className="resources">
      <form className="join" onSubmit={add}>
        <label className="visually-hidden" htmlFor={fieldId}>
          Link to save
        </label>
        <input
          ref={fieldRef}
          id={fieldId}
          type="text"
          inputMode="url"
          enterKeyHint="go"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Paste a link, press Enter"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn" type="submit">
          Add
        </button>
      </form>
      {error !== null && (
        <p className="resources__error" role="alert">
          {error}
        </p>
      )}
      <p className="visually-hidden" role="status">
        {pending.length > 0 ? 'Fetching the title…' : ''}
      </p>

      <div className="resources__tabs">
        <Tabs options={FILTERS} value={filter} onChange={(v) => setFilter(v as Filter)} label="Kind" />
      </div>

      {query.isError && rows.length === 0 ? (
        <EmptyState
          title="Couldn’t load your links"
          line={messageOf(query.error, 'The hub didn’t answer.')}
          action={
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void query.refetch()}>
              Retry
            </button>
          }
        />
      ) : query.isSuccess && shown.length === 0 && pending.length === 0 ? (
        <EmptyState title={EMPTY[filter].title} line={EMPTY[filter].line} />
      ) : (
        <ul className="res-list" aria-label="Saved links">
          {pending.map((p) => (
            <li key={`pending-${p.key}`} className="res is-pending">
              <span className="res__mark" aria-hidden="true">
                <span className="res__pulse" />
              </span>
              <span className="res__main">
                <span className="res__title">{p.url}</span>
                <span className="res__sub">Fetching the title…</span>
              </span>
            </li>
          ))}
          {shown.map((r, i) => (
            <ResourceRow key={r.id} resource={r} index={i} onUpdate={update} onRemove={remove} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

type RowProps = {
  resource: Resource;
  index: number;
  onUpdate: (id: number, edit: Edit) => Promise<boolean>;
  onRemove: (id: number) => Promise<void>;
};

function ResourceRow({ resource: r, index, onUpdate, onRemove }: RowProps) {
  const titleId = useId();
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view');
  const deleteRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const lastMode = useRef(mode);

  // Keep focus on the row as its controls swap: into the confirm pair, and back to what opened it.
  useEffect(() => {
    if (mode === 'confirm') keepRef.current?.focus();
    else if (mode === 'view' && lastMode.current === 'confirm') deleteRef.current?.focus();
    else if (mode === 'view' && lastMode.current === 'edit') editRef.current?.focus();
    lastMode.current = mode;
  }, [mode]);

  const style = { '--d': Math.min(index, 8) } as CSSProperties;

  if (mode === 'edit') {
    return (
      <li className="res is-editing" style={style}>
        <KindMark kind={r.kind} />
        <EditForm
          resource={r}
          onCancel={() => setMode('view')}
          onSave={async (edit) => {
            if (await onUpdate(r.id, edit)) setMode('view');
          }}
        />
      </li>
    );
  }

  return (
    <li className={r.done ? 'res rise is-done' : 'res rise'} style={style}>
      <KindMark kind={r.kind} />
      <span className="res__main">
        <a className="res__title" id={titleId} href={r.url} target="_blank" rel="noopener">
          {r.title}
        </a>
        <span className="res__sub">
          {r.domain}
          {r.note !== '' && <span className="res__note"> · {r.note}</span>}
        </span>
      </span>
      {mode === 'confirm' ? (
        <span
          className="res__acts"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMode('view');
          }}
        >
          <span className="res__ask">Delete?</span>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void onRemove(r.id)}>
            Yes, delete
          </button>
          <button ref={keepRef} className="btn btn-ghost btn-sm" type="button" onClick={() => setMode('view')}>
            Keep
          </button>
        </span>
      ) : (
        <span className="res__acts">
          <button
            ref={editRef}
            className="res__btn"
            type="button"
            aria-label="Edit"
            aria-describedby={titleId}
            onClick={() => setMode('edit')}
          >
            <Icon d="M10.5 3.5l2 2M3 13l.6-2.6L11 3a1.4 1.4 0 0 1 2 2l-7.4 7.4z" />
          </button>
          <button
            className="res__check"
            type="button"
            aria-label="Done"
            aria-describedby={titleId}
            aria-pressed={r.done}
            onClick={() => void onUpdate(r.id, { done: !r.done })}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="8.25" />
              <path d="M6.5 10.25l2.4 2.4 4.6-5.1" />
            </svg>
          </button>
          <button
            ref={deleteRef}
            className="res__btn"
            type="button"
            aria-label="Delete"
            aria-describedby={titleId}
            onClick={() => setMode('confirm')}
          >
            <Icon d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
          </button>
        </span>
      )}
    </li>
  );
}

type EditFormProps = {
  resource: Resource;
  onSave: (edit: Edit) => Promise<void>;
  onCancel: () => void;
};

/** The row's title, note and kind as fields. Enter saves, Esc cancels; an empty title keeps the old one. */
function EditForm({ resource: r, onSave, onCancel }: EditFormProps) {
  const id = useId();
  const [title, setTitle] = useState(r.title);
  const [note, setNote] = useState(r.note);
  const [kind, setKind] = useState(r.kind);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    await onSave(title.trim() === '' ? { note, kind } : { title, note, kind });
    setBusy(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onCancel();
  };

  return (
    <form className="res__edit" onSubmit={submit} onKeyDown={onKeyDown}>
      <label className="visually-hidden" htmlFor={`${id}-title`}>
        Title
      </label>
      <input
        id={`${id}-title`}
        className="res__field"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label className="visually-hidden" htmlFor={`${id}-note`}>
        Note
      </label>
      <input
        id={`${id}-note`}
        className="res__field res__field--note"
        placeholder="Add a note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="res__edit-foot">
        <div className="res__kinds" role="radiogroup" aria-label="Kind">
          {KINDS.map((k) => (
            <label key={k} className="res__kind">
              <input
                className="visually-hidden"
                type="radio"
                name={`${id}-kind`}
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
              />
              {KIND_LABEL[k]}
            </label>
          ))}
        </div>
        <span className="res__edit-acts">
          <button className="btn btn-ghost btn-sm" type="submit" disabled={busy}>
            Save
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onCancel}>
            Cancel
          </button>
        </span>
      </div>
    </form>
  );
}

const KIND_ICONS: Record<ResourceKind, string> = {
  pdf: 'M4 1.75h5.25L12.5 5v9.25H4zM9 1.75v3.5h3.5M6 8.5h4.5M6 11h3',
  video: 'M5.25 3.25v9.5L12.75 8z',
  course: 'M1.25 6L8 3l6.75 3L8 9zM4 7.5v3.25c1.5 1.5 6.5 1.5 8 0V7.5M14.75 6v3.5',
  link: 'M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.12-2.12a2.5 2.5 0 0 0-3.54-3.54l-.7.7M9.25 6.75a2.5 2.5 0 0 0-3.54 0L3.59 8.87a2.5 2.5 0 0 0 3.54 3.54l.7-.7',
};

function KindMark({ kind }: { kind: ResourceKind }) {
  return (
    <span className="res__mark" role="img" aria-label={KIND_LABEL[kind]} title={KIND_LABEL[kind]}>
      <Icon d={KIND_ICONS[kind]} />
    </span>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
