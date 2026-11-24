import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Resource, ResourceKind } from '@shared/types.ts';
import { api } from '../../api.ts';
import { SiteIcon } from '../../components/SiteIcon.tsx';

type ResourcePickerProps = {
  /** The experience's name, for the heading. */
  name: string;
  /** Resources already on this experience, which can't be attached twice. */
  attached: Set<number>;
  onAttach: (resources: Resource[]) => void;
  onClose: () => void;
};

const KINDS: { value: ResourceKind | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'video', label: 'Videos' },
  { value: 'course', label: 'Courses' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'link', label: 'Links' },
];
const KIND_NAME: Record<ResourceKind, string> = { pdf: 'PDF', video: 'Video', course: 'Course', link: 'Link' };

/** The right sidebar for attaching resources from the Resources panel to an experience. */
export function ResourcePicker({ name, attached, onAttach, onClose }: ResourcePickerProps) {
  const resources = useQuery({ queryKey: ['resources'], queryFn: ({ signal }) => api<Resource[]>('/api/resources', { signal }) });
  const [kind, setKind] = useState<ResourceKind | 'all'>('all');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const all = resources.data ?? [];
  const shown = kind === 'all' ? all : all.filter((r) => r.kind === kind);
  const chosen = all.filter((r) => picked.has(r.id));

  const toggle = (id: number) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className="picker" aria-label={`Attach resources to ${name}`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <header className="picker__head">
        <h2 className="picker__title">Attach resources</h2>
        <button className="picker__x" type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <p className="picker__lead">From your Resources panel, to “{name}”.</p>
      <div className="picker__kinds" role="radiogroup" aria-label="Kind">
        {KINDS.map((k) => (
          <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} className="picker__kind" onClick={() => setKind(k.value)}>
            {k.label}
          </button>
        ))}
      </div>
      {resources.isSuccess && shown.length === 0 ? (
        <p className="picker__empty">{all.length === 0 ? 'No resources yet: paste a link into the Resources panel first.' : 'None of this kind.'}</p>
      ) : (
        <ul className="picker__list">
          {shown.map((r) => {
            const there = attached.has(r.id);
            return (
              <li key={r.id}>
                <label className={there ? 'picker__row picker__row--res is-there' : 'picker__row picker__row--res'}>
                  <input type="checkbox" checked={there || picked.has(r.id)} disabled={there} onChange={() => toggle(r.id)} />
                  <span className="picker__icon" aria-hidden="true">
                    <SiteIcon resourceId={r.id} fallback={<span className="picker__icon-glyph">{KIND_NAME[r.kind].slice(0, 1)}</span>} />
                  </span>
                  <span className="picker__name">{r.title}</span>
                  <span className="picker__meta">
                    {r.domain} · {KIND_NAME[r.kind]}
                    {there ? ' · attached' : ''}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <footer className="picker__foot">
        <button className="btn" type="button" disabled={chosen.length === 0} onClick={() => onAttach(chosen)}>
          {chosen.length === 0 ? 'Attach' : `Attach ${chosen.length}`}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          Cancel
        </button>
      </footer>
    </aside>
  );
}
