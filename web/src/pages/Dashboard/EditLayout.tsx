import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { PANEL_NAMES, PAGE_NAME_MAX, type PanelId } from '@shared/layout.ts';
import type { Edges } from './useArrange.ts';

type BarProps = {
  hidden: PanelId[];
  canAdd: boolean;
  failed: boolean;
  onPressHidden: (e: PointerEvent<HTMLElement>, id: PanelId) => void;
  onShow: (id: PanelId) => void;
  onAddPage: () => void;
  onReset: () => void;
  onDone: () => void;
};

/**
 * Edit mode's bar along the foot of the window: the panels on no page (drag one out onto a page,
 * or click it to put it on this one), a new page, the first three pages back, and Done.
 */
export function EditBar({ hidden, canAdd, failed, onPressHidden, onShow, onAddPage, onReset, onDone }: BarProps) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="edit-bar" role="toolbar" aria-label="Edit the dashboard">
      <div className="edit-bar__inner glass">
        <p className="edit-bar__lead">{failed ? 'Couldn’t save that — try again' : 'Drag panels anywhere; drag their edges to size them'}</p>
        {hidden.length > 0 && (
          <ul className="edit-bar__hidden" aria-label="Hidden panels">
            {hidden.map((id) => (
              <li key={id}>
                <button
                  className="edit-chip"
                  type="button"
                  onPointerDown={(e) => onPressHidden(e, id)}
                  // A pointer's click is the press's; this is Enter or Space.
                  onClick={(e) => e.detail === 0 && onShow(id)}
                  aria-label={`Put ${PANEL_NAMES[id]} on this page`}
                >
                  <span aria-hidden="true">+</span> {PANEL_NAMES[id]}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="edit-bar__acts">
          <button className="btn btn-ghost btn-sm" type="button" onClick={onAddPage} disabled={!canAdd}>
            Add page
          </button>
          <button
            className={asking ? 'btn btn-ghost btn-sm is-asking' : 'btn btn-ghost btn-sm'}
            type="button"
            onClick={() => {
              if (!asking) return setAsking(true);
              setAsking(false);
              onReset();
            }}
            onBlur={() => setAsking(false)}
          >
            {asking ? 'Back to the first three pages?' : 'Reset'}
          </button>
          <button className="btn btn-sm" type="button" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

type HeadProps = { name: string; canDelete: boolean; onRename: (name: string) => void; onDelete: () => void };

/** A page's name, to change, and Delete (its panels go to the hidden ones). */
export function PageHead({ name, canDelete, onRename, onDelete }: HeadProps) {
  const [draft, setDraft] = useState(name);
  const [was, setWas] = useState(name);
  if (name !== was) {
    setWas(name);
    setDraft(name);
  }
  const commit = () => {
    const next = draft.trim();
    if (next !== '' && next !== name) onRename(next);
    else setDraft(name);
  };
  return (
    <div className="container page-head">
      <input
        className="page-head__name"
        aria-label="Page name"
        value={draft}
        maxLength={PAGE_NAME_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(name);
            e.currentTarget.blur();
          }
        }}
      />
      {canDelete && (
        <button className="btn btn-ghost btn-sm page-head__delete" type="button" onClick={onDelete}>
          Delete page
        </button>
      )}
    </div>
  );
}

const HANDLES: [string, Edges][] = [
  ['n', { n: true }],
  ['s', { s: true }],
  ['e', { e: true }],
  ['w', { w: true }],
  ['ne', { n: true, e: true }],
  ['nw', { n: true, w: true }],
  ['se', { s: true, e: true }],
  ['sw', { s: true, w: true }],
];

type ToolsProps = {
  id: PanelId;
  page: number;
  pageNames: string[];
  onPress: (e: PointerEvent<HTMLElement>, edges: Edges | null) => void;
  onNudge: (e: KeyboardEvent) => void;
  onPage: (page: number) => void;
  onHide: () => void;
};

/**
 * Over a panel in edit mode: a strip with its name (its grip: drag it, or move it with the arrow
 * keys and size it with Shift), its page and Hide, and a handle on every edge and corner.
 */
export function SlotTools({ id, page, pageNames, onPress, onNudge, onPage, onHide }: ToolsProps) {
  const name = PANEL_NAMES[id];
  return (
    <div className="slot__edit">
      <div className="slot__strip">
        <button
          className="slot__grip"
          type="button"
          aria-label={`Move ${name}: arrow keys move it, Shift and the arrows size it`}
          onPointerDown={(e) => onPress(e, null)}
          onKeyDown={onNudge}
        >
          <span aria-hidden="true">⠿</span>
          {name}
        </button>
        <div className="slot__tools">
          <select
            className="slot__page"
            aria-label={`Page for ${name}`}
            value={page}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => onPage(Number(e.target.value))}
          >
            {pageNames.map((p, i) => (
              <option key={i} value={i}>
                {p}
              </option>
            ))}
          </select>
          <button className="slot__tool" type="button" aria-label={`Hide ${name}`} onPointerDown={(e) => e.stopPropagation()} onClick={onHide}>
            ×
          </button>
        </div>
      </div>
      {HANDLES.map(([edge, edges]) => (
        <span key={edge} className={`slot__handle slot__handle--${edge}`} aria-hidden="true" onPointerDown={(e) => onPress(e, edges)} />
      ))}
    </div>
  );
}
