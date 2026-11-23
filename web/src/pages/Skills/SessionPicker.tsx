import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { FocusSession } from '@shared/types.ts';
import { api } from '../../api.ts';
import { formatDuration, formatShortDate } from '../../lib/format.ts';

type SessionPickerProps = {
  /** Sessions already on this canvas, which can't be added twice. */
  onCanvas: Set<number>;
  onAdd: (sessions: FocusSession[]) => void;
  onClose: () => void;
};

/** The right sidebar for "Experience": focus sessions from the database, ticked and added as experiences. */
export function SessionPicker({ onCanvas, onAdd, onClose }: SessionPickerProps) {
  const sessions = useQuery({
    queryKey: ['sessions', 'picker'],
    queryFn: ({ signal }) => api<FocusSession[]>('/api/sessions?limit=80', { signal }),
  });
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const done = (sessions.data ?? []).filter((s) => s.status === 'done');
  const chosen = done.filter((s) => picked.has(s.id));

  const toggle = (id: number) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className="picker" aria-label="Link focus sessions" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <header className="picker__head">
        <h2 className="picker__title">Link focus sessions</h2>
        <button className="picker__x" type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <p className="picker__lead">Each one becomes an experience. Drag it onto the step it built.</p>
      {sessions.isSuccess && done.length === 0 ? (
        <p className="picker__empty">No finished focus sessions yet.</p>
      ) : (
        <ul className="picker__list">
          {done.map((s) => {
            const there = onCanvas.has(s.id);
            return (
              <li key={s.id}>
                <label className={there ? 'picker__row is-there' : 'picker__row'}>
                  <input type="checkbox" checked={picked.has(s.id)} disabled={there} onChange={() => toggle(s.id)} />
                  <span className="picker__name">{s.name}</span>
                  <span className="picker__meta num">
                    {s.subject?.name ? `${s.subject.name} · ` : ''}
                    {formatShortDate(s.startedAt)} · {formatDuration(s.focusSeconds)}
                    {there ? ' · on the canvas' : ''}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <footer className="picker__foot">
        <button className="btn" type="button" disabled={chosen.length === 0} onClick={() => onAdd(chosen)}>
          {chosen.length === 0 ? 'Add experiences' : `Add ${chosen.length} ${chosen.length === 1 ? 'experience' : 'experiences'}`}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          Cancel
        </button>
      </footer>
    </aside>
  );
}
