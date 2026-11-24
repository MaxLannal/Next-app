import { useState, type DragEvent } from 'react';
import { PANEL_NAMES, PAGE_NAME_MAX, type PanelHeight, type PanelId, type PanelPlace } from '@shared/layout.ts';

/** What a dragged panel carries, so a drop knows which one it is. */
export const DRAG_TYPE = 'application/x-next-panel';

const WIDTHS: Record<PanelPlace['w'], string> = { 2: 'A third', 3: 'Half', 4: 'Two thirds', 6: 'Full width' };

type BarProps = {
  hidden: PanelId[];
  canAdd: boolean;
  failed: boolean;
  onShow: (id: PanelId) => void;
  onDragHidden: (id: PanelId | null) => void;
  onAddPage: () => void;
  onReset: () => void;
  onDone: () => void;
};

/**
 * Edit mode's bar along the foot of the window: the panels on no page (drag one onto a page, or
 * click it to put it on this one), a new page, the first three pages back, and Done.
 */
export function EditBar({ hidden, canAdd, failed, onShow, onDragHidden, onAddPage, onReset, onDone }: BarProps) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="edit-bar" role="toolbar" aria-label="Edit the dashboard">
      <div className="edit-bar__inner glass">
        <p className="edit-bar__lead">{failed ? 'Couldn’t save that — try again' : 'Drag panels to move them'}</p>
        {hidden.length > 0 && (
          <ul className="edit-bar__hidden" aria-label="Hidden panels">
            {hidden.map((id) => (
              <li key={id}>
                <button
                  className="edit-chip"
                  type="button"
                  draggable
                  onDragStart={(e: DragEvent<HTMLButtonElement>) => {
                    e.dataTransfer.setData(DRAG_TYPE, id);
                    e.dataTransfer.effectAllowed = 'move';
                    onDragHidden(id);
                  }}
                  onDragEnd={() => onDragHidden(null)}
                  onClick={() => onShow(id)}
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

type HeadProps = { name: string; first: boolean; onRename: (name: string) => void; onDelete: () => void };

/** A page's name, to change, and Delete for any page but the first (the clock's). */
export function PageHead({ name, first, onRename, onDelete }: HeadProps) {
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
      {!first && (
        <button className="btn btn-ghost btn-sm page-head__delete" type="button" onClick={onDelete}>
          Delete page
        </button>
      )}
    </div>
  );
}

type ToolsProps = {
  place: PanelPlace;
  index: number;
  count: number;
  page: number;
  pageNames: string[];
  onWider: (step: -1 | 1) => void;
  onHeight: (h: PanelHeight) => void;
  onMove: (page: number, index: number) => void;
  onHide: () => void;
};

/** Over a panel in edit mode: its name, its size, and where it goes; drag it by the strip. */
export function SlotTools({ place, index, count, page, pageNames, onWider, onHeight, onMove, onHide }: ToolsProps) {
  const name = PANEL_NAMES[place.id];
  return (
    <div className="slot__edit">
      <div className="slot__strip">
        <span className="slot__name">
          <span className="slot__grip" aria-hidden="true">
            ⠿
          </span>
          {name}
        </span>
        <div className="slot__tools" role="group" aria-label={`Arrange ${name}`}>
          <button className="slot__tool" type="button" aria-label={`Narrower: ${name}`} disabled={place.w === 2} onClick={() => onWider(-1)}>
            −
          </button>
          <span className="slot__size">{WIDTHS[place.w]}</span>
          <button className="slot__tool" type="button" aria-label={`Wider: ${name}`} disabled={place.w === 6} onClick={() => onWider(1)}>
            +
          </button>
          <button
            className="slot__tool slot__tool--text"
            type="button"
            aria-pressed={place.h === 2}
            aria-label={`Two rows tall: ${name}`}
            onClick={() => onHeight(place.h === 2 ? 1 : 2)}
          >
            Tall
          </button>
          <button className="slot__tool" type="button" aria-label={`Move earlier: ${name}`} disabled={index === 0} onClick={() => onMove(page, index - 1)}>
            ←
          </button>
          <button className="slot__tool" type="button" aria-label={`Move later: ${name}`} disabled={index === count - 1} onClick={() => onMove(page, index + 2)}>
            →
          </button>
          <select
            className="slot__page"
            aria-label={`Page for ${name}`}
            value={page}
            onChange={(e) => onMove(Number(e.target.value), Number.MAX_SAFE_INTEGER)}
          >
            {pageNames.map((p, i) => (
              <option key={i} value={i}>
                {p}
              </option>
            ))}
          </select>
          <button className="slot__tool" type="button" aria-label={`Hide ${name}`} onClick={onHide}>
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
