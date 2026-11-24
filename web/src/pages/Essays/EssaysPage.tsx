import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router';
import type { Essay, EssayColumn, EssaySummary } from '@shared/types.ts';
import { api } from '../../api.ts';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Tabs } from '../../components/ui/Tabs.tsx';
import { ESSAY_COLUMNS, ESSAY_COLUMN_LABELS } from './columns.ts';
import { DRAG_TYPE, EssayCard } from './EssayCard.tsx';
import './essays.css';

const KEY = ['essays'];

/** Below 900px the columns become tabs (`columns` and `tabs` in essays.css). */
const NARROW = '(max-width: 900px)';
const mobile = () => typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches;

/**
 * Three columns of essays: Personal meditations, Plans and Insights. New makes
 * an empty essay and opens it. A card moves to another column by dragging or
 * with its "Move to…" menu. Under 900px the columns are tabs.
 */
export function EssaysPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<EssayColumn>('meditations');
  const [isNarrow, setIsNarrow] = useState(mobile);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<EssayColumn | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api<EssaySummary[]>('/api/essays', { signal }),
  });
  const essays = query.data ?? [];

  const setRows = (update: (rows: EssaySummary[]) => EssaySummary[]) =>
    queryClient.setQueryData<EssaySummary[]>(KEY, (rows) => update(rows ?? []));

  const move = async (essay: EssaySummary, to: EssayColumn) => {
    if (essay.column === to) return;
    setError(null);
    const before = essays;
    // Shown in its new column at once; `updated_at` still comes from the hub's answer.
    setRows((rows) => rows.map((r) => (r.id === essay.id ? { ...r, column: to } : r)));
    try {
      const { updatedAt } = await api<{ updatedAt: string }>(`/api/essays/${essay.id}`, {
        method: 'PUT',
        json: { column: to, baseUpdatedAt: essay.updatedAt },
      });
      setRows((rows) => rows.map((r) => (r.id === essay.id ? { ...r, column: to, updatedAt } : r)));
    } catch {
      setRows(() => before);
      setError("Couldn't move it — try again.");
    }
  };

  const create = useMutation({
    mutationFn: (column: EssayColumn) => api<Essay>('/api/essays', { method: 'POST', json: { column } }),
    onMutate: () => setError(null),
    onSuccess: (essay) => {
      const { contentJson: _doc, ...summary } = essay;
      queryClient.setQueryData<EssaySummary[]>(KEY, (rows) => [summary, ...(rows ?? [])]);
      navigate(`/essays/${essay.id}`);
    },
    onError: () => setError("Couldn't start a new essay — try again."),
  });

  // Ask the browser which layout is on; the answer changes with the window.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(NARROW);
    const onChange = () => setIsNarrow(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const onDragStart = (essay: EssaySummary) => (e: DragEvent<HTMLLIElement>) => {
    e.dataTransfer.setData(DRAG_TYPE, String(essay.id));
    e.dataTransfer.effectAllowed = 'move';
    setDragging(essay.id);
  };

  const onDrop = (column: EssayColumn) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setOver(null);
    setDragging(null);
    const id = Number(e.dataTransfer.getData(DRAG_TYPE));
    const essay = essays.find((r) => r.id === id);
    if (essay) void move(essay, column);
  };

  const dropZone = (column: EssayColumn) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== column) setOver(column);
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((c) => (c === column ? null : c));
    },
    onDrop: onDrop(column),
  });

  // Newest change first. A card just moved keeps its old time, so it shows where it went and
  // is lifted to the top when the hub's answer brings the new one.
  const cardsFor = (column: EssayColumn) =>
    essays.filter((r) => r.column === column).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);

  const counts = Object.fromEntries(ESSAY_COLUMNS.map((c) => [c, cardsFor(c).length])) as Record<EssayColumn, number>;

  const columnHead = (column: EssayColumn, id?: string) => (
    <>
      <h3 className="col__title" id={id}>
        {ESSAY_COLUMN_LABELS[column]} <span className="col__count num">{counts[column]}</span>
      </h3>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label={`New essay in ${ESSAY_COLUMN_LABELS[column]}`}
        disabled={create.isPending}
        onClick={() => create.mutate(column)}
      >
        New
      </button>
    </>
  );

  const cards = (column: EssayColumn) =>
    counts[column] === 0 ? (
      <EmptyState title="Nothing here yet" line="New starts one in this column." />
    ) : (
      <ul className="essays">
        {cardsFor(column).map((essay) => (
          <EssayCard
            key={essay.id}
            essay={essay}
            column={column}
            onMove={(to) => void move(essay, to)}
            onDragStart={onDragStart(essay)}
            onDragEnd={() => setDragging(null)}
            dragging={dragging === essay.id}
          />
        ))}
      </ul>
    );

  return (
    <div className="container page essays-page">
      <header className="essays-head">
        <h1>Essays</h1>
        <p className="page__lead">Personal meditations, plans and insights.</p>
      </header>
      {error !== null && (
        <p className="essays__error" role="alert">
          {error}
        </p>
      )}
      {query.isError && (
        <p className="essays__error" role="alert">
          Couldn't read your essays — retry.
        </p>
      )}

      <Panel
        title="Essays"
        className="essays-panel"
        actions={
          isNarrow ? (
            <Tabs
              label="Essays columns"
              value={tab}
              onChange={(value) => setTab(value as EssayColumn)}
              options={ESSAY_COLUMNS.map((c) => ({ value: c, label: ESSAY_COLUMN_LABELS[c] }))}
            />
          ) : undefined
        }
      >
        {isNarrow ? (
          // The one column the tabs chose; under 900px only the chosen one shows (essays.css).
          <section className="col is-current" aria-labelledby="essays-tab-head">
            <header className="col__head">{columnHead(tab, 'essays-tab-head')}</header>
            <div className="col__body" {...dropZone(tab)}>
              {cards(tab)}
            </div>
          </section>
        ) : (
          <div className="columns">
            {ESSAY_COLUMNS.map((column) => {
              const headId = `essays-col-${column}`;
              return (
                <section
                  key={column}
                  className={`col${over === column ? ' is-over' : ''}${column === tab ? ' is-current' : ''}`}
                  aria-labelledby={headId}
                  data-column={column}
                  {...dropZone(column)}
                >
                  <header className="col__head">{columnHead(column, headId)}</header>
                  <div className="col__body">{cards(column)}</div>
                </section>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
